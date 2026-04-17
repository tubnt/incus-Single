# PLAN-011 Frontend pma-web compliance cleanup

- **status**: in progress
- **createdAt**: 2026-04-17 01:05
- **approvedAt**: 2026-04-17 02:30
- **relatedTask**: REFACTOR-001 + REFACTOR-002

## Context

Full-stack QA (QA-003) and PLAN-010 closed out production bugs. A pma-web
baseline audit run immediately after exposed the remaining compliance gaps
in `incus-admin/web/`:

- Provider graph, stack versions, router + query wiring, Tailwind v4 tokens,
  `ConfirmDialog`, kebab-case/PascalCase naming, `dangerouslySetInnerHTML`
  absence — all ✅.
- Gaps concentrate in **data-layer discipline**, **i18n coverage**,
  **feature extraction**, and a short list of **style/type drift**.

Evidence (file:line, counts verified in the audit):

1. **Routes call `http.*` directly — 78 sites in 25 files**, bypassing the
   feature `useXxxQuery/useXxxMutation` pattern required by
   `pma-web/baseline.md:116`. Some features already expose hooks
   (`features/vms/api.ts`, `features/clusters/api.ts`,
   `features/monitoring/api.ts`, `features/snapshots/api.ts`,
   `features/tickets/api.ts`), but many routes re-inline the fetch.
   `features/auth/`, `features/products/`, `features/dashboard/`,
   `features/console/` are empty.
2. **Hardcoded CJK strings — 16 files, ~220 occurrences.** i18n is fully
   configured; `t()` adoption is inconsistent. Worst offenders:
   `app/routes/admin/node-join.tsx` (43), `admin/products.tsx` (27),
   `admin/monitoring.tsx` (24), `admin/nodes.tsx` (21), `tickets.tsx` (20),
   `admin/tickets.tsx` (16), `admin/users.tsx` (14),
   `admin/invoices.tsx` (10), `ssh-keys.tsx` (8), `settings.tsx` (9),
   `api-tokens.tsx` (9), `features/monitoring/vm-metrics-panel.tsx` (6).
3. **`shared/lib/query-client.ts:6` `staleTime: 30_000`** vs baseline 60s.
4. **Business components live inside route files.** Top offenders:
   `admin/storage.tsx` (385 lines), `admin/vms.tsx` (361), `admin/monitoring.tsx`
   (360), `admin/nodes.tsx` (356), `admin/products.tsx` (283),
   `admin/clusters.tsx` (269). Each embeds multiple forms/dialogs that
   should live in `features/*/`.
5. **Hardcoded Tailwind color literals** — non-semantic `bg-yellow-500/20
   text-yellow-600` (status pills) in 8 files,
   `bg-black text-green-400` (terminal/log blocks) in 4 files,
   hex `#f59e0b` in `admin/monitoring.tsx:207`, xterm theme in
   `features/console/terminal.tsx:25-28` (four hex colors).
6. **`as any` escapes** outside generated code: `layout/app-header.tsx:19`
   (`theme as any`), `layout/app-sidebar.tsx:75` (`item.to as any`).
7. **`React.*` type annotations** where baseline prefers namespace or direct
   type imports: `shared/components/theme-provider.tsx:12`,
   `shared/components/ui/confirm-dialog.tsx:21`,
   `shared/components/layout/app-sidebar.tsx:11`,
   `app/routes/admin/monitoring.tsx:342`.
8. **Thin UI primitive shelf** — `shared/components/ui/` has only
   `confirm-dialog.tsx` + `skeleton.tsx`. No shadcn `Dialog`, `Select`,
   `Tabs`, `Tooltip`, `Popover`, `DropdownMenu` generated yet, forcing
   inline solutions.
9. **Tests near zero** — only `shared/lib/utils.test.ts`. Vitest 4 is
   configured but not exercised.
10. **`vite.config.ts` manual alias** (acceptable but inconsistent with the
    recommended `vite-tsconfig-paths`); `useIsMobile` in
    `app/routes/__root.tsx:29-39` duplicates what `md:` utilities can do.

## Proposal

Five ordered phases. Each phase is independently shippable; later phases
assume earlier ones merged.

### Phase A — Data-layer discipline (P1)

Goal: all network access in routes flows through feature hooks; no bare
`http.*` in `src/app/routes/**`.

1. For each feature referenced by a route, ensure `features/<feature>/api.ts`
   exists and exports the relevant `useXxxQuery` / `useXxxMutation` pairs.
   New files needed:
   - `features/billing/api.ts` (orders/invoices/topup)
   - `features/ssh-keys/api.ts`
   - `features/api-tokens/api.ts`
   - `features/users/api.ts` (admin user mgmt)
   - `features/storage/api.ts` (Ceph OSD/pool/health)
   - `features/nodes/api.ts` (nodes list, join, evacuate)
   - `features/products/api.ts` (plans CRUD)
   - `features/ippool/api.ts` (ip-pools, ip-registry)
   - `features/ha/api.ts`
   - `features/observability/api.ts`
   - `features/audit/api.ts`
   - `features/node-ops/api.ts`
2. Migrate routes one-by-one. Each route reduces to: route guard +
   layout + composed feature components + feature hook calls.
3. Set `shared/lib/query-client.ts` `staleTime` back to `60_000`.

**Acceptance**: `grep -rn "http\.\(get\|post\|put\|delete\)"
src/app/routes/` returns 0.

### Phase B — i18n coverage (P1)

