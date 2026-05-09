# PLAN-039 调度三件套：多维 PickNode + Live Migration + 不均衡 Watchdog

- **status**: completed
- **createdAt**: 2026-05-06 14:30
- **approvedAt**: 2026-05-06 15:00
- **completedAt**: 2026-05-06 15:40（vmc.5ok.co 灰度 + 全量 stateful 回填 + 2 次 live migrate 验证 OK）
- **priority**: P2
- **owner**: claude
- **decisions**: D1=c (A→灰度B单台→C→B全量) / D2=auto / D3=灰度后批量回填 / D4=0.5/0.4/0.1（disk 实测改 0.4 cpu / 0.1 disk）
- **relatedTasks**: [OPS-042](../task/OPS-042.md) / [OPS-043](../task/OPS-043.md) / [OPS-044](../task/OPS-044.md)
- **referenceDoc**: PLAN-037（VMService.Migrate / rebalance 包 / NodeTopology endpoint）/ OPS-008 #5（migration.stateful 历史）/ PLAN-020（HA 自愈 healing_threshold）

## 现状（vmc.5ok.co 实测）

### 调度（OPS-042 范围）

`internal/cluster/scheduler.go::PickNode`：

- 60s 缓存 `/1.0/resources?target=X`，仅取 `cpu.total / memory.{total,used}`
- 评分：`free_ratio = mem_free / mem_total`；按降序选最大
- **未读** `scheduler.instance=manual`（维护态）→ 维护节点仍可能被新 VM 选中（依赖 Incus 自身调度过滤兜底）
- **未拉**磁盘空间（每节点 ceph OSD 已用率 / 本地 pool 可用容量）
- **未拉** CPU 负载（无 prom，原生 Incus API 也不直接给 load avg）

VMs 实际放置（生产）：4 台手工分布在 node1-3-5（mem 充裕，但调度算法没保证多维度均衡）。

### Live Migration（OPS-043 范围）

vmc.5ok.co 实测确认前置条件：

| 前置 | 状态 |
|---|---|
| Incus 版本 | **6.23** ✅ |
| 共享存储 | **ceph-pool driver=ceph，8TB / 12.9GB used** ✅ |
| 集群网络 10.0.20.0/24 | 5 节点全 ONLINE ✅ |
| QEMU live-patch | Incus 6.23 ubuntu 包自带 ✅ |
| 现存 VM `migration.stateful` | **❌ 全部 4 台未设**（vm-cdc154/35762f/784367/73a439）|
| vm_create.go 新建路径 | ✅ 已默认 `migration.stateful=true`（OPS-008 #5）|

→ 新 VM 自动支持 live；旧 VM 必须**回填 + 重启**才能 live。

### Watchdog（OPS-044 范围）

PLAN-037 给了 RebalancePanel（人工点开按需拉）。无后台周期监控；admin 不打开页就看不到不均衡。

`internal/worker/healing_expire.go` 是周期 worker 标杆（5min tick + ctx-aware shutdown）。

## 方案

总体方向：**3 个任务并行可做**，但有显式顺序：A→C 可独立推进；B 需要 A 的 NodeTopology 数据 + 真机灰度（先单台试探再全量）。

### Phase A：多维度 PickNode（OPS-042，~1.5d）

A1. **NodeInfo 扩展**（`internal/cluster/scheduler.go`）

```go
type NodeInfo struct {
    // 现有字段保留
    Name, Status, Message string
    CPUTotal int
    MemTotal, MemUsed, MemFree int64
    FreeRatio float64
    // 新增（PLAN-039 OPS-042）
    Maintenance   bool    // scheduler.instance == "manual"
    Evacuated     bool    // status == "Evacuated"
    DiskTotal     int64   // 主存储池 space.total
    DiskUsed      int64   // 主存储池 space.used
    DiskFreeRatio float64
    VMCPUTotal    int     // 节点上 VM cpu limits 之和（来自 /1.0/resources 不直接给，
                          //  改用 GetInstances 当前节点的 cpu limits 累加；缓存）
    Score         float64 // 综合得分
}
```

A2. **数据采集**（`refreshCluster`）：
- 现有 `/1.0/resources?target=X` 调用保留
- 新加 `/1.0/storage-pools/<pool>/state?target=X` → DiskTotal/Used；pool 名取 cluster.config.StoragePool
- maintenance/evacuated：复用 PLAN-037 `memberMaintFlags()` 函数（已暴露在 clustermgmt.go）—— 提取到 `internal/cluster/` 包内供 scheduler 复用
- VMCPUTotal：`/1.0/instances?recursion=1&filter=location eq X` 累加 limits.cpu

A3. **加权评分**（`scoreNode` 纯函数 + 单测）

