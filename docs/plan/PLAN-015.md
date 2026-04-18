# PLAN-015 QA-004 后续修复 —— N1-N15 清单

- **status**: completed
- **createdAt**: 2026-04-18 16:30
- **completedAt**: 2026-04-18 18:42
- **relatedTask**: QA-005

## Context

2026-04-17 生产 QA (`tmp/QA-REPORT-2026-04-17.md`) 发现 15 项新 Bug。
其中 N4 (monitoring 空态误导) 已在 commit `2943976` 修复；VM 漂移根治由 PLAN-014 负责。
本 plan 处理剩余 12 项可操作的前后端 Bug。

## Out of Scope

- **N4 / N14**: VM 状态漂移反向同步 — 由 PLAN-014 / INFRA-006 负责
- **N9**: `/oauth2/callback` 500 — PLAN-013 Phase B 已结论为扫描器误报
- **N10**: 安全响应头 — PLAN-013 Phase B 已转交 Cloudflare Transform Rules
- **N7**: `/api/*` 不带 `Accept: application/json` 时返 HTML —
  影响有限（真实浏览器/fetch 默认带 Accept）；需动 oauth2-proxy `--api-route`，
  暂延到下次运维窗口

## Phase A — 前端简单修复（CSS / UI 层）

### A.1 N1 — CJK 字体回退 + `<html lang>` 同步 [P1]

- `index.css`：body 字体栈追加 `"PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC"` fallback
- `app/i18n.ts`：i18next 初始化时 & `languagechanged` 事件里 `document.documentElement.setAttribute('lang', lng)`
- 单测：略（浏览器渲染层）；生产回归用截图验证

### A.2 N5 — Audit log target 渲染优先级翻转 [P2]

- `features/audit-logs/**` 或 route 直接处理：UI 组件优先读 `details.name || details.host || details.osd_id`，缺失时 fallback `#target_id`
- 单测：新加一个 render 测试覆盖 vm.create / vm.delete / ceph.osd_in / node.exec 四种形态

### A.3 N11 — Node Ops IP/hostname 前端校验 [P3]

- `app/routes/admin/node-ops.tsx`：加 IPv4 + hostname (RFC 1123) 正则
- 不合法时禁用 Test SSH 按钮 + 红框 + 错误提示
- 单测：utils 层加 `isValidHost` 3 条正/反用例

### A.4 N13 — VM 用户名按 image 映射 [P3]

- `features/vms/*` 卡片渲染处：image 含 `debian` → `debian`，`rocky` → `rocky`，默认 `ubuntu` (现有行为)
- 或从后端 DTO 新增 `default_user` 字段返回（若已有，直接用）
- 选最小改动：前端映射 + 兜底

### A.5 N15 — Audit IP 列去掉 CIDR 后缀 [P3]

- audit-logs 渲染 IP 列时 `ip.replace(/\/(32|128)$/, '')`

### A.6 N12 — 移动端表格溢出 [P3]

- 所有含 `<table>` 的 admin 页面包一层 `<div class="overflow-x-auto">`
- 长远：< md 断点切卡片视图（参考 storage 页）— 本期只补 overflow-x 兜底

## Phase B — 前端路由/视图新增

### B.1 N2 — Portal Tickets 详情入口 [P1]

- 新增路由 `app/routes/tickets/$id.tsx`（或 `tickets.$id.tsx`，按 TanStack Router 惯例）
- 列表 Subject 列包 `Link` 到 `/tickets/{id}`
- 详情页展示工单正文 + 回复历史（backend 已有 `/api/tickets/:id`）+ "添加回复" 表单
- 单测：hook + 路由组件

### B.2 N6 — `/admin/$catchall` 404 组件 [P2]

- 新增 `app/routes/admin/$catchall.tsx` 或 `admin.not-found.tsx`，复用根 404 组件
- 确保跟 `/this-route` 样式一致，有 "Back to Dashboard" 链接

## Phase C — i18n 大扫除

### C.1 N3 — 硬编码中文批量接入 i18next [P2]

- 脚本：`grep -rnP '[\x{4E00}-\x{9FFF}]' incus-admin/web/src --include="*.tsx"`
- 归并到 `app/i18n.ts` 现有 `en`/`zh` 资源
- 按页面优先级顺序：
  - `admin/products.tsx`（全中文）
  - `admin/nodes.tsx`（全中文）
  - `admin/node-join.tsx`（部分）
  - `admin/tickets.tsx`（部分）
  - `admin/observability.tsx`（"实时事件流"等）
  - `admin/users.tsx`（"配额"等）
  - `admin/vm-detail.tsx`（"内存/磁盘/网络"）
  - `ssh-keys.tsx` / `tickets.tsx` / `api-tokens.tsx` 空态/按钮

## Phase D — 后端 API 格式统一

### D.1 N8 — 404/405 响应改 JSON + 补 GET-by-id [P2]

- Router 挂 `NotFound` / `MethodNotAllowed` handler 返 `{"error":"not found"}` / `{"error":"method not allowed"}`
- 补 `GET /api/admin/orders/{id}`（从现有 repo `GetByID` 拼装）
- 补 `GET /api/admin/products/{id}`（若后端 repo 无则先加）

### D.2 审计字段补齐（N5 复核）

- 确保 `vm.create` audit 写入时 `target_id` 填新 VM 的 id，**同时** `details.name` 写入 VM 名
- UI 侧 A.2 会解决渲染问题；但后端同步确认数据完整

## Risks

1. **i18n 规模**：硬编码中文可能 200+ 处，打标签会触达多个 feature 的 hooks。拆页面单独提交降低合并冲突。
2. **Tickets 详情**：如果 `/api/tickets/:id` 或 `/api/tickets/:id/replies` 后端未暴露，需要同步补。
3. **404 处理器挂载位置**：必须在路由定义之后、fallback 之前，否则被默认 Go mux 劫持。
4. **产品 GET-by-id**：避免与 slug-based 路由冲突（现有 PATCH/DELETE /api/admin/products/{id} 应已限制为 numeric）。

## Scope

- ✅ Phase A 六项小修
- ✅ Phase B Tickets 详情 + admin catchall 404
- ✅ Phase C i18n 批改（以"关键页全覆盖、长文可继续迭代"为验收标准）
- ✅ Phase D 后端 404/405 JSON 化 + 两条 GET-by-id
- ❌ 不做 admin 表格响应式卡片视图改造（仅加 overflow-x 兜底）
- ❌ 不做 API HTML 401 反代修复（N7）
- ❌ 不做 oauth2-proxy callback 500 / CDN 安全头（N9/N10）

## Verification

- 本地 `cd incus-admin && task lint && task test`（后端），`cd web && bun run typecheck && bun run test && bun run build`（前端）
- 本地 `task build` 产出 `bin/incus-admin`；`bun run build` 产出 `web/dist`
- 通过 AIssh 部署到 139.162.24.177：`file_deploy` 二进制 + `dist/*` 静态资源；`systemctl restart incus-admin`
- 浏览器回归：在 `vmc.5ok.co` 验收 N1 (CJK)、N2 (tickets detail)、N3 (en 模式文案)、N5 (audit target)、N6 (admin 404)、N8 (API 404 JSON)、N11 (ip validate)、N12 (mobile table)、N13 (username)、N15 (ip trim)

## Alternatives

- **一次性大 PR**：风险大，i18n 变更面广 — 拒绝
- **拆 4 个 PR（A/B/C/D）**：推荐，便于 review 和回滚
- **暂缓部分 P3**：若 C.1 工作量超预期，P3 N12/N13 可留下一轮 — 作为 fallback