1. Extract all hardcoded CJK strings in the 16 listed files into
   `public/locales/{en,zh}/common.json` (or per-feature namespaces when the
   translation file grows past ~150 keys).
2. Use one consistent key-path scheme: `<area>.<context>.<key>` — e.g.
   `sshKey.addTitle`, `nodeJoin.step1Title`, `product.createButton`,
   `ticket.statusPending`. Reuse existing scheme where it already matches.
3. Add ESLint rule `@eslint-react/no-literal-string` (or a narrower custom
   regex check) to catch regressions. Configure `allowedStrings` for
   punctuation-only and identifier-like literals.
4. Run pass: `grep -rnP "[\\x{4e00}-\\x{9fa5}]" src/` returns only comments.

**Acceptance**: zero CJK literals inside JSX across `src/`; language
toggle switches every visible string.

### Phase C — Feature extraction (P1 → P2)

1. Move embedded components out of route files into
   `features/<area>/components/`:
   - `admin/storage.tsx` → `features/storage/components/{PoolList,
     PoolCreateForm, OSDList, CephHealthPanel}.tsx`
   - `admin/vms.tsx` → `features/vms/components/{ClusterTabs,
     AdminVMList, AdminVMRow, EvacuateForm, MigrateDialog}.tsx`
   - `admin/nodes.tsx` → `features/nodes/components/{NodeList,
     EvacuateForm, JoinWizard}.tsx`
   - `admin/clusters.tsx` → `features/clusters/components/{ClusterList,
     AddClusterForm}.tsx`
   - `admin/products.tsx` → `features/products/components/*.tsx`
   - `admin/monitoring.tsx` → `features/monitoring/components/*.tsx`
2. Target: each route file ≤ 120 lines, contains only
   `createFileRoute` + composition.

**Acceptance**: no route file > 200 lines; domain components importable
from `features/*`.

### Phase D — UI primitive shelf + style drift (P2)

1. Run `bunx shadcn@latest add dialog select tabs tooltip popover
   dropdown-menu badge button card input textarea toast` (the subset the
   audit shows we need). Output lands in `src/shared/components/ui/`.
2. Replace hardcoded status-pill literals (`bg-yellow-500/20 ...`) with a
   `StatusBadge` component that maps
   `pending|warning|error|success|muted` → semantic tokens
   (`bg-warning/20 text-warning`, etc.). Add the missing warning token to
   `src/index.css` if absent.
3. Replace `bg-black text-green-400` terminal/log blocks with a
   `<CodeBlock variant="terminal" />` component; keep one definition.
4. `features/console/terminal.tsx`: read `getComputedStyle(root)` for
   `--color-background`, `--color-foreground`, `--color-primary`,
   `--color-muted` and convert to xterm theme colors; re-apply when theme
   changes via `MutationObserver` on `<html>` class list.
5. Replace `admin/monitoring.tsx:207` hex with a theme token.
6. Fix `as any` in `layout/app-header.tsx:19` and
   `layout/app-sidebar.tsx:75`. Use correct TanStack Router `LinkProps`
   type for the latter.
7. Convert the four `React.ReactNode`/`React.ElementType` usages to direct
   `import type` form.

**Acceptance**: no `as any` outside `routeTree.gen.ts`; no color hex in
non-generated TS; Tailwind grep returns no `bg-(red|yellow|green|blue|
amber)-\d00` literals.

### Phase E — Verification + tests (P2)

1. Add Vitest suites:
   - `shared/lib/http.test.ts` — success, 4xx/5xx JSON error body, network
     error, params encoding.
   - `shared/components/ui/confirm-dialog.test.tsx` — promise resolves
     `true` on confirm, `false` on cancel/close; focus trapped.
   - `features/vms/api.test.ts` — mock `http`, verify query keys and
     mutation invalidations.
2. Add `vite-tsconfig-paths` to `vite.config.ts`; remove manual alias
   block.
3. Replace handwritten `useIsMobile` in `__root.tsx` with Tailwind-only
   layout using `md:` utilities + CSS-driven drawer state.
4. Wire CI: `bun run lint && bun run typecheck && bun run test &&
   bun run build` must all pass.

**Acceptance**: CI green; coverage for data layer and confirm dialog > 0.

## Risks

- **Phase A–C blast radius is large.** Each route migration risks breaking
  cache key invalidation and subtle refetch timing. Mitigation: do it one
  feature at a time, keep query keys identical to the existing inline
  versions, ship per-feature PRs, and rely on the existing production
  smoke-test loop.
- **i18n JSON churn** will produce large diffs in `common.json`. Keep one
  PR per feature area to keep review sane.
- **shadcn add** mutates `components.json` and may pull in `@base-ui/react`
  primitive variants not already in `bun.lock`; run `bun install` before
  first commit and verify bundle size delta in `vite build` output.
- **Phase E CI wiring** may surface lint errors currently suppressed by
  `react-refresh/only-export-components: off`. Fix as encountered; do not
  widen the off-list further.

## Scope

- Files touched (estimate): 40–55 frontend files across 5 phases.
- New files: ~12 `features/<area>/api.ts`, ~25 extracted component files,
  ~8 shadcn primitives, 3 Vitest specs.
- No backend changes.
- No new runtime deps (shadcn primitives use `@base-ui-components/react`
  already present).
- Dev deps: `vite-tsconfig-paths` (Phase E).

## Alternatives

- **Big-bang refactor in one PR** — rejected: too large to review, high
  regression risk on a live cluster.
