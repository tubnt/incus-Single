# PLAN-029 admin/vms 跨 project 列表 0 VM 修复（OPS-027）

- **status**: completed
- **completedAt**: 2026-04-30
- **priority**: P1
- **owner**: claude
- **createdAt**: 2026-04-30
- **referenceDoc**: PLAN-027 / OPS-022 测试发现
- **task**: [OPS-027](../task/OPS-027.md)

## Context

PLAN-028 完成后做全功能 UI 回归测试，发现生产 vmc.5ok.co `/admin/vms` 列表显示 0 VM，但 admin/monitoring 显示 5 个 VM、portal/vms 显示 1 个 (MyVM)。三条路径不一致暴露 bug。

根因：PLAN-027 重构 ClusterConfig 走 DB-load 之后，`clusterFromDB` 注释明确"projects 暂时维持空数组"，但 ListClusterVMs (handler/portal/vm.go:799-805) 用 `cc.Projects` 迭代查 instances，cc.Projects=nil 时 fallback `[]string{"default"}`，不包含 customers project，导致 customers 里的 VM 全部漏掉。

env-bootstrap 路径硬编码 `[default, customers]`（config/config.go:168），重启后被 DB-load 覆盖。

## 范围

| 模块 | 改动 |
|---|---|
| `cmd/server/main.go::clusterFromDB` | 加 `Projects: defaultProjectsFor(c.DefaultProject)` |
| `cmd/server/main.go::defaultProjectsFor` (新) | 返回 `[default, DefaultProject]`（去重）|
| 测试 | 已有的 cluster 单测覆盖；handler 测试已绿 |
| 部署 | 本地 build → file_deploy → systemctl restart incus-admin |

## 设计约束

- **跟 env 路径语义等价**：env 写死 [default, customers]，DB fallback 同样从 default + DefaultProject 推；DefaultProject="customers" 时结果完全一致
- **不要在 DB schema 加列**：避免迁移成本；未来需多 project 自定义时再加 projects_jsonb 列（task 未开）
- **不破坏单一 project 假设**：DefaultProject == "default" 时去重，结果 `["default"]`

## 任务拆分

- [x] **PLAN-029.A** 改 clusterFromDB + 加 defaultProjectsFor helper
- [x] **PLAN-029.B** go vet / unit / integration / build 全绿
- [x] **PLAN-029.C** 部署生产并验证 admin/vms 显示 6 个 VM (含 1 stopped vm-4609c0)
- [x] **PLAN-029.D** PR + CI + merge

## 验收

- 生产 vmc.5ok.co `/api/admin/clusters/cn-sz-01/vms` 返回 count >= 5
- `Projects` 字段含 customers 项目里的 VM
- node1-5 正常运行不掉线
- go test 全绿

## 不在范围

- clusters 表加 projects_jsonb 列 + UI（开 P2 后续 task）
- portal/vms cloud-init.password 字段过滤（开 P2 task SEC-002）
