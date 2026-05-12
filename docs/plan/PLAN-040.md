# PLAN-040 备份与灾备一期 —— 策略 / 保留 / S3 后端

- **status**: rejected
- **createdAt**: 2026-05-09 13:30
- **approvedAt**: (未批准)
- **rejectedAt**: 2026-05-09 14:00
- **rejectReason**: 用户决策搁置，先做 PLAN-041/042/043；备份留二期立项
- **relatedTask**: INFRA-008

## 现状

### 已有

- `internal/handler/portal/snapshot.go`：snapshot CRUD + restore（admin + portal 双路由），底层走 `/1.0/instances/{name}/snapshots` Incus API，单次操作，不带策略
- `internal/repository/system_alert.go`：PG `system_alerts` 表 + repo 已就绪（PLAN-039 留下），`(cluster, kind)` 复合唯一约束 + `UpsertActive` / `ResolveActive` / `Dismiss`
- `internal/worker/`：7 个生产 worker（audit_cleanup / apitoken_cleanup / vm_reconciler / event_listener / healing_expire / vm_trash_purger / firewall_reconcile / imbalance_watchdog），周期模式成熟
- `internal/service/jobs/`：异步 job runtime（pool size 4），主路径是 vm_create / cluster_node_add 等
- `cfg.Monitor.CephSSHHost / CephSSHUser / CephSSHKey`：现有 Ceph 集成走 SSH 通道（操作 OSD/MON），**没有 RGW S3 客户端**
- migration 已到 024（024_system_alerts.sql）

### 缺失

- 无周期备份策略表，snapshot 都是手动一次性
- 无保留期（retention）逻辑
- 无 S3 / Ceph RGW 后端导出，全量 export 都没做过
- 无独立备份 worker，全量 export 一台 VM 可能 10-100GB，挤占 jobs.Runtime（pool 4）会拖死 vm_create

## 方案

### 一期范围（本 plan）

只做"周期 snapshot + 保留 + 异地（S3/Ceph RGW）全量备份"。**不做**：跨集群 RBD mirror、增量备份、应用一致性 freeze（这些拆到独立 PLAN-044）。

### 数据模型

新 migration `025_backup_policies_runs.sql`：

```sql
-- 备份目标（S3 / Ceph RGW / 本地 path）
CREATE TABLE backup_targets (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  kind            TEXT NOT NULL CHECK (kind IN ('s3', 'local')),
  endpoint        TEXT,             -- s3 endpoint，本地路径放 local_path
  region          TEXT,
  bucket          TEXT,
  prefix          TEXT,             -- 对象前缀（如 backups/vm-{name}/）
  access_key_enc  TEXT,             -- AES-256-GCM 加密（复用 OPS-022 同 key）
  secret_key_enc  TEXT,
  local_path      TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 备份策略（按 VM / 按 user 全部 VM / 全集群）
CREATE TABLE backup_policies (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  scope_kind      TEXT NOT NULL CHECK (scope_kind IN ('vm', 'user', 'cluster')),
  scope_id        BIGINT,           -- vm.id / user.id / cluster.id；scope='cluster' 时 NULL
  cluster_id      BIGINT REFERENCES clusters(id),
  cron_expr       TEXT NOT NULL,    -- '0 3 * * *' 每天 03:00
  mode            TEXT NOT NULL CHECK (mode IN ('snapshot', 'export')),
  -- snapshot: 调 Incus snapshot API（仅本机存储，速度快）
  -- export:   incus export 全量 tarball → 推 backup_target
  target_id       BIGINT REFERENCES backup_targets(id),    -- mode='export' 必填
  retention_count INT NOT NULL DEFAULT 7,                  -- 保留几份
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at     TIMESTAMPTZ,
  next_run_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX backup_policies_due_idx ON backup_policies (next_run_at) WHERE enabled = TRUE;

-- 备份执行记录
CREATE TABLE backup_runs (
  id              BIGSERIAL PRIMARY KEY,
  policy_id       BIGINT NOT NULL REFERENCES backup_policies(id),
  vm_id           BIGINT NOT NULL REFERENCES vms(id),
  status          TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'expired')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  size_bytes      BIGINT,
  target_path     TEXT,             -- snapshot name 或 s3 object key
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX backup_runs_vm_idx ON backup_runs (vm_id, started_at DESC);
CREATE INDEX backup_runs_policy_idx ON backup_runs (policy_id, started_at DESC);
```

### 后端代码