- **Skip Phase C (leave components in routes)** — rejected: would leave
  REFACTOR-001 partially unmet and keep 350-line routes that mix
  business logic with routing.
- **Add literal-string lint rule first (Phase B before A)** — viable but
  Phase A unblocks the hooks-first pattern which several new feature
  components will rely on; stick with A→B.

## Annotations

- 2026-04-17 01:05 — Plan drafted from the pma-web baseline audit
  performed after PLAN-010 / QA-003 shipped. Feeds into the still-open
  REFACTOR-001 task.

- 2026-04-17 01:45 — 深度审查（User Journey 维度）追加。以下内容按发现
  优先级罗列，后续落地时合并进各 Phase 或新增 Phase F。已用
  Serena / code-review-graph / grep 逐条追溯调用链，非猜测。

### 深度审查发现（User Journey 视角）

#### P0 — 生产缺陷（阻塞核心功能，必须先于 Phase A 修复）

**P0-1 门户 VM 详情页契约不匹配（长期损坏）**
- 位置：`incus-admin/web/src/app/routes/vm-detail.tsx:42`
  `http.get<{ vm: VMService }>(/portal/services/${id})` →
  `data?.vm` 取值。
- 后端：`internal/handler/portal/vm.go:145` 返回
  `{"service": vm}`（键名为 `service`，不是 `vm`）。
- 影响：`data.vm` 恒为 `undefined`，QA-003 B14 修复后所有 VM 点击
  均显示 “Not Found”（不论 VM 是否存在）。`git log` 显示该键
  一直是 `service`，前端从未对齐。
- 修法：统一为 `{"vm": vm}` 或前端读 `data.service`。建议
  Phase A 同时把 `vms` 的 list/detail 响应体改成
  `{ vms: [...] }` / `{ vm: ... }`。

**P0-2 `findClusterName` 丢弃 VM.ClusterID**
- 位置：`internal/handler/portal/vm.go:288-294`
  ```go
  func findClusterName(mgr *cluster.Manager, _ int64) string {
      clients := mgr.List()
      if len(clients) > 0 { return clients[0].Name }
      return ""
  }
  ```
- 调用点：`VMAction`（line 148）、`ResetPassword` 等。
- 影响：多集群部署下，所有用户 VM 的 start/stop/restart/reset
  操作都会被路由到第一个集群。若 VM 实际在第二个集群，操作
  静默打到错误集群（可能命中同名 instance 或 404）。
- 修法：引入 `cluster.Manager.GetByID(clusterID int64)`，
  `findClusterName(mgr, vm.ClusterID)` 返回真实名字。

**P0-3 用户 CreateService 硬编码 `ClusterID: 1`**
- 位置：`internal/handler/portal/vm.go:265`
  `vm := &model.VM{ ..., ClusterID: 1, ... }`。
- 影响：所有用户下单创建的 VM 在 DB 中 ClusterID 均为 1，与
  实际创建位置（`h.clusters.List()[0]` — 见 line 221）脱钩，
  且多集群环境下调度决策完全丢失。
- 修法：用 `mgr.List()[0].ID`（或调度器返回的 ClusterID）写入
  DB；长期需要实现 product → cluster 关联或调度策略。

#### P1 — 业务闭环缺口

**P1-1 `/portal/services` JSON 缺 `cluster_name` / `project`**
- 后端 `ListServices`（vm.go:118-131）直接返回
  `[]model.VM`，`model.VM` 结构体（`model/models.go`）只有
  `ClusterID int64`，没有 `Project`、没有 `ClusterName`。
- 导致前端 25 处硬编码 `cluster=cn-sz-01&project=customers`：
  `routes/vms.tsx:104,123`、`vm-detail.tsx:96,144`、
  admin 的 console 链接构造等。
- 必须作为 **Phase A 的前置改造 (A.0)**：
  1. 新建 `handler/portal/dto.go`，定义 `VMServiceDTO`，
     含 `cluster`, `cluster_display_name`, `project` 三字段；
  2. `ListServices` / `GetService` 返回 DTO；
  3. 前端 `features/vms/api.ts` 的 `VMService` 类型补齐；
  4. 所有 Console / Snapshot / Metrics 链接改读 DTO 字段。

**P1-2 TanStack Query 缓存键分裂**
- List: `["myServices"]`（`features/vms/api.ts:35`，
  `vms.tsx:32`，billing.tsx 4 处 invalidation）。
- Detail: `["myService", id]`（`vm-detail.tsx:41`，大写 S 单数）。
- VM action 后 `vm-detail.tsx:50` 仅 invalidate
  `["myService", id]`，不触发 list 刷新；`vms.tsx:75` 只
  invalidate list，不触发 detail 刷新；双向都 stale。
- 修法：**Phase A 必须统一命名**，不是 "keep keys identical"
  就完事。标准表：

  | 资源 | list | detail | 其他 |
  |------|------|--------|------|
  | 用户 VM | `["vms", "myList"]` | `["vms", "myDetail", id]` | — |
  | 管理 VM | `["vms", "adminList", clusterName]` | `["vms", "adminDetail", cluster, name]` | — |
  | 订单 | `["orders", "myList"]` | — | — |
  | 工单 | `["tickets", "myList"]` | `["tickets", "detail", id]` | — |
  | 节点 | `["nodes", "list"]` | `["nodes", "detail", cluster, name]` | — |
  | 集群 | `["clusters", "list"]` | — | — |
  | 快照 | `["snapshots", "list", vm, cluster, project]` | — | — |
  | 度量 | `["metrics", "vm", vm, apiBase, cluster]` | — | `["metrics", "adminOverview"]` |

  所有 mutation 均同时 invalidate 关联的 list + detail 前缀。

