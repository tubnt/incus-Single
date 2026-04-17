# PLAN-010 Production QA bug fixes (post-PLAN-009)

- **status**: completed
- **approvedAt**: 2026-04-16 23:45
- **createdAt**: 2026-04-16 23:35
- **completedAt**: 2026-04-17 00:40
- **relatedTask**: QA-003

## Context

Full-stack production QA after PLAN-009 deploy found 17 bugs.
No P0. 15 are actionable; 3 are reverse-proxy / OAuth2 Proxy config, deferred.

Source: `tmp/QA-REPORT-2026-04-16.md`.

### Findings touched

- `web/src/app/routes/__root.tsx`, `shared/components/layout/app-sidebar.tsx`,
  `shared/components/layout/app-header.tsx` — responsive shell (B17)
- `web/src/app/routes/console.tsx`, `web/src/app/routes/vms.tsx`,
  `web/src/app/routes/vm-detail.tsx`, `web/src/app/routes/admin/vms.tsx`,
  `web/src/app/routes/admin/vm-detail.tsx` — param naming, project, error state (B9/B10/B14)
- `web/src/app/routes/admin/clusters.tsx` — form validation (B16)
- `web/src/app/routes/admin/orders.tsx` — currency symbol (B6)
- `web/src/app/routes/settings.tsx`, `web/src/app/routes/admin/audit-logs.tsx`,
  `web/src/app/routes/admin/storage.tsx`, `web/src/app/routes/admin/node-ops.tsx`,
  `web/src/app/routes/admin.tsx` (index)
  — i18n and inline UX fixes (B5/B11/B12, B13, B15, B1)
- `web/public/locales/{en,zh}/common.json` — missing keys
- `internal/handler/portal/vm.go` `ListClusterVMs` — merge DB IPs (B8)
- `internal/handler/portal/vm.go`, `order.go`, `ippool.go`, `ceph.go`,
  `clustermgmt.go`, `nodeops.go`, `quota.go` — audit target_id (B7)

## Proposal

### P1 (high)

**B17 Mobile sidebar unusable**
- `__root.tsx` starts `collapsed` mobile and the sidebar uses
  `max-md:-translate-x-full`, but neither header nor outer chrome exposes a
  reopen control. On mobile `collapsed` stays `true` forever.
- Fix:
  - `AppHeader` gains a mobile-only burger button (`md:hidden`) that calls
    `onToggle`.
  - On mobile, treat `collapsed=false` as "drawer open": sidebar moves on screen
    via `translate-x-0`, and we overlay a backdrop (`md:hidden`) that closes it.
  - `__root.tsx`: start `collapsed=true` on mobile (drawer closed) and pass
    `onToggle` to header. Main content uses `pl-0` on mobile always.

**B10 Console route param mismatch**
- `vms.tsx:104` and `admin/vms.tsx:190` already use `vm=` — they are correct.
  The QA report's bad URL came from an older cache. Verified current code uses
  `vm=` consistently.
- Action: no code change required for URL generation. But route currently
  requires `cluster` non-empty while portal users often lack a cluster context.
  Console route already defaults `project=customers`; make `cluster` default to
  an empty string and prefer explicit error only when `vm` is missing. Show a
  clearer "Missing vm parameter" message referring to URL shape.

**B14 Nonexistent VM admin detail page**
- `admin/vm-detail.tsx` renders full UI even when backend 404s.
- Fix: call `GET /admin/vms/{name}?cluster=...&project=...` via react-query and
  render a NotFound state with a "Back to VMs" CTA when the query errors.
  Hide action buttons until data loads.

### P2 (medium)

**B9 VM detail default project**
- `admin/vm-detail.tsx:14` defaults `project` to `default`. Fix: default to
  `customers` (matches prod VMs) and let list links always pass the real
  project. Change the fallback only — list links already pass `project`.

