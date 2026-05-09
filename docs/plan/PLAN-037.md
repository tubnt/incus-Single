# PLAN-037 VM 部署位置可观测 + 后台批量迁移

- **status**: completed
- **createdAt**: 2026-05-06 13:00
- **approvedAt**: 2026-05-06 14:00
- **completedAt**: 2026-05-06 14:00（后端编译/vet/test 全绿；前端 typecheck/lint/vitest/build 全绿；vmc.5ok.co migration 022 应用 + binary 部署 + dist_hash 校验通过；新端点 smoke 401 通过）
- **priority**: P2
- **owner**: claude
- **relatedTask**: [OPS-040](../task/OPS-040.md)
- **referenceDoc**: PLAN-026（节点管理 UI）/ PLAN-020（HA evacuate）/ OPS-007（VM 详情页）

## 现状

### 后端

- `vms.location`（DB 字段）+ `service.VMReply.Location`（API） + `service/vm.go:213-216` 在 `Get/List` 路径中从 Incus 读取 location 写回。
- `internal/cluster/scheduler.go::PickNode`：按 **memory free ratio** 单维度排序选目标节点（60s 缓存）。无 CPU / disk / load 维度，无 maintenance 过滤。
- `internal/handler/portal/vm.go:1662 MigrateVM`：接 `POST /admin/vms/{name}/migrate`，**冷迁移**（stop → migrate stateless → start）。已有 best-effort 失败回退启动。
- `internal/handler/portal/vm_batch.go`：admin 已有批量 start/stop/restart/delete，但**未覆盖 migrate**。
- `cluster/scripts/batch-migrate.sh`：脚本存在但未被后端 jobs 调用——脚本路径只是 ops 手工兜底。
- `clusterNodeAdd / cluster_node_remove` 在 jobs runtime；**没有 cluster.vm.migrate-batch job kind**。

### 前端

- `cluster-vms-table.tsx:181`：admin/vms 列表已有 location 列（纯文本，**无排序、无筛选**）。
- `vm-detail.tsx`（admin）：右上角有"迁移" 按钮 → Sheet → NodePicker → `/admin/vms/{name}/migrate`。
- `nodes.tsx`：节点行点开后才能看到 instances 列表；**首屏没有节点 → VM 数 概览**。
- `vms.tsx`（user portal）卡：`{user}@{vm.node}` 在 caption 行小字；**不易识别"我的 VM 在哪台"**。
- 无"VM 分布不均衡"提示面板，无单击 rebalance 入口。

### 用户反馈解读

"VM 具体开在哪台服务器现在是不知道了" — 实际 location 字段处处都有，但：

1. user portal 视角太弱（caption 灰字），用户感知"看不到"
2. 运营视角无 **节点 → VM 数 / mem 用量** 的概览面板，必须挨个展开节点
3. 单台迁移流程 OK，**批量场景** 必须挨台点（>5 台时极痛）

### 业界对照

- DigitalOcean Droplet console：明示 region / hypervisor zone，但不透出物理 host（多租户）
- Vultr / Hetzner Cloud：节点级"Cluster"显式可见
- Proxmox VE：左侧树状视图直接 cluster → node → VM，节点是一级导航对象
- VMware vCenter / DRS：节点-VM 矩阵 + 自动均衡建议（DRS 高级）

我们的产品是**自营内部云优先 + 后期外部售卖**（参见 product_direction memory），admin 应当像 vCenter 一样能直观看到节点-VM 矩阵 + 显式迁移控制；用户视角只需明示"在哪个集群的哪台机"以满足合规知情。

## 方案

总体方向：**复用现有 location/migrate 后端**，新增批量 + 可观测层；**不引入** auto-rebalance daemon，仅做"一键应用建议"（人工触发）。

### Phase A — 后端批量迁移 + 节点-VM 概览 endpoint