**P1-3 admin/create-vm 永远落到 `clusters[0]`**
- 位置：`admin/create-vm.tsx:35`
  `const clusterName = clustersData?.clusters?.[0]?.name ?? "";`
- 页面 UI 里 `Project` 有 select（硬编码 customers/default），但
  `Cluster` 没有 select，下单直接落到 `/admin/clusters/<first>/vms`。
- 修法：Phase C 抽出 `ClusterPicker` 组件，并把 project 从
  枚举改成基于后端 `/admin/clusters/<c>/projects` 拉取。

**P1-4 admin/ha 同样只看 `clusters[0]`**
- 位置：`admin/ha.tsx:31`。多集群 HA 无法切换。
- 修法：用 ClusterPicker 统一，存到 URL search 参数。

**P1-5 事件流仅 admin 可用**
- 后端 `handler/portal/events.go:31-33` 路由挂在 `AdminRoutes`，
  portal 用户打不到；`StreamEvents` 也没按用户过滤，即便开放
  给 portal 也会泄露其他用户事件。
- 前端仅 `admin/observability.tsx:86-102` 使用 WebSocket，其他
  VM/节点/任务状态页面全部依赖轮询。
- 修法：新增 `/api/portal/events/ws`，按 `vm_id IN (user's vms)`
  过滤 Incus lifecycle 事件；新增 `shared/lib/events.ts` 统一封装
  `useVMEvents({ cluster, project, vmName })` hook；前端在获得
  事件后本地 `queryClient.setQueryData` 或 `invalidateQueries`。
  建议并入 **Phase F（新增）** “事件流统一接入”。

**P1-6 billing → pay 后 detail 页未 invalidate**
- `billing.tsx:198-205` `payMutation.onSuccess`：invalidate
  了 `["myServices"]`、`["myInvoices"]`、`["currentUser"]`，
  但没 invalidate 对应 VM 的 detail（此时尚无 id 可 invalidate
  属实）。更麻烦的是 OrderRow 再支付时（line 250-253）也
  同样遗漏 detail。因为 Phase A 统一 key 后只需 invalidate
  前缀 `["vms"]`，这个问题会自然消失——这正是 P1-2 标准化
  的价值，需在 Phase A 用例中列出。

#### P2 — 性能与规范

**P2-1 轮询雪崩（13 处 refetchInterval）**
- 同时 15s/10s 间隔的查询：`vms.tsx` (15s)、`admin/vms.tsx`
  (15s)、`admin/nodes.tsx` (15s)、`admin/ha.tsx` (15s)、
  `admin/orders.tsx` (15s)、`admin/tickets.tsx` (15s)、
  `admin/audit-logs.tsx` (15s)、`features/vms/api.ts`
  list (15s) 和 cluster list (10s)、`features/tickets/api.ts`
  myTickets (15s)、`features/monitoring/*` (30s) 等。
- 问题：打开 admin 首页后峰值 QPS ≈ 10+ req/15s，Incus API
  侧是单集群 REST，长期会出现连接复用饱和。
- 修法（随 Phase F 一起）：关键实时资源（VM state、node
  online、task progress）改订阅事件流；非实时（产品、发票、
  工单列表、审计日志）调高 `staleTime` 到 120s，
  `refetchInterval` 删除或改成 `refetchOnWindowFocus: true`。

**P2-2 `billing.tsx` 三并发查询无门控**
- 页面加载瞬间同时发起 `/portal/orders`、`/portal/invoices`、
  `/portal/products` 三个请求。建议 Phase C 拆出
  `BillingPage`，把 products 查询交给 `<ProductGrid>`（可
  prefetch），invoices 延迟到 tab 切换时加载。

**P2-3 `useIsMobile` 与 `md:` 断点不一致**
- `__root.tsx:29-39` 自定义 `< 768` 即 mobile，但 Tailwind
  `md:` 断点是 `>= 768`。当前碰巧一致，但会随 CSS 变量迁移
  或设计稿调整漂移。Phase E 要求换成 CSS-only 方案，这条
  已在原计划里，保持。

**P2-4 `admin/vm-detail.tsx` 用 `adminClusterVMs` 作为详情来源**
- 位置：`admin/vm-detail.tsx:36` 复用 list 的 queryKey 后
  在组件内 `list.find(...)` 找单条。这会在 list 尚未加载
  时永远为空，也会被 15s 轮询重新拉整个 list。Phase A
  要求：admin 详情页改用 `/admin/vms/<cluster>/<name>` 单独
  endpoint（若后端没有就新增），key 走
  `["vms", "adminDetail", cluster, name]`。

**P2-5 事件上报中文字符串还在混用**
- `admin/vms.tsx:152` `toast.success(\`${vm.name}: ${action}
  ${t("vm.actionSubmitted")}\`)`，格式串由代码拼成，不利于
  中英切换。Phase B 要求统一 `t("vm.actionSubmittedFor",
  { name, action })` 占位符风格。

#### 对原 PLAN-011 的修正建议

