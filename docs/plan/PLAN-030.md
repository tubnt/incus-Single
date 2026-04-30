# PLAN-030 全功能 UI 测试遗留打磨（OPS-028）

- **status**: completed
- **completedAt**: 2026-04-30
- **priority**: P2
- **owner**: claude
- **createdAt**: 2026-04-30
- **referenceDoc**: OPS-027 测试报告 + /pma-cr PR#9/#10 review
- **task**: [OPS-028](../task/OPS-028.md)

## Context

OPS-027 完成后做全站 UI 回归测试 + /pma-cr 收口，发现 1 个 P2 + 4 个 P3 + 3 个 CR 改进项。打包成单 PR 一次清理。

## 范围

| 子项 | 来源 | 严重度 | 改动 |
|---|---|---|---|
| M1 | CR | MEDIUM | `defaultProjectsFor` 加 4-case table test |
| L1 | CR | LOW | `AddNode` body 的 NIC/桥名加 `safename` validator（防御深度，shellQuote 已防 injection） |
| M2 | UI 测试 | P2 / SEC-002 | admin VM list/detail 响应裁掉 `config.user.cloud-init`（含明文初始 root 密码） |
| P3.1 | UI 测试 | P3 | `billing.tsx` Invoices 表头 i18n key 缺失 → 加 defaultValue 兜底 |
| P3.2 | UI 测试 | P3 | `admin/orders` User/Product 列展示 email / 产品名（map by ID） |
| P3.3 | UI 测试 | P3 | `admin/tickets` 用户列展示 email；en locale 下"工单管理"/"用户" 等英化 |
| P3.4 | UI 测试 | P3 | env-script 下载 `<a download>` → `<Button onClick fetch>` 走 step-up 401 拦截 |
| L2 | CR | LOW | `node-join.tsx` skip-network 区 IP placeholder 跟 publicIP 末位走 + warn 提示 |

## 设计约束

- 所有改动小步快走，不动 DB schema、不破坏现有测试
- SEC-002 fail-open（decode 失败 raw 透传 + warn log）：因为 admin 已 gate，且 Incus 响应形状变化几率极低
- env-script 下载新走 fetch + blob，保留 `clusterEnvScriptURL` 仅供 testing
- i18n 修复：英文 locale 下原本被 hardcoded "用户"、"工单管理" 串污染的字段统一切到英文翻译

## 任务拆分

- [x] **PLAN-030.A** M1 单测 + L1 safename validator
- [x] **PLAN-030.B** SEC-002 redactInstanceMap/JSON/List + 4 站点应用 + 单测
- [x] **PLAN-030.C** P3.1-P3.4 frontend 修复
- [x] **PLAN-030.D** L2 placeholder 动态化 + warn
- [x] **PLAN-030.E** 文档 + changelog + PR

## 验收

- 后端 `go vet` / `go test ./...` 全绿
- 前端 `tsc --noEmit` / `bun run build` 全绿
- 生产 vmc.5ok.co 部署后 `/api/admin/clusters/.../vms` 响应 grep 不到 `cloud-init.password`
- admin/orders 列显示 `ai@5ok.co` / `Basic VPS` 而非 `#1` / `#1`
- env-script 点击触发下载（已 step-up 时）；未 step-up 时跳 OIDC（不落裸 JSON）

## 不在范围

- 节点 detail 折叠面板里的 maintenance 按钮重复（"Enter maintenance" + "Maintenance" + 早期 evacuate 共存）—— 单独 task
- clusters 表加 `projects_jsonb` 列让 admin 可改 project 列表 —— 长期项
- portal API cloud-init 字段过滤的覆盖完整性（rescue / reinstall 可能也透传）—— 抽样未发现，待补
