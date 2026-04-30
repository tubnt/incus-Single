# PLAN-025 VM provisioning 异步化 + SSE 进度流

- **status**: completed
- **priority**: P1
- **owner**: claude
- **createdAt**: 2026-04-30
- **completedAt**: 2026-04-30（go vet clean / go test 全绿 / 前端 tsc 0 / vitest 37/37 / build OK / audit 73 writes 74 audits）
- **referenceDoc**: `DESIGN.md`、`docs/architecture.md`、`/pma`、`/pma-go`、`/pma-web`

## Context

当前 `OrderHandler.Pay` / `VMHandler.Reinstall` / `AdminVMHandler.CreateVM` 三个调用站点全部同步阻塞 `VMService.Create`/`Reinstall`，HTTP 连接握 30–90s。前端 `purchase-sheet.tsx` 注释直接坦白 "10–15 s while VM provisioning runs synchronously"。
深度审查发现两个隐藏 bug 让"同步"实际上是 fake-wait：

1. `cluster.Client.httpClient.Timeout = 10s` vs `WaitForOperation` 调 `?timeout=120` —— 客户端先 timeout，Incus 端 op 继续跑，handler 误判失败。
2. `WaitForOperation` 只判 `StatusCode != 200`，不解析 `metadata.status` —— Incus 在 op 仍 `Running` 时也返回 200，"成功"返回时 op 可能未完成。

这两个 bug 让现有 `vm_reconciler` 60s 兜底成为唯一的真状态来源；HTTP 同步路径产物常带漂移。**不修这两个 bug，做异步等于换皮 fake-wait。**

## 范围

| 模块 | 文件 | 改动 |
|---|---|---|
| migration | `db/migrations/015_provisioning_jobs.sql` | 新建 `provisioning_jobs` + `provisioning_job_steps` 两表；`vms` 加 `UNIQUE(cluster_id, name)`（先 dedupe `gone/deleted` 历史行） |
| model | `internal/model/models.go` | `ProvisioningJob` / `ProvisioningJobStep` / 状态常量 |
| repo | `internal/repository/provisioning_job.go`（新） | CRUD + step append + status update + 启动 sweep |
| cluster client | `internal/cluster/client.go` + `manager.go` | 新增 `LongClient`（无 client-level timeout，依赖 ctx）；`WaitForOperation` 改循环并解析 `op.status` |
| service/jobs | `internal/service/jobs/runner.go`（新） + `executor.go`（新） | 通用 step runner + `vm.create` / `vm.reinstall` 两个 executor |
| worker | `internal/worker/jobs_runner.go`（新） | per-cluster N=4 worker pool + crash recovery sweep |
| handler | `internal/handler/portal/jobs.go`（新） | `GET /portal/jobs/{id}` + `GET /portal/jobs/{id}/stream` (SSE) |
| handler 改造 | `order.go` / `vm.go::Reinstall` / `vm.go::AdminVMHandler.CreateVM` | 同步前置检查 → 入队 → 返回 202 |
| 中间件 | `internal/server/server.go` + `middleware/` | SSE 路径 bypass `RateLimit`；per-user SSE conn ≤ 4 |
| frontend lib | `web/src/shared/lib/sse-client.ts`（新） | 薄封装 EventSource + Last-Event-ID 重连 |
| frontend feature | `web/src/features/jobs/api.ts`（新）+ `components/job-progress.tsx`（新） | useJobQuery + useJobStream + 进度 UI |
| frontend UI | `purchase-sheet.tsx` / `billing.tsx::OrderRow` / VM 详情 reinstall 按钮 | 接 jobs；进度展示；密码 reveal 接 `job.result` |
| i18n | `web/src/locales/{zh,en}.json` | provisioning.* 新 key |
| audit | service / worker | `vm.provisioning.{started,succeeded,failed}` 三段独立 audit |
| 测试 | service/jobs + worker + repo + handler integration | happy path / image-pull-fail rollback / refund 幂等 / crash recovery / SSE resume |

## 设计约束（DESIGN.md 优先 > pma-web）

- 颜色全部读 `@theme` token：进度 step 用 `text-text-tertiary` / `text-status-success` / `text-status-error`；进度条背景 `bg-surface-2`；fill `bg-status-success` 或 `bg-accent`。
- 圆角：进度卡 `rounded-md`(6px)，整体 panel `rounded-lg`(8px)。
- 字体：step 标题 `text-small font-emphasis`，详情 `text-caption text-text-tertiary`。
- 严禁 hex 字面量、严禁 `text-[12px]` / `bg-[#xxxx]` 之流的 arbitrary value。