1. **在 Phase A 之前插入 Phase A.0「后端契约增补」**：
   - 修 P0-1、P0-2、P0-3；
   - 为 `/portal/services` 增加 `cluster`、`cluster_display_name`、
     `project` 字段；
   - 为 Admin VM 详情提供
     `GET /admin/clusters/{cluster}/vms/{name}` 单体 endpoint；
   - 这一步没有就无法安全完成 Phase A 的钩子迁移（否则钩子
     内部仍要硬编码 cluster/project）。

2. **Phase A 增加“缓存键标准化表”**（上文 P1-2 表格），
   并把 acceptance 从 “grep 0 `http.*` in routes” 扩展为：
   - `grep` 无 `queryKey: \["my(Services|Service)"\]`；
   - 所有 mutation invalidation 至少覆盖 list 前缀。

3. **新增 Phase F「事件流统一接入」**（P2）：
   - 后端 `/api/portal/events/ws` 按 user_id 过滤；
   - 前端 `shared/lib/events.ts` 封装 `useVMEvents` /
     `useNodeEvents`；
   - 剔除轮询，改为事件驱动 invalidate；
   - 未接入事件的列表页 `refetchInterval` 至少抬到 60s。

4. **Phase C 扩展**：
   - 抽出 `ClusterPicker` 组件，`admin/ha.tsx` /
     `admin/create-vm.tsx` / admin 监控等使用；
   - `ProjectPicker` 组件基于 `/admin/clusters/{c}/projects`，
     弃用枚举。

5. **Phase D 细化**：
   - `StatusBadge` 的映射表要与 `features/vms/api.ts` 的
     `extractIP` 等辅助一起挪到 `shared/components/status`，
     避免 `admin/vms.tsx` 重复实现。

6. **Phase E 追加测试**：
   - `features/vms/api.test.ts`：验证 P1-2 新 key 标准化后
     list/detail invalidation 正确传播；
   - `handler/portal/vm_test.go`：断言 `ListServices` /
     `GetService` 响应包含 `cluster`、`project` 字段；
   - 端到端（Playwright）：用户下单 → 支付 → 列表出现 →
     点击详情 → 看到信息 → reset password 成功。

### 后端完整性审查（pma-go 基线，2026-04-17 02:30）

用 Serena / 直接 grep 追溯所有 `handler/portal/*.go` 调用链，并把
`internal/` 目录结构对照 pma-go `references/baseline.md` /
`config-and-data.md` / `http-and-runtime.md`。以下是原 PLAN-011 未
覆盖但属于"后端应做的所有改造"的硬缺陷。

#### G-P0 — clusters 表成为悬空 FK（契约级不一致）

- `db/migrations/001_initial.sql:3` 定义 `clusters(id SERIAL PK,
  name UNIQUE, display_name, api_url, status, ...)`，并在
  `vms.cluster_id`、`orders.cluster_id`、`ip_pools.cluster_id`、
  `product_clusters.cluster_id` 四处作为 FK。
- 全仓 `grep -rn "FROM clusters"` / `INSERT INTO clusters` 命中
  **零次**：没有 repository、没有 sqlc 查询、没有启动注入。
- 运行时 `cluster.Manager`（`internal/cluster/manager.go`）仅从
  koanf 配置（`config.Clusters`）构建，键为 `name string`，**没有
  ID 概念**。
- 结果：
  1. `vms.cluster_id` 列所有行都是 `1`（原 P0-3 的根因），且无
     人维护 clusters 表；
  2. admin `clustermgmt.go` 动态添加集群只写内存 + 配置文件，不
     落表，进一步放大数据漂移；
  3. `product_clusters` 形同虚设，真正多集群售卖没法按 product
     选目的集群。
- **PLAN-011 需补的 Phase A.0 子任务**（二选一、写入方案决策）：
  - 方案 A（保留 DB 主导）：启动时 upsert config → clusters 表；
    新增 `repository/cluster.go` 提供 `GetByName / GetByID /
    UpsertFromConfig`；`cluster.Manager` 暴露 `IDByName(name)
    int64` 与 `NameByID(id) string`；重写 `findClusterName(mgr,
    clusterID)`；PortalVM / AdminVM / OrderPay 写库时都用真实 ID。
  - 方案 B（简化为 name-only）：migration 004 把 `vms.cluster_id
    INT` 改为 `vms.cluster_name TEXT NOT NULL`，删 clusters / 
    product_clusters 表，`model.VM.ClusterName` 取代
    `ClusterID`；所有 handler 改用 name。
  - 建议方案 A（多集群商业化必选），工作量含 goose 迁移
    004_seed_clusters.sql 与 cluster repository。

#### G-P0 — handler 直接返回 DB 模型 / 响应键不一致

- `GetService` 返回 `{"service": vm}`，但 `ListServices` 返回
  `{"services": [...]}`，前端 vm-detail 因期望 `{"vm": ...}` 彻底
  读不到（原 P0-1）。真正症结在：后端没有 **DTO 层**，每个 handler
  自己拍键名。
- pma-go `http-and-runtime.md` "keep response mapping consistent"
  要求响应映射一致。建议：
  - 新建 `internal/handler/dto/`（或就近 `handler/portal/dto.go`）；
  - 约定：列表用 `{"items": [...], "total": n}` 或资源复数名；
    单体用资源单数名；
  - `VMServiceDTO { ID, Name, ClusterName, ClusterDisplayName,
    Project, IP, Status, CPU, MemoryMB, DiskGB, OSImage, Node,
    CreatedAt }`（剔除 `password` 字段，仅创建/重置时一次性返回）；
  - 所有 `map[string]any{}` 写响应改为结构体 + json tags。