```go
func scoreNode(n NodeInfo) float64 {
    // 维护 / 离线节点直接 0 分（不参与调度）
    if n.Maintenance || n.Evacuated || n.Status != "Online" {
        return 0
    }
    cpuFreeRatio := 1.0
    if n.CPUTotal > 0 {
        cpuFreeRatio = math.Max(0, 1.0 - float64(n.VMCPUTotal)/float64(n.CPUTotal))
    }
    return 0.5*n.FreeRatio + 0.3*cpuFreeRatio + 0.2*n.DiskFreeRatio
}
```

权重默认 (0.5, 0.3, 0.2)；env `SCHEDULER_WEIGHTS=0.5,0.3,0.2` 允许调优而不改代码。

A4. **PickNode 改造**：
- 候选过滤：剔除 Maintenance / Evacuated / Status≠Online
- 排序：按 Score 降序；tie-break 按 mem_free 绝对值降序（避免相同分但小节点被反复挑中）
- 失败语义不变（无候选 → "no available nodes"）

A5. **NodeTopology endpoint 一并暴露 score**：
- `clustermgmt.go::NodeTopology` 已经返回 mem/cpu/vm_count，加 `disk_total / disk_used / score / maintenance / evacuated` 4 项
- 前端 NodeTopologyStrip chip 增加 "score: 0.78" 小字（按需，可放 hover tooltip 不污染主信息）

A6. **测试**：
- `scheduler_test.go`：纯函数 scoreNode 7 cases（balanced / mem-low / cpu-saturated / disk-full / maintenance excluded / evacuated excluded / weights override）
- 集成测：mock cluster.Manager 返 fake nodes → PickNode 选最高分

### Phase B：Live Migration（OPS-043，~3d）

**B1. Stateful 回填后端（~0.5d）**

- 新 service 方法 `VMService.EnableStateful(ctx, cluster, project, vm) error`：
  1. 设 `migration.stateful=true` via PATCH instance config
  2. 重启 VM（必须重启才生效）；如果用户已停机则只 set 不 restart
  3. audit `vm.enable_stateful`
- 单台 endpoint：`POST /admin/vms/{name}/enable-stateful` (step-up gated)
- 批量 endpoint：复用现有 batch 模式（PLAN-023）`POST /admin/vms:enable-stateful-batch`，sync execution（每台 1-2s 重启不算长）

**B2. VMService.Migrate 加 mode（~1d）**

```go
type MigrateMode string
const (
    MigrateAuto MigrateMode = "auto" // 检查 stateful 自选
    MigrateLive MigrateMode = "live" // 强制 live；失败不 fallback（admin 想知道）
    MigrateCold MigrateMode = "cold" // 强制冷迁移
)
func (s *VMService) Migrate(ctx, ..., mode MigrateMode) (*MigrateResult, error)
```

实现分支：

- `MigrateAuto`：先 GET instance config 看 `migration.stateful`；true 走 live，false 走 cold
- `MigrateLive`：直接 POST `{name, migration: true, live: true}` 不停机；失败 → `audit vm.migrate.live_failed` + 报错（不 fallback）
- `MigrateCold`：现有路径不变

`MigrateResult` 加字段 `Mode string`（实际走的模式）。

vm_migrate_batch executor 每个 item 也带 `Mode`，用户在 sheet 选择。

**B3. UI 改造（~1d）**

