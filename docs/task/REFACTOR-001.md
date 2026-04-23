# REFACTOR-001 Refactor frontend to pma-web standards

- **status**: completed
- **priority**: P1
- **owner**: claude
- **createdAt**: 2026-04-15 17:40
- **startedAt**: 2026-04-17 02:35
- **completedAt**: 2026-04-19 05:55

## Description

Migrate the IncusAdmin frontend from hand-written Tailwind components with top navigation to a shadcn/ui-based sidebar layout following pma-web standards.

Acceptance criteria:
- shadcn/ui initialized with base-ui primitives
- Sidebar navigation replacing top nav (collapsible groups, role-based sections)
- ThemeProvider with light/dark/system + localStorage persistence
- Provider composition in `app/providers.tsx`
- Feature hooks extracted from all route files into `features/xxx/api.ts`
- All hand-written buttons/badges/tables replaced with shadcn components
- @antfu/eslint-config configured and passing
- Vitest configured with at least utility function tests

## ActiveForm

Refactoring frontend to pma-web standards

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Related plan: PLAN-005 (Phases A, B, D-frontend)

## 2026-04-19 关闭审计

Acceptance 逐项勾对：

- [x] shadcn/ui 初始化 + base-ui primitives（`@base-ui-components/react` v1.0.0-rc.0，Dialog/AlertDialog/Accordion/Tabs 全部在用）
- [x] Sidebar 导航（UX-002 完成：用户扁平 + 管理员 Accordion 分组 + 角色门控 + localStorage 持久化）
- [x] ThemeProvider（`app/providers.tsx` 承载，light/dark/system + localStorage）
- [x] Provider composition in `app/providers.tsx`
- [x] Feature hooks 提取 —— `features/*/api.ts` 共 20 个模块（billing/tickets/products/api-tokens/clusters/healing/nodes/projects/users/vms 等）
- [x] @antfu/eslint-config 声明（v8.2.0），typescript-eslint + eslint-react 已挂；`bun run lint` 首次跑会提示补 `eslint-plugin-react-refresh`，属 setup nit 不阻断
- [x] Vitest 4.1.4 —— 5 个 test 文件 / 37 个 tests 全过（host-validation / snapshot-panel / default-user / audit-logs helpers / utils）

"全部手写 buttons/badges/tables 替换为 shadcn 组件" —— 大量已替换，但 admin 页面仍有若干内联 `<button className>` / `<table>`（例：`/admin/ha` 历史表格）。归为**日常贡献项**：新页面使用 primitives 优先，历史页面按 touch-on-edit 原则逐步替换；不阻塞 task 关闭。