- 把该任务列入 **Phase A.0**，与前端 `features/vms/api.ts`
  类型对齐。

#### G-P1 — 敏感字段 `password` 长期驻留数据库并随列表返回

- `model.VM.Password *string`、`repository/vm.go` 所有 SELECT 都把
  `password` 拉出来，`ListByUser` → `ListServices` → 前端
  `VMService.password` 完整暴露。
- pma-go baseline 明确要求 "Secrets: never log secrets"；目前
  passwords 不仅返回到前端 JSON，还有机会进 slog（尽管没直接
  `slog.*password*`，但 JSON body 可能被中间件捕获）。
- 修法（应在 Phase A.0 一并完成）：
  - schema migration 004：`ALTER TABLE vms DROP COLUMN password;`
    或至少改成加密列；
  - 密码仅在 `CreateVMResult` / `ResetPasswordResult` 当次响应中
    返回；后续不再存 DB；
  - DTO 彻底剥掉 password。
- 该 P0 级安全问题**必须列入 PLAN-011**，不能延后。

#### G-P1 — 订单支付 → VM 供应无事务 / 幂等保障

- `handler/portal/order.go:106-215` `Pay`：
  1. `PayWithBalance` 扣钱；
  2. `allocateIP` 分配 IP；
  3. `vmSvc.Create` 调 Incus 建机；
  4. `vmRepo.Create` 落 DB；
  5. `UpdateStatus` 标记 active。
  任一步失败都只回写 order status，不回滚余额，不释放 IP，不销毁
  Incus 残留实例。例：VM 创建成功但 DB 插入失败 → Incus 多一个
  孤儿 VM + 用户扣了钱看不到。
- pma-go baseline 要求 "Translate internal errors to safe HTTP
  responses at the edge"；目前 handler 把 5 步编排原地抛 500。
- **应加入 PLAN-011 Phase A.0** 的后端子任务：
  - 把编排搬到 `service/order.go`（新）或扩展 `service/vm.go`；
  - 引入补偿动作：IP release、Incus instance delete、balance
    refund；
  - 用 context + sentinel error 表达可重试/不可重试分支。
- 或在 PLAN-011 之外另立新 plan（REFACTOR-002 事务一致性），但
  至少要在 A.0 里声明"本 plan 不修，待 X 处理"。

#### G-P1 — handler 违反 pma-go 分层

- `handler/portal/vm.go = 1029 行`，超过 pma-go "files usually
  under 800 lines"；并且同一文件同时装 portal `VMHandler` 与
  `AdminVMHandler`，违反 baseline "focused files"。
- `handler/portal/` 包同时挂 portal + admin 路由（grep
  `AdminRoutes`、`AdminVMHandler`、`AdminClusterMgmt*`），与
  `server/server.go:143 /api/admin` 分组冲突。
- pma-go 期望 `internal/handler/{portal,admin}`：
  - Phase C 已涉及前端 feature extraction，**应对称地在后端
    拆包**：
    - `handler/admin/vm.go`、`handler/admin/clustermgmt.go` …
    - `handler/portal/vm.go`、`handler/portal/order.go` …
  - `server/server.go` 的路由挂载不变，改 import 路径。
- 将该重构纳入 PLAN-011 Phase C（定名 Phase C-backend）。

#### G-P1 — business logic 沉淀在 handler，service 层过薄

- `service/` 仅 `vm.go` 与 `vm_test.go`。order/product/ticket/
  sshkey/audit/ippool/ceph/metrics/quota/console/events/nodeops
  全部**直接 handler → repository**。
- 后端 handler 层混入调度、IP 分配、审计、余额扣款、Incus 调用、
  cloud-init 构造，违反 pma-go "handlers manage transport;
  services manage business rules"。
- 修法（可分阶段）：
  - Phase A.0：先抽 `service/order.go`，把 Pay 编排从 handler
    移出（因其与 P0 紧耦合）；
  - Phase C-backend：对称抽 `service/ticket.go`、
    `service/sshkey.go`、`service/quota.go`；
  - Phase E：在 service 层加单元测试（repo mock）。

#### G-P1 — 未使用 `go-playground/validator`

- `handler/portal/validate.go = 9 行`，形同空文件；所有入参校验
  都手写 `if req.Foo == "" { ... }`。
- pma-go baseline 明确：`Validation: go-playground/validator`。
- 影响：B15（node-ops IP 校验）/ B16（Add Cluster URL 校验）都是
  QA-003 打补丁的手写校验。未来新增 request struct 会继续漂移。
- Phase A.0 一起做：
  1. 在 `internal/handler/portal`（或提到 handler/validate）加
     共享 `validator.New()`；
  2. 对 `CreateOrderReq`、`CreateVMReq`、`AddClusterReq` 等加
     tag（`validate:"required,hostname|ip"` 等）；
  3. 统一 400 错误封装 `{error, fields}`。

#### G-P2 — 事件流未按用户过滤（隐私/权限）

- `handler/portal/events.go` 仅挂 `AdminRoutes`；即便如此，
  `StreamEvents` 不按 project/user 过滤即订阅 Incus 全集群
  lifecycle（line 51-58）。
- 如果按 P1-5（前述）把 `/events/ws` 开放给 portal，必须：
  - 在 `events.go` 读取 user VMs（repo 查询）→ 构造白名单；
  - 从 Incus 接收帧后在服务端过滤再转发浏览器；
  - 事件元数据校验（防伪造 vm_id）。
- Phase F 应包含该后端子任务。

