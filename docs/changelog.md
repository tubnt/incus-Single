# IncusAdmin Changelog

## 2026-04-15 17:32 [progress]

All 17 database tables covered with backend APIs and frontend pages. Features: VM lifecycle, console, snapshots, monitoring (Recharts), SSH keys, products, tickets, orders/billing, invoices, audit logs, API tokens with Bearer auth. Deployed at vmc.5ok.co.

## 2026-04-15 17:40 [decision]

PLAN-005 drafted: full-stack refactor to pma-web (shadcn/ui sidebar layout, ThemeProvider, feature hooks, ESLint, Vitest) and pma-go (golangci-lint, validator, consistent responses, Taskfile) standards. sqlc migration deferred.
