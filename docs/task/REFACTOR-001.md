# REFACTOR-001 Refactor frontend to pma-web standards

- **status**: in progress
- **priority**: P1
- **owner**: claude
- **createdAt**: 2026-04-15 17:40
- **startedAt**: 2026-04-17 02:35

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
