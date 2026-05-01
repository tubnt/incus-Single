# PLAN-031 EN 语言包系统化补全（OPS-029）

- **status**: completed
- **completedAt**: 2026-04-30
- **priority**: P3
- **owner**: claude
- **createdAt**: 2026-04-30
- **referenceDoc**: OPS-028 全功能 UI 测试发现
- **task**: [OPS-029](../task/OPS-029.md)

## Context

OPS-028 全功能 UI 测试期间发现，EN locale 下页面渲染存在大量中文残留 —— 不是源代码 hardcoded，而是 `web/public/locales/en/common.json` 的 value 直接复制了中文。这是历史 i18n 工作的遗留：当时只把 zh 翻译做完，en 留作 TODO 但忘了回头补。

总计 ~190 行需要翻译。集中在：admin sub-objects（firewall / floatingIPs / osTemplates / users / shadow / billing 等）+ common buttons + topbar + vm + ticket + sshKey + dataTable。

## 范围

| 模块 | 改动 |
|---|---|
| `web/public/locales/en/common.json` | ~190 处中文 value 翻译为英文（保留符号 ✓ ⏸ ▶ ← 等不动） |
| `web/public/locales/zh/common.json` | 加 `dataTable.resizeColumn` + `topbar.collapseSidebar` 缺失 key |
| `web/src/shared/components/layout/app-sidebar.tsx` | 折叠按钮 aria-label 改用 `t("topbar.collapseSidebar")` |
| `web/src/app/routes/admin/audit-logs.tsx` | 引入 `useAdminUsersQuery` 建 ID→email 映射，User 列显示 email |
| 文档 | OPS-029 / PLAN-031 / changelog |

## 设计约束

- 保持 zh 不变（除补 2 个之前 source 用了但 zh 没定义的 key）
- 不改 source code 大动 —— 主要是 i18n 资源文件 + 数据展示一致性
- audit-logs User 显示策略跟 admin/orders / admin/tickets 完全一致：email 解析失败 fallback `#${id}`

## 任务拆分

- [x] **PLAN-031.A** 系统 audit en/common.json hardcoded 中文 → 翻译（37 个 Edit 操作分组完成）
- [x] **PLAN-031.B** zh + en 补 `dataTable.resizeColumn` + `topbar.collapseSidebar` key
- [x] **PLAN-031.C** sidebar collapse button aria-label 走 i18n
- [x] **PLAN-031.D** audit-logs User 列 email 解析
- [x] **PLAN-031.E** tsc + build + 后端 unit/integration + 部署 + PR

## 验收

- 生产 vmc.5ok.co EN locale 下 admin/billing / admin/orders / admin/tickets / admin/audit-logs / admin/firewall / admin/floating-ips / admin/os-templates / admin/users / api-tokens / settings / vm-detail 全部页面无可见中文残留
- DataTable 列宽拖拽 handle aria-label 不再渲染翻译 key
- 后端 unit + 前端 tsc + build 全绿
- 不破坏 zh locale（中文用户体验与之前一致）

## 不在范围

- 国际化框架本身的改造（i18next 配置 / namespaces 拆分等）
- console / terminal 内的 xterm 主题文案
- 视觉 / DESIGN.md 调整