**B16 Add Cluster form silent failure**
- `admin/clusters.tsx` AddClusterForm: mutation.isPending button disabled
  checks only `name` and `api_url`; other fields have no format validation,
  and when form is invalid the button is enabled.
- Fix: add `required` semantics and URL format check; when invalid, disable
  button AND show inline errors; on server error (`mutation.error`), show the
  message in a toast as well.

**B6 Currency symbol consistency**
- `admin/orders.tsx:59` uses `¥`. Everywhere else uses `$`. Platform is
  internal USD-priced.
- Fix: change `admin/orders.tsx` to `$` to match billing/invoices.

**B5/B11/B12 i18n coverage**
- Missing keys: `admin.overview.title`, `admin.overview.clusters`,
  `admin.overview.nodes`, `admin.overview.totalVms`, `admin.overview.apiStatus`,
  `admin.overview.healthy`, `nav.ha`, `nav.storage`, `nav.ipRegistry`,
  `nav.nodeOps`, `nav.observability`, `nav.api`, `settings.*` currently
  present but hardcoded Chinese in JSX comments (keys already exist with
  fallback — no change needed for settings except remove stray Chinese
  comments and let strings flow through `t()`).
- Fix:
  - Add missing keys in `web/public/locales/{en,zh}/common.json`.
  - `admin.tsx` index: replace hardcoded English strings with `t()` calls.
  - `sidebar-data.ts`: replace literal `HA`, `Storage`, `IP Registry`, `Node
    Ops`, `Observability` labels with translation keys (`nav.ha`, ...).
  - `admin/audit-logs.tsx`, `admin/orders.tsx`, `admin/storage.tsx`,
    `admin/node-ops.tsx`, `tickets.tsx` etc.: replace remaining hardcoded
    Chinese headings like "订单管理"、"审计日志"、"Output" with `t()`.
  - UI displays audit log target as `<type> #<id>`; when `id` is 0 but
    `details` JSON contains `name`, fall back to `<type> <name>` (cooperates
    with B7 backend fix).

**B1 Storage Pool Type**
- `admin/storage.tsx:268` already maps `"1"` → `"replicated"`. Backend may
  return the Go enum value `1` (number, not string). Fix: compare both
  number and string forms and derive from Ceph pool type constants
  (1=replicated, 3=erasure).

**B13 Native confirm for Delete VM**
- 8 call sites use `confirm()` / `window.confirm`. CLAUDE.md demands
  headless UI for interactive components.
- Fix: introduce a reusable `useConfirm()` hook + `<ConfirmDialog />`
  based on `sonner` (already in deps) or a lightweight modal using
  `@base-ui/react/dialog`. Migrate the 8 call sites.
- Scope: delete VM (admin list + admin detail), reinstall, migrate, evacuate,
  OSD out, pool delete, reset password. Keep message text identical.

**B15 node-ops IP format validation**
- `admin/node-ops.tsx:45` only disables "Test SSH" when `!host`.
- Fix: add `isValidHost(host)` regex supporting IPv4, IPv6, or RFC-1123
  hostnames; disable button when invalid and show inline hint.

### Backend (B7, B8)

**B8 Admin VM list missing IP column**
- `handler/portal/vm.go:472 ListClusterVMs` returns raw Incus instance JSON.
  `state.network` is empty for freshly-created VMs and in cached responses.
  Portal `/vms` uses DB (has `ip`), admin list relies on Incus state (often
  empty).
- Fix: after assembling `allInstances`, look up the VM names in DB
  (`vmRepo.GetByName` or a new `ListByNames`) and patch a top-level `ip`
  field into each instance JSON. Frontend `extractIP` already checks
  `vm.state.network`; extend it to prefer `vm.ip` if present, fall back to
  state.
- Implementation: unmarshal each `json.RawMessage`, inject `"ip"` key,
  marshal back. Single DB round trip per cluster page (batch lookup by names).