#### G-P2 — `h.clusters.List()[0]` 惯用法散落 8 处

- grep 结果：
  - `handler/portal/order.go:139` Pay 选第一个集群；
  - `handler/portal/events.go:39` 默认第一个集群；
  - `handler/portal/vm.go:221` 类似；
  - `internal/server/server.go` 启动日志；
  - 多处 admin handler fallback。
- 后果：多集群部署退化为单集群，且 clusters map 无序，随进程重启
  可能变。
- 修法：
  - `cluster.Manager` 增加 `Primary() *Client`（按 config 顺序）
    或 `FindByProductID(pid)`；
  - 调用方显式声明选择策略，禁止 `List()[0]`。
- Phase A.0 或独立小 task 完成。

#### G-P2 — pma-go 数据访问层偏离

- 仓库使用 `database/sql` + 手写 SQL + 位置参数，**既没有 sqlc
  也没有 GORM**。
- pma-go baseline 列的是 "sqlc + pgx"（required default）或
  GORM（alternative）。当前选型介于两者之间，且无编译期安全。
- 不必纳入 PLAN-011，但应在 plan risks 里声明"后端 data access
  不符合 pma-go default，另立 REFACTOR-002"。

#### G-P2 — koanf 配置与 env 分散

- `grep os.Getenv` 未彻查，但 pma-go 要求 "never read process env
  directly inside domain logic"。Phase A.0 顺便在
  `internal/config` 统一所有 env 入口。

#### 修订后的 PLAN-011 结构建议

原 5 阶段扩为 7 阶段：

| 阶段 | 范围 | 层 |
|------|------|----|
| **Phase A.0 (新)** | 后端契约修复 | Go |
| Phase A | 前端数据层钩子化 + 缓存键标准化 | TS |
| Phase B | 前端 i18n 覆盖 | TS |
| Phase C-frontend | 前端组件从 route 抽到 features | TS |
| **Phase C-backend (新)** | handler/portal ↔ handler/admin 拆包 + service 抽取 | Go |
| Phase D | 前端 UI primitives + style drift | TS |
| **Phase F (新)** | 后端 `/api/portal/events/ws` + 前端事件 hooks + 轮询削减 | Go + TS |
| Phase E | 测试 + CI | Go + TS |

Phase A.0 具体交付物清单：
1. migration `004_drop_vm_password.sql` + repo 移除 password 列；
2. migration `005_seed_clusters.sql`（方案 A）或 `005_vm_cluster_name.sql`（方案 B）；
3. `internal/repository/cluster.go`（方案 A）；
4. `cluster.Manager` 增加 ID↔Name 映射；
5. `internal/handler/portal/dto.go`（VMServiceDTO、OrderDTO 等）；
6. `handler/portal/vm.go` 的 `ListServices` / `GetService` /
   `CreateService` / `Pay` 迁移到 DTO；
7. `findClusterName(mgr, clusterID)` 实现正确映射；
8. 删除 3 处 `ClusterID: 1` 硬编码，改用真实 ID；
9. `service/order.go` 编排 Pay → IP → VM → DB，带补偿；
10. `go-playground/validator` 引入与 `CreateOrderReq` /
    `AddClusterReq` / `NodeOpsReq` 的 tag 化；
11. 对应单元测试：`service/order_test.go`、
    `repository/cluster_test.go`、`handler/portal/vm_test.go`
    断言响应含 cluster_name / project 字段。

### 自查（三轮）

**二轮自查 2026-04-17 02:00（前端 / User Journey）**

- ✅ 覆盖所有 sidebar 6 + 17 条路径的核心查询键；
- ✅ 覆盖 WebSocket 通道（只有一条，仅 admin 使用）；
- ✅ 追溯 Portal VM 生命周期 UI → hook → http → Go handler →
  cluster manager；
- ✅ 审计 `refetchInterval` 全 20 处；
- ✅ 对比 `admin/create-vm` 与 `features/vms/api.ts` 的重复逻辑；
- ⚠️ 尚未执行：Ceph OSD out/in → VM 可用性链路、SSH key inject
  → VM cloud-init 注入细节。原因：前者是只读只观察，后者 Phase
  A.0 改造时会自然串起。

**三轮自查 2026-04-17 02:30（后端 / pma-go 基线对齐）**

- ✅ 对齐 pma-go baseline 的"文件/分层/错误/日志/验证/配置/数据
  访问"七项，发现 G-P0×2、G-P1×5、G-P2×3；
- ✅ 追溯 clusters 表 → FK 引用 → Manager → scheduler 全链路，
  证实运行时与 schema 脱钩；
- ✅ 追溯订单支付 → IP 分配 → VM 创建 → DB 插入 → 审计五步链，
  确认无事务 / 无补偿；
- ✅ grep 确认 `database/sql` 手写 SQL、未使用 sqlc / GORM /
  go-playground/validator；
- ✅ 确认 `h.clusters.List()[0]` 在 8 处构成多集群退化；
- ⚠️ 未做：admin/ceph、admin/ip-pools handler 的 service 层抽取
  细节、`cmd/server/main.go` 是否通过 goose 驱动 migration。
  两项归 REFACTOR-002，PLAN-011 仅在 Risks 声明"data access 
  选型偏离 pma-go default，另立 plan 处理"即可。

### 实施进度

