# INFRA-007 VM provisioning 异步化 + SSE 进度流

- **status**: completed
- **completedAt**: 2026-04-30
- **priority**: P1
- **owner**: claude
- **createdAt**: 2026-04-30
- **plan**: [PLAN-025](../plan/PLAN-025.md)

## Description

把 VM 创建 / 重装从 sync HTTP 阻塞 30–90s 改为入队即返 202，前端通过 SSE 看进度。
顺手修复 `cluster.Client.WaitForOperation` 两个隐藏 bug（10s client timeout 撞 120s server-wait + 不解析 op.status）。

## Acceptance criteria

- 用户付款 VM 创建：handler 立即返回 202 + job_id；前端 5 阶段进度展示；密码完成时 reveal
- Reinstall 同形态异步化（保留 probe / pre-pull 同步前置数据保护）
- Admin direct create 通过同一 jobs runner（保留同步包装入口给 admin batch 场景）
- 失败路径完整 rollback：refund + 释放 IP + cancel order；幂等不双倍退款
- 进程崩溃恢复：启动 sweeper 把 `running` 老 row 标 partial 并 rollback
- `WaitForOperation` 真正等到 op.status=Success；Running/Failure 正确处理
- 前端：DESIGN.md token 接入；零 hex 字面量；零 arbitrary value
- 后端：`go vet ./... && go test ./...` 全绿；audit-coverage 不掉

## ActiveForm

实现 VM provisioning 异步化 + SSE 进度流

## Dependencies

- **blocked by**: (none)
- **blocks**: PLAN-026 / INFRA-002（节点管理 UI 复用 jobs runner + SSE 模式）

## Notes

PLAN-025 调研阶段已完成调用链追溯（Serena/Graph）+ 失败矩阵 + SSE 协议设计 + DB schema。
关键发现：`vms.name` 无 UNIQUE 约束，migration 015 须先 dedupe `gone/deleted` 历史行。