A1. **Job kind**：`cluster.vm.migrate-batch`
- migration 020：扩展 `provisioning_jobs.kind` CHECK 约束加 `cluster.vm.migrate-batch`
- `internal/service/jobs/vm_migrate_batch.go`（新）：参数 `{cluster, items: [{vm_name, project, target_node}]}`；并发度限制 **同 source-node 最多 2 个并发**（避免 IO 冲击），跨 source-node 总并发 4
- 每台执行：复用 `MigrateVM` 内部逻辑，提取为 `vmSvc.Migrate(ctx, cluster, project, name, target)` 服务方法（消除 handler 内联）
- step marker：`item N/M start <vm> -> <node>` / `item N/M done` / `item N/M failed: <err>`
- 失败补偿：单个 VM 失败不阻塞批次；最终 `partial` / `succeeded` 状态汇总

A2. **Endpoint**：`POST /admin/vms:migrate-batch`
- body `{cluster: required, items: [{vm_name, project, target_node}], concurrency_per_source?: 2}`
- 校验：每个 item 走现有 `safename` 校验；同 batch 内每个 (cluster,project,vm_name) 唯一
- 返回 `{job_id}`；前端复用现有 SSE
- step-up gated（destructive 批量）+ admin role + audit `vm.migrate-batch`

A3. **节点概览 endpoint**：`GET /admin/clusters/{name}/nodes/topology`
- 返回 `{nodes: [{server_name, status, vm_count, vm_by_status:{running,stopped,...}, mem_used, mem_total, cpu_total, maintenance, evacuated, score: free_ratio}]}`
- Server 端 fan-out：复用 `Scheduler.GetNodes` + 一次 `/1.0/instances?recursion=1&target=*` 拉取
- 60s 缓存（与 scheduler 同步）

A4. **不均衡分析**：`GET /admin/clusters/{name}/imbalance-suggestions`
- 算法：节点 mem 利用率 std deviation > 阈值时（默认 20%），贪心算法选"高负载节点 → 候选 VM → 低负载目标"
- 输出 `{suggestions: [{vm_name, project, source_node, target_node, reason}], stats: {mean_util, stddev, max_diff}}`
- 不直接执行；仅供前端 RebalancePanel 展示
- 实现位置：`internal/service/rebalance/`（新包，纯函数 + 单测）

### Phase B — 前端可观测层

B1. **admin/nodes 顶部 VM 分布 strip**（`web/src/app/routes/admin/nodes.tsx`）
- 顶部新加 `NodeTopologyStrip`：每个节点一个 chip（节点名 + VM 数 + mem util bar + 维护态徽章）
- 点击 chip 跳到 `admin/vms?node=X`（filter）
- 数据源：`GET /admin/clusters/{name}/nodes/topology`

B2. **admin/vms 列表筛选/排序**（`features/vms/components/cluster-vms-table.tsx`）
- location 列加 sort + 一行 facet filter（dropdown：select node）
- URL search param `?node=X` 同步 filter，配合 B1 chip 跳转
- BatchToolbar 新加按钮"迁移到..."：点开 NodePicker dialog（多选目标分布）

B3. **批量迁移 Sheet**（新组件 `features/vms/components/migrate-batch-sheet.tsx`）
- 触发：BatchToolbar "迁移到..."
- 流程：选择 target 策略（manual single target / round-robin distribute / auto-balance）→ 预览 plan → 提交 → SSE JobProgress
- 跨 project 校验：与 cluster-vms-table 现有按 project 分组逻辑对齐

B4. **VM 详情页 header location 显眼化**（`web/src/app/routes/admin/vm-detail.tsx`）
- header description 区把 `node` 从弱灰字升级为 chip + 链接到 `/admin/nodes?focus=X`

B5. **portal VM 卡 node 标签前移**（`web/src/app/routes/vms.tsx`）
- VMCard 主行：在 cluster_display_name 后插入 `<NodeBadge>` chip（subtle variant + Server icon）
- 用户能在卡片主行就看到 "[运行中] vm-abc · cn-sz-01 · node-3"

B6. **不均衡建议面板**（admin/nodes 页底部 / 或独立 sub-route）
- `RebalancePanel`：调 `imbalance-suggestions`，展示 std dev 状态 + suggestion 表格 + "应用全部 (N 项)" 按钮
- 应用 → 调 `vms:migrate-batch`，传整张 suggestions 表

B7. **i18n**：admin.nodes.topology.* / vm.migrate.batch.* / vm.node 等 ~25 条键，zh+en