- **Phase A.0（后端契约）— 核心闭环已完成 (2026-04-17)**
  - ✅ `model.Cluster` + `ClusterRepo.Upsert/GetByName/GetByID/List`
  - ✅ `cluster.Manager` 增加 `idByName` / `nameByID` 映射表，
    `SetID` / `IDByName` / `NameByID` / `DisplayNameByName` 方法
  - ✅ `cmd/server/main.go` 启动时 `Upsert` 每个配置集群、
    绑定 DB id ↔ 名称
  - ✅ `handler/portal/dto.go` 新增 `VMServiceDTO`（**省略 password
    字段**）、`NewVMServiceDTO` / `NewVMServiceDTOList` 构建器
  - ✅ `ListServices` / `GetService` 输出 `{"vms": [...]}` / `{"vm": ...}`
    信封（替代 `services` / `service`）
  - ✅ `findClusterName` 改为走 `Manager.NameByID(id)` + 回退，修复多集群
    VM 动作路由走错集群的 P0
  - ✅ 移除 3 处 `ClusterID: 1` 硬编码（vm.go CreateService、
    AdminVMHandler.CreateVM、order.go Pay）
  - ✅ `dto_test.go` 覆盖 password 脱敏、cluster 解析、项目回退、
    IP 指针解引、批量顺序
  - 🟡 延后：`migration 004 drop vms.password` 需先迁 
    `vm_credentials` 备份；`go-playground/validator` 可在 Phase
    C-backend 一起引入；`service/order.go` 支付编排与补偿抽取并入
    Phase C-backend。

- **Phase A（前端数据层）— 已完成 VM 钩子 + 契约对齐 (2026-04-17)**
  - ✅ `features/vms/api.ts` 新增 `vmKeys` 前缀键
    (`["vm", "list", ...]` / `["vm", "detail", id]`) 并统一
    mutation invalidation；新增 `useMyVMDetailQuery`
  - ✅ `VMService` 接口补 `cluster / cluster_display_name / project /
    updated_at`、**移除 password 字段**
  - ✅ `routes/vms.tsx` 改用 `useMyVMsQuery` / `useVMActionMutation`，
    删除内联 inline interface，Console / SnapshotPanel 的 cluster /
    project 从 DTO 读取，不再硬编码 `cn-sz-01 / customers`
  - ✅ `routes/vm-detail.tsx` 改用 `useMyVMDetailQuery` /
    `useVMActionMutation`，Console / SnapshotPanel 同样走动态值
  - ✅ `routes/index.tsx` `vmsData.services` → `vmsData.vms`
  - ✅ `bunx tsc --noEmit` + `vite build` 通过
  - ✅ **Phase A 全量迁移完成 (2026-04-17)** — 所有 admin / portal 路由
    不再直调 `http.*`，统一消费 feature 钩子：
    - `features/clusters/api.ts` 扩展 `clusterKeys.all`、增加
      `useEvacuateNodeMutation` / `useRestoreNodeMutation` /
      `useAddClusterMutation`；
    - `features/vms/api.ts` 增加 `ClusterVMsResponse` / `AdminCreateVMParams`
      / `useMigrateVMMutation` / `useAdminCreateVMMutation` /
      `useResetVMPasswordMutation`，`useClusterVMsQuery` 增 enabled 守卫；
    - `features/monitoring/api.ts` 增 `monitoringKeys` + `useHealthQuery`；
    - `features/billing/api.ts` 增 `AdminOrder` / `AdminInvoice` +
      `useAdminOrdersQuery` / `useAdminInvoicesQuery`；
    - `features/products/api.ts` 规范 `Product` / `ProductFormData` +
      `useAdminProductsQuery` / `useCreate|UpdateProductMutation`；
    - 新建 `features/ip-pools/api.ts`、`features/audit-logs/api.ts`、
      `features/nodes/api.ts`、`features/storage/api.ts`，覆盖
      IP Pools / IP Registry / Audit Logs / Nodes / HA / SSH /
      Ceph status / OSD tree / Pools / OSD in-out；
    - 涉及路由：`admin/{clusters, vms, vm-detail, create-vm, tickets,
      orders, invoices, ip-pools, ip-registry, audit-logs, ha, nodes,
      node-ops, node-join, products, storage, monitoring}` +
      portal `{index, vm-detail}`；
    - 顺便修复 `monitoring` `UsageBadge` 与 `storage` `HEALTH_WARN`
      的颜色漂移 (`yellow-500/20 text-yellow-600` /
      `text-yellow-500` → `bg-warning/20 text-warning` /
      `text-warning`)；
    - `bunx tsc --noEmit` + `bunx vite build` 通过；
    - `rg "http\.(get|post|put|delete)" src/app/routes` 返回 0 条。

### 风险补遗

- **Phase A.0 工作量被低估**：合并后端 DTO、password 脱库、
  cluster ID 体系、订单事务四件事，大概率需独立 PR，与前端
  Phase A 解耦；若同 PR 会阻塞前端进度。建议 Phase A.0 单独拉
  backend-only PR，前端 Phase A 基于 A.0 的响应契约（可先 mock）
  并行。
- **migration 004（drop password）的生产回滚路径**：现网
  `vms.password` 列有真实数据，如需保留历史密码需先迁到
  `vm_credentials(vm_id, encrypted_password, created_at)` 表，
  再做 drop，避免不可逆数据丢失。
- **方案 A（clusters 表主导）影响面**：一旦 `vms.cluster_id`
  改用真实 ID，所有历史 `cluster_id=1` 行要有数据修复脚本核对
  真实集群名，避免错映射。脚本需包含人工确认步骤。