## 不在范围（显式排除）

1. quota 强制（pre-existing 漏洞，单立 task）
2. `vms.password` plaintext DB 存储 vs "shown only once" UX 矛盾（pre-existing，单立 task）
3. `VMHandler.CreateService` 死代码清理（前端无引用，单立 cleanup task）
4. `AdminVMHandler.CreateVM` 仍保留 sync 模式入口（admin batch 场景便利，但内部走相同 jobs runner —— 即"同步包装异步"模式，旧调用站点零改动）

## 状态机

**Order**：`pending → paid → provisioning → active`（失败：`provisioning → cancelled` + 退款）

**ProvisioningJob**：`queued → running → succeeded | failed | partial`
- `partial` = 进程崩溃后 sweeper 标记，需要人工或自动 rollback
- `failed` = step 主动报错，rollback 已执行

**Step**：`pending → running → succeeded | failed | skipped`

## SSE 协议

- 路径：`GET /api/portal/jobs/{id}/stream`
- 鉴权：`ProxyAuth + UserFromEmail`，handler 内验 `job.user_id == ctx.userID`（admin 可看全部）
- Headers：`Content-Type: text/event-stream`、`Cache-Control: no-cache`、`X-Accel-Buffering: no`、`Connection: keep-alive`
- 心跳：每 15s 注释行 `:keepalive\n\n`
- 事件格式：
  ```
  id: <step.seq>
  event: step
  data: {"seq":3,"name":"image_pull","status":"running","detail":"..."}
  ```
- 终态：
  ```
  event: done
  data: {"status":"succeeded"}
  ```
  服务端随后 close。客户端 `GET /portal/jobs/{id}` 取 `result`（含 password）。
- Reconnect：客户端 `Last-Event-ID: N` header → 服务端从 `seq > N` 重放
- 限流：bypass `RateLimit`；per-user 同时 SSE 连接 ≤ 4

## 失败补偿矩阵

| 失败时机 | rollback |
|---|---|
| `allocate_ip` step | release IP；AdjustBalance 退款；order=cancelled |
| `submit` step（POST /1.0/instances 失败） | release IP；refund；order=cancelled；vm row 删 |
| `image_pull` / `wait_create` step | submit 已生成 instance → 删 instance + release IP + refund + cancel |
| `start` step | 删 instance + 释放 IP + 退款 + cancel |
| 进程崩溃（job=running 老 row） | sweeper 60s tick；超 30min 的 row 标 partial → 触发同样 rollback |

**幂等**：`provisioning_jobs.refund_done_at IS NULL` guard 保证 worker 重跑不双倍退款。

## 任务拆分

- [x] **PLAN-025.A**：migration 015 + model + repo
- [x] **PLAN-025.B**：cluster.Client `WaitForOperation` 修复 + LongClient + 单测
- [x] **PLAN-025.C**：service/jobs runner + executor + worker bootstrap + recovery sweeper
- [x] **PLAN-025.D**：handler 三处异步化 + jobs SSE handler
- [x] **PLAN-025.E**：frontend sse-client + features/jobs + purchase-sheet / billing 接入
- [x] **PLAN-025.F**：测试矩阵（unit + integration）+ typecheck/lint/build/vet 全绿
- [x] **PLAN-025.G**：changelog + Serena memory

## 验收

- 用户购买 VM：handler < 200ms 返 202 + job_id；前端展示 5 步进度；完成后 SecretReveal 显示密码；中途刷新页能续 watch
- 失败路径：image 拉取失败 → toast "镜像不可达，已退款"；订单 cancelled；transactions 仅 1 条 refund
- 服务重启：`provisioning_jobs WHERE status='running'` 启动后 sweeper 兜底
- `WaitForOperation` 单测：op `Running` 返回不视为成功；op `Failure` 报错；op `Success` 才 OK
- 前端：typecheck 0 / vitest 全绿 / build 通过 / 无 hex 字面量 / 无 arbitrary value
- 后端：`go vet ./...` clean / `go test ./...` 全绿（含新 integration）/ audit-coverage 不掉