### Phase C — 联调 + 测试 + 文档

- 真机 vmc.5ok.co：5 节点（4 健康 + 1 维护态）+ 30 台 VM 测试批量迁移 + 不均衡建议执行；故意造一台 mem util 95% 触发建议
- 后端：`go test ./internal/service/rebalance/...`（贪心算法单测）+ `go test ./internal/service/jobs/...`（vm_migrate_batch markers 单测）
- 前端：vitest 覆盖 NodeTopologyStrip 渲染 + RebalancePanel suggestion 渲染
- changelog 加条目

## 风险

| 风险 | 缓解 |
|---|---|
| 大批量迁移 IO 风暴打挂源节点 | A1 限并发：每 source-node ≤ 2；总 ≤ 4；可后续按 metrics 动态调 |
| `MigrateVM` 内联逻辑提取后破坏现有路径 | A1 提取时只做"包装函数"，handler 行为字节相同；增量单测覆盖 |
| 节点详情 fan-out 慢（60s 缓存未命中时） | A3 缓存 + topology endpoint 用 `recursion=1` 一次取所有 instances |
| 跨 project VM 批量分组错误（已踩过） | A2 同 project 校验 + 前端按 project 分组（沿用 cluster-vms-table 现有模式）|
| 不均衡建议执行后状态飘忽（迁移过程中重复触发） | RebalancePanel "应用" 后强制 invalidate query + 5min 内不重复给同 VM 出建议 |
| user portal 暴露 node 名给租户算合规风险？ | 与 product_direction 一致：内部云优先，node 名非敏感（已在 caption 暴露过）；外部售卖时按 cluster 隐藏 node 详细标签——保留 feature flag |
| live migration 期望落空 | 文案明示"冷迁移：会停机 30s-2min"，与 OPS-008 #5 注释一致 |

## 工作量

| Phase | 估时 | 主要文件 |
|---|---|---|
| A. 后端 batch job + topology + imbalance | 1.5d | `db/migrations/020_*.sql`, `internal/service/jobs/vm_migrate_batch.go`(新), `internal/service/rebalance/`(新), `internal/handler/portal/vm_batch.go` 扩展, `internal/handler/portal/clustermgmt.go` 加 topology endpoint |
| B. 前端可观测 + 批量迁移 Sheet + 不均衡面板 | 2d | `admin/nodes.tsx`(strip), `cluster-vms-table.tsx`(sort+filter), `migrate-batch-sheet.tsx`(新), `RebalancePanel.tsx`(新), `vms.tsx`(NodeBadge), i18n 25 条 |
| C. 真机联调 + 测试 + 文档 | 0.5d | vmc.5ok.co 5 节点真测 + go test + vitest + changelog |
| **合计** | **~4d** | |

## 备选方案

| 方案 | 与本方案差异 | 否决理由 |
|---|---|---|
| **DRS-style 持续 rebalance daemon** | 后台 worker 周期 rebalance + 自动迁移 | blast radius 大；需配置策略+回退；产品阶段用不上，先做"建议+人工"过渡 |
| **Live migration 启用** | 启用 Ceph block + QEMU live-patch | 改 ceph 配置 + 重 QEMU 包，影响所有节点；独立 plan 评估 |
| **维持现状只补 user 卡 NodeBadge** | 仅 B5 单点改动 | 不解决"运营批量迁移痛苦" 这个真痛点 |
| **第三方 vCenter-style UI 包** | 引入 e.g. open-source admin dashboard | 与现有 Linear 风格不符；维护成本高 |

## 不在范围

- live migration 启用（独立评估）
- 自动 rebalance daemon（仅人工触发）
- 监控指标驱动调度（PickNode 改用 prom 数据；独立 plan）
- 用户端 admin 类操作（用户不能迁移自己的 VM）

## 批注

- 2026-05-06 用户提出："VM 具体开在哪台服务器现在是不知道了；希望可观测 + 后台控制迁移"
- 2026-05-06 等待用户决策：(a) 是否同意 P2 优先级 (b) 是否同意"先建议+人工"路线否决 DRS daemon (c) 用户端 NodeBadge 是否启用（合规取舍）