**B7 Audit log target_id all 0**
- 20+ `audit(r, action, type, 0, ...)` sites (ippool, ceph, cluster mgmt,
  nodeops, vm state actions, etc.). For resources with no numeric row
  (node by name, cluster by name, OSD by number, pool by name), keep `0`
  but make the UI fall back to `details.name` (already covered in B11 fix).
- For resources WITH a numeric id (vm state/delete/reinstall actions in
  admin — currently passing `0` even though the VM has a DB ID), look up
  the VM by name and pass the real id when convenient. Concretely, patch
  `vm.go:688,724,767,805,862` (AdminSetState, AdminDelete, AdminReinstall,
  AdminResetPassword, AdminMigrate) to `vmRepo.GetByName(cluster, name)`
  and pass `vm.ID` (if found, else 0). One-line change per site, ignore
  errors on the audit path.

### Deferred (out of scope)

| ID | Reason |
|----|--------|
| B2 /oauth2/callback → 500 | OAuth2 Proxy upstream config, not app code |
| B3 missing security headers | Reverse-proxy layer (Caddy/oauth2-proxy) |
| B4 /favicon.ico 403 | OAuth2 Proxy skip_auth list |

## Risks

- B17 drawer overlay must not intercept clicks when sidebar is closed on
  desktop. Gate the backdrop with `md:hidden`.
- B8 DB lookup adds one query per `ListClusterVMs` call. Using a single
  `ListByNames(ctx, names)` keeps it at 1 query. Cache unaffected since we
  already returned cached raw data; IP injection happens pre-response.
- B13 `useConfirm` refactor across 8 sites is the largest change. Keep the
  hook API minimal (`confirm(title, message): Promise<boolean>`) and migrate
  in one pass. Do not touch messages.
- B7 `vmRepo.GetByName` already exists and is used by PLAN-009 H2 fix. Safe
  to reuse. If VM missing (Incus-only VMs), fall back to `0`.

## Scope

- Frontend: ~11 files touched.
  - `web/src/app/routes/__root.tsx`
  - `web/src/shared/components/layout/app-sidebar.tsx`
  - `web/src/shared/components/layout/app-header.tsx`
  - `web/src/shared/components/layout/sidebar-data.ts`
  - `web/src/app/routes/console.tsx`
  - `web/src/app/routes/admin/vm-detail.tsx`
  - `web/src/app/routes/admin/vms.tsx`
  - `web/src/app/routes/admin/clusters.tsx`
  - `web/src/app/routes/admin/orders.tsx`
  - `web/src/app/routes/admin/audit-logs.tsx`
  - `web/src/app/routes/admin/storage.tsx`
  - `web/src/app/routes/admin/node-ops.tsx`
  - `web/src/app/routes/admin.tsx` (index dashboard)
  - `web/src/shared/components/ui/confirm-dialog.tsx` (new)
  - `web/public/locales/en/common.json`
  - `web/public/locales/zh/common.json`
- Backend: 1 file.
  - `internal/handler/portal/vm.go` — `ListClusterVMs` IP injection +
    AdminSetState/AdminDelete/AdminReinstall/AdminResetPassword/AdminMigrate
    audit target_id.
- No migrations, no new packages (use `@base-ui/react` already present via
  shadcn; if missing, add `sonner`-based dialog using existing Toaster or
  port the existing shadcn Dialog primitive — verify in implementation).
- Tests: none beyond unit-test level; prod smoke test after deploy.

## Alternatives

- B17: could use a dedicated shadcn `Sheet` primitive. Current approach
  (CSS translate + backdrop) keeps the change small and avoids adding a new
  component. Chose small.
- B8: could extend Incus query to `recursion=2` (already is) or force-refresh
  state for freshly created VMs. DB injection is deterministic and cheap.
- B13: could keep native `confirm` for internal-only admin pages and migrate
  only user-visible Delete. Chose full migration so the entire app obeys
  CLAUDE.md's headless UI rule.

## Annotations

- 2026-04-16 23:35 — Plan drafted from tmp/QA-REPORT-2026-04-16.md under auto mode.