`features/vms/components/migrate-batch-sheet.tsx` + admin/vm-detail Migrate sheet：
- toggle "Live migration（不停机）" 默认 `auto`
- 三选：auto / live / cold（auto 推荐）
- sheet 顶部 banner：检查所选 VM 集合 stateful 标记 → 若 N 台未启用，显示「N 台不支持 live，将冷迁移；先 [启用 stateful（一键）](#)」
- 配套：admin/vms 列表新增 location 列旁的 "live" badge（绿色 = stateful=true）

**B4. 真机灰度 e2e（~0.5d）**

按顺序：
1. 用 vm-cdc154（最早创建）灰度：admin/vm-detail → 启用 stateful → 重启 → live migrate node1→node2 → 验证不停机
2. 验证 ping 不丢包 + ssh 长连接不中断
3. 全量回填生产剩余 3 台：使用批量 endpoint
4. 测试批量 live migration（3 台 / 跨 source）

### Phase C：Imbalance Watchdog（OPS-044，~1d）

**C1. 新表**（`db/migrations/023_system_alerts.sql`）

```sql
CREATE TABLE system_alerts (
    id           BIGSERIAL PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('imbalance')),
    cluster      TEXT NOT NULL,
    severity     TEXT NOT NULL DEFAULT 'warning'
                 CHECK (severity IN ('info','warning','error')),
    payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ,
    dismissed_by INT REFERENCES users(id)
);
CREATE INDEX idx_system_alerts_active
  ON system_alerts(cluster, kind) WHERE resolved_at IS NULL;
```

**C2. Worker**（`internal/worker/imbalance_watchdog.go`）

- 5min tick + ctx-aware（healing_expire 模式）
- 对每个 cluster 调 `rebalance.Compute()`，若 stats.Imbalanced 连续 ≥ 3 次（15min 持续不均衡），写/更新 alert
- 若 stats.Imbalanced 翻转为 false 一次 → 把 active alert 标 resolved_at
- 状态机用 in-memory counter（per cluster）；进程重启 counter 归 0（保守，不会误报）

**C3. Endpoint**

- `GET /admin/system-alerts?active=true` → 列出未 resolved
- `POST /admin/system-alerts/{id}/dismiss` (step-up gated)：手工 dismiss（dismissed_by + resolved_at = now）

**C4. UI**：

- admin/nodes 顶部加 `<AlertBanner />`（在 NodeTopologyStrip 上方）
- 显示：「集群不均衡持续 15min（mem util std dev 0.34）」+ "查看建议"按钮（链接到 RebalancePanel 自动展开）+ "忽略" 按钮（dismiss）
- 视觉值：bg-status-warning/8 border-status-warning/30（沿用 PLAN-037 banner）

## 风险

| 风险 | 缓解 |
|---|---|
| **Live migration 损坏运行 VM 内存状态**（OPS-043） | 先 vm-cdc154 单台灰度验证；live 路径默认带 best-effort fallback；用户选 mode=live 才走 live；批量入口默认 auto |
| 现存 4 台 VM 都是 customers project 的真用户 VM —— 回填时重启 = 用户感知停机 30s | 只在用户主动点 "启用 stateful（一键）" 时执行；UI 明示「需重启 VM」；可分台并发执行 |
| 多维度评分权重 0.5/0.3/0.2 不普适 | env `SCHEDULER_WEIGHTS` 可调；权重总和 != 1 时归一化；单测覆盖边界 |
| disk pool state API 拉取失败 | 单池超时 3s；失败时 DiskFreeRatio=0.5（中性值不偏向） |
| watchdog in-memory counter 进程重启丢失 → 重新积累 15min | 设计取舍：保守不误报 > 误报告警；可后期改 DB 持久化 |
| `system_alerts` 表无 unique 防重，并发可能重复插入 | C2 写入路径用 `INSERT ... ON CONFLICT (cluster, kind) WHERE resolved_at IS NULL DO UPDATE`（部分唯一索引） |
| Live migration 期间 ceph IO 拉满影响其他 VM | 节流：批量 live 仍用 PLAN-037 并发限制（≤2 per source / ≤4 全局） |

## 工作量

| Phase | 估时 | 关键产物 |
|---|---|---|
| A. 多维度 PickNode | 1.5d | scheduler.go 扩 NodeInfo + scoreNode + 单测 + NodeTopology 暴露 score/disk |
| B. Live migration | 3d | EnableStateful service + endpoint × 2 + Migrate mode + UI toggle + 真机 e2e |
| C. Imbalance watchdog | 1d | migration 023 + worker + endpoint × 2 + AlertBanner |
| **合计** | **~5.5d** | |

## 备选方案

| 方案 | 与本方案差异 | 否决理由 |
|---|---|---|
| **DRS-style 全自动 rebalance** | watchdog 检测后自动迁移 | PLAN-037 已否决（blast radius 高，product 阶段不需要） |
| **接 prom + node-exporter 拿 cpu load** | scoreNode 用真实 load avg | 改造 prom 接入；本期 vm density 代理够用，减少新依赖 |
| **保留单维度 mem，只做 maintenance 过滤** | 缩到 OPS-042 一半范围 | 用户明确"a 都做"；半套不解决 disk 满 / cpu 饥饿 |
| **跳过现存 VM stateful 回填，只做新 VM live** | 缩 OPS-043 到 0.5d | 4 台现存 VM 永远只能冷迁移，违反"批量迁移可 live" 体验 |

## 不在范围

- prom / node-exporter 集成（独立 plan）
- live migration 跨集群（Incus 不支持）
- 自动重平衡 daemon
- VM CPU pinning / NUMA topology aware（更复杂；如需另立 plan）
- ceph rbd cache mode 调优

## 批注

- 2026-05-06 用户决策："a/b/c 都做"
- 2026-05-06 调查发现：现存 4 台 VM 未设 stateful → OPS-043 增加"回填"子阶段（B1）；vmc.5ok.co Incus 6.23 + ceph-pool 已就绪 → live migration 技术上可行，剩余风险在数据保护
- 2026-05-06 等用户对：(D1) 启动顺序（A→C 同步 / B 后做 / 全部并行）(D2) Live migration 默认 mode（auto vs cold + opt-in） (D3) 是否在 Phase B4 灰度后再 batch 回填生产 4 台（推荐）