1. **新依赖**：`go get github.com/minio/minio-go/v7`（标准 S3 兼容客户端，与 Ceph RGW 互通）。
2. **`internal/repository/backup.go`**：3 表对应的 CRUD + `ListDuePolicies(ctx, now)` + `Lock(policyID)` 行级锁防重入。
3. **`internal/service/backup/`**：
   - `target_s3.go`：minio-go 封装上传 / 列举 / 删除
   - `executor.go`：核心两个动作 —— `runSnapshot(ctx, policy)`、`runExport(ctx, policy)`；export 流式 `incus export` stdout → `S3.PutObject` 走 multipart（>5MB 分段）
   - `retention.go`：执行后扫 backup_runs，超过 retention_count 的 status='success' 行倒序删，**先删 S3 对象、后改 DB 状态='expired'**
4. **`internal/worker/backup_scheduler.go`**：5 分钟 tick → `ListDuePolicies` → 每条 spawn 独立 goroutine（**不复用 jobs.Runtime**，避免挤 pool size 4）→ 全局并发限 3（信号量 channel）→ run + retention
5. **`internal/handler/portal/backup.go`**：admin 路由
   - `GET/POST/PUT/DELETE /admin/backup-targets`
   - `GET/POST/PUT/DELETE /admin/backup-policies`
   - `POST /admin/backup-policies/{id}/run-now` 立即触发（写一行 backup_run，由 scheduler 下一 tick 拾起 / 或同步 enqueue）
   - `GET /admin/backup-runs?policy_id=&vm_id=&status=` 历史
   - portal 路由（用户视角）：`GET /portal/vms/{name}/backups` 仅看属于自己的 VM 的备份记录

### 前端

- 新页面 `/admin/backups`：3 tab —— Targets / Policies / Runs
- VM 详情页 Snapshots tab 加 Backups 子区（用户视角）
- 表单复用现有 shadcn 组件 + Cron 表达式输入框（用 `cronstrue` 翻译成人话提示）

### 凭据加密

S3 access_key / secret_key 用 OPS-022 同一把 AES-256-GCM key（`auth.EncryptPassword` 复用，不另开 key 管理）。读出时按需解密在 service 层完成，repository 只过密文。

### 二期（不在本 plan）

跨集群 RBD mirror / zfs send|recv / 增量备份 / 应用一致性快照（pre/post hook）→ 立 PLAN-044。

## 风险

1. **大 VM 全量 export 阻塞**：100GB VM 全量 export ≈ 30 分钟，独立 worker pool（并发 3）+ 单 run 超时 2h；超时直接 abort 并标 failed
2. **incus export 流式输出协议**：Incus 6.x 是 multipart 响应，需要确认 `client.RawGet` 是否能直接 io.Pipe 给 minio-go；若不行需经 tmp 文件落地（占盘空间预警）—— investigate phase 已确认 RawGet 走 net/http body，可直接 streaming
3. **S3 凭据泄漏**：误把 secret_key 写日志；service 层禁 fmt.Sprintf("%+v", target)；structured log 时只输出 endpoint+bucket
4. **保留期误删**：retention 删除前必须 `WHERE policy_id=? ORDER BY started_at DESC OFFSET retention_count`，单元测试覆盖"恰好等于 N 份不删"边界
5. **凭据解密失败导致备份永挂**：解密报错时把策略标 disabled + system_alert 写入，避免每 tick 5min 都失败一次
6. **RGW 与 S3 协议偏差**：Ceph RGW 在 PutObject 校验 SSE 头时严格，初版仅用 v4 签名 + 不开 SSE，后续若客户要求再加
7. **migration 25 在生产 PG 没有 on conflict 约束的兼容问题**：使用 PG 14+，本项目其他迁移均如此，无新增风险

## 工作量

- 后端：repo + service + worker + handler ≈ 4-5 天（含凭据加密 + retention 单元测试）
- 前端：3 tab 页 + VM 详情页插槽 ≈ 2-3 天
- 集成测试：用 minio docker 起单测 S3 + 真实 Incus（CI 已有 testcontainers 习惯）≈ 1 天
- 文档：admin runbook ≈ 0.5 天
- **合计 ≈ 8-9 天**（一人）

## 备选方案

| 方案 | 优点 | 缺点 | 选用 |
|---|---|---|---|
| A. minio-go + 自实现 retention（本方案） | 单一依赖，完全可控，与 Ceph RGW 互通 | 自己维护 retention 逻辑 | ✅ |
| B. 引入 restic 作为外部进程 | 内置 dedup + 加密 + retention | 多一个 binary，跨平台打包麻烦，凭据双管 | ❌ |
| C. 直接用 Ceph RBD snapshot + image clone | 速度极快（COW） | 必须 Ceph 后端，单机/zfs 客户用不了 | ❌（限制太死） |
| D. PBS 风格自研 dedup | 降存储成本 | 工作量 ×3，本期超范围 | 推迟到 v2 |

## 批注

（待用户批注）
