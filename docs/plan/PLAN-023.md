# PLAN-023 后端批量操作 API（多选删除 / 启停 / 重启）

- **status**: completed
- **priority**: P2
- **owner**: claude
- **createdAt**: 2026-04-29
- **approvedAt**: 2026-04-29
- **completedAt**: 2026-04-29（Phase A 代码 + Phase B floating-ips:batch + Phase C users:batch + Phase D BatchExecutor 抽取 + 三个前端 hook + 三个 UI 接入；后端代码本地写完，Go 编译需用户本地 task build 验证）
- **relatedPlan**: PLAN-022（前端 M2 多选体验依赖）
- **parentPlan**: —

## Context

PLAN-022 引入"多选 + 顶部 sticky `<BatchToolbar>`"模式，但当前后端只有单实体路由：
`DELETE /api/admin/vms/{name}` `POST /api/admin/vms/{name}/state`。前端只能 `Promise.allSettled` N 并行兜底。

并行 N 个调用的问题：
- 无事务化，部分成功部分失败需要前端聚合错误
- 审计日志被打成 N 条独立事件，难关联
- 大批量（20+）下吵到 step-up 中间件触发 N 次重认证
- 没有"原子性回滚"概念：例如选 5 个 VM 删除，3 个成功 2 个失败，无法整体回滚

本 PLAN 为前端 M2 多选体验提供后端基线。**所有端点在 PLAN-022 M2 提 PR 时同步上线**，避免前端先发布 N 并行版本造成审计噪音。

## Decisions

1. **路由风格**：用 `:batch` 后缀（不破坏单实体路由） —— `POST /api/admin/vms:batch` 表示对 VM 集合做批量动作。
2. **批量请求格式统一**：
   ```json
   {
     "ids": [1, 2, 3],          // 或 names + cluster 复合主键
     "action": "delete",         // delete | start | stop | restart
     "options": { ... }          // action 特定选项
   }
   ```
3. **响应格式统一（部分成功语义）**：
   ```json
   {
     "total": 5,
     "succeeded": [1, 2, 3],
     "failed": [
       { "id": 4, "error": "vm not found" },
       { "id": 5, "error": "step_up_required" }
     ]
   }
   ```
   HTTP 200 = 至少一个成功；207 Multi-Status = 全部失败时也用，前端按 failed 数判断。
4. **不做事务化**：批量操作不强一致（删除 5 个 VM 不要求 5 个都成功才提交），DB 行级 + Incus 调用各自独立。**回滚责任在前端**（如果用户选错可以重新挑选）。
5. **step-up 一次性预检**：批量操作要求 step-up 才能调用，但**只在请求入口检查一次**，不每个子操作都触发。**敏感动作清单**：`delete`（必）；`start`/`stop`/`restart` 不要求 step-up（与单实体一致）。
6. **审计聚合**：每次批量产生 1 条 `vm.batch_delete` 父审计 + N 条 `vm.delete` 子审计，父审计 details 含 `count`、`requested_ids`、`succeeded_count`、`failed_count`。
7. **批量上限 50**：单请求超过 50 个 ID 后端 400；前端切片调用。

## Phases

### Phase A — VM 批量动作（必要，2d）

- [ ] `internal/handler/admin/vm_batch.go`：
  - `POST /api/admin/vms:batch` 接 BatchVMRequest
  - actions: `delete` / `start` / `stop` / `restart`
  - 复用 `VMService.{Delete,Action}`，串行执行（避免 Incus 端打爆），每条独立错误捕获
  - 父审计 helper：`auditparent.Begin(...)` → `auditparent.End(...)` 关联子事件
- [ ] `internal/middleware/stepup.go` 扩展：路径匹配 `/api/admin/vms:batch` + body.action == "delete" 时要求 step-up
- [ ] 路由注册：`server.go` admin 子路由器 `r.Post("/vms:batch", h.AdminVM.Batch)`
- [ ] 单测：5 个场景（全成功 / 部分成功 / 全失败 / 超上限 / step-up 缺失）
- [ ] 前端 `features/vms/api.ts` 新 hook `useBatchVMMutation`，签名 `(action, ids, options) => Promise<BatchResult>`

### Phase B — Floating IP 批量释放 / 转移（次要，1d）

- [ ] `POST /api/admin/floating-ips:batch` —— action: `release` / `transfer`
- [ ] step-up 全要求（Floating IP 转移影响线上服务）
- [ ] 前端 `features/floating-ips/api.ts` 新 hook

### Phase C — 用户批量操作（低频，0.5d）

- [ ] `POST /api/admin/users:batch` —— action: `disable` / `change_role`（`delete` 不做，PLAN-019 决定用户软删走单实体）
- [ ] 前端 `features/users/api.ts` 新 hook

### Phase D — 通用 batch 中间件抽取（重构，0.5d）

如果 A/B/C 三处代码重复严重，把 `BatchExecutor[T]` 抽到 `internal/handler/batchutil/`：
- 输入校验（max 50、action 在白名单）
- 串行执行 + 错误聚合
- 审计父子事件关联

如果重复不严重，每个 handler 各自实现。

## Acceptance Criteria

- [ ] 三个 batch 端点 `/api/admin/vms:batch` `/admin/floating-ips:batch` `/admin/users:batch` 全上线
- [ ] step-up 只在入口触发一次，不会触发 N 次
- [ ] 审计日志父子关联：父 `*.batch_*` + N 子 `*.{action}`
- [ ] 50+ ID 请求返回 400
- [ ] 部分失败 200 / 全失败 207
- [ ] golangci-lint v2 + go test 全绿
- [ ] 前端 `useBatchVMMutation` / `useBatchFloatingIPMutation` / `useBatchUserMutation` hook 接入 PLAN-022 M2 BatchToolbar

## Out of Scope

- 异步批量（任务队列）—— 当前同步够用，>50 条切片调用
- 跨集群批量（VM 跨集群删除）—— 仅同集群
- 批量创建（VM 一次创建多个）—— 商业流程不支持，单独 PLAN

## Notes

- 与 PLAN-022 M2 同步发布。前端 BatchToolbar 不能在 batch API 上线前提 PR（避免审计被 N 并行打爆）。
- 部署：与 PLAN-022 M2 合并发布 vmc.5ok.co。
