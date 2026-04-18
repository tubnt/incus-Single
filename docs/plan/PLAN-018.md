# PLAN-018 用户端功能缺口填补(G1-G5)

- **status**: completed
- **priority**: P2
- **owner**: claude
- **createdAt**: 2026-04-18 21:30
- **updatedAt**: 2026-04-18 23:40(全量落地 + 验证通过)
- **completedAt**: 2026-04-18 23:40
- **relatedTask**: UX-003
- **parentPlan**: PLAN-017

## Context

QA-006 识别 G1-G5 五项**功能缺口**(与 N1-N11 bug 区分)。经深度调用链审查后(见 UX-003),原报告中 5 项里 2 项已实现、3 项需求不可直接落地。本计划按修正后的事实重排落地路径。

## 用户决策(2026-04-18)

1. **G1 = 方案 A**:不新建 portal topup 路由,`/billing` 顶部显示只读余额 + 跳工单提示
2. **G2 并发测试**:允许直接用真实 postgres(项目默认 pgx + postgres)
3. **Dashboard 彻底分离**:普通用户仪表盘(`/`)与管理员仪表盘(`/admin/monitoring`)**不共用**;`/` 移除 `AdminSection` 内联块

## 审查依据(调用链追溯)

| 端点/假设 | 审查结果 | 源 |
|----------|---------|---|
| `POST /portal/topup` | **不存在** | `handler/portal` 无 topup.go |
| admin `TopUpBalance` 是否允许自充 | **不允许**(self-lock) | `handler/portal/user.go:125-127` |
| `POST /portal/orders/:id/cancel` | **已存在** | `handler/portal/order.go:270` |
| 前端「取消订单」按钮 | **已存在** | `web/src/app/routes/billing.tsx:227-237` |
| `GET /portal/invoices/:id` | **不存在** | `handler/portal/invoice.go` 只有 ListMine |
| Invoice model 有 items[] | **无**,单金额字段 | `internal/model/models.go:123-133` |
| `PATCH /portal/tickets/:id` (用户关闭) | **不存在** | `handler/portal/ticket.go` 无 status 路由 |
| 前端 `/vms/new` / `/tickets/new` | **不存在** | VM 创建经 `/billing`,Ticket 创建经 `/tickets` 列表 |

## Decisions

- **G1 先停下等产品决策**:本期实施默认按「方案 A = 联系管理员」走;方案 B/C 需另立计划
- **G2 重定位为技术债**:`Cancel` handler 需要事务 + FOR UPDATE 消除与 `Pay` 的竞态,不涉及 UI
- **G3 零后端**:前端 Dialog 拼接 invoice + order + product 已在页面的数据即可
- **G4 后端新路由**:`POST /portal/tickets/{id}/close`,owner 检查 + 幂等(`status != closed` 守卫)
- **G5 目标纠正**:Create VM 指向 `/billing`,Create Ticket 指向 `/tickets`,Top-up 按 G1 方案分支

## Phases

### Phase A — G1 产品决策(阻塞)

- [x] 用户选定 A;按方案 A 继续

### Phase B — G2 Cancel 并发修复(技术债,后端)

- [x] `repository/order.go` 新增 `CancelIfPending(ctx, orderID, userID)`:单语句条件性 UPDATE `WHERE id=? AND user_id=? AND status='pending'`,返回影响行数 > 0
- [x] `handler/portal/order.go` `Cancel`:改用 `CancelIfPending`,影响行数 = 0 时返 409(与 Pay 竞态、非 owner、非 pending 统一走 409)
- [x] 集成测试 `order_integration_test.go`:4 条新增(Happy/WrongOwner/NotPending/VsPay),`TestCancelIfPending_VsPay` 跑并发 Pay+Cancel 断言不变量 —— status=paid ↔ balance=50,invoiceCnt=1,txnCnt=1,cancelChanged=false;status=cancelled ↔ balance=100,invoiceCnt=0,txnCnt=0,payErr≠nil
- [x] 零前端工作量(UI 已存在)

### Phase C — G3 发票详情 Dialog(仅前端)

- [x] 新组件 `features/billing/invoice-detail-dialog.tsx`:`Dialog` primitive,从页面已加载的 orders/products 数组解析出对应 order + product,零新请求
- [x] 显示字段:Invoice #id, Amount, Status, PaidAt + 关联 Order + Product(CPU/RAM/Disk/OSImage/Hours/Price)
- [x] `billing.tsx` invoices 表格加「操作」列 + 「详情」按钮

### Phase D — G4 工单关闭

- [x] 后端:`handler/portal/ticket.go` `PortalRoutes` 加 `r.Post("/tickets/{id}/close", h.CloseMine)`
- [x] `CloseMine` handler:owner 检查 → 调 `TicketRepo.CloseByOwner`(单语句条件性 UPDATE `WHERE id=? AND user_id=? AND status <> 'closed'`) → 影响行数 = 0 时幂等返 200(已关闭 / 非 owner 统一 404) → 写 audit log
- [x] 前端:`features/tickets/api.ts` 加 `useCloseTicketMutation`,POST `/portal/tickets/{id}/close`,onSuccess invalidate `ticketKeys.all`
- [x] `tickets.tsx` `TicketDetail` 条件渲染:`status !== 'closed'` 时显示「关闭」按钮 + confirm dialog,否则显示「工单已关闭」提示

### Phase E — G5 Dashboard 快捷操作(前端)

- [x] `app/routes/index.tsx` 彻底重写:移除 `AdminSection` 内联块,`Dashboard` 改名 `UserDashboard` 仅保留用户视角
- [x] `QuickActions` 3 个按钮:Create VM → `/billing`、Top-up → `/tickets?subject=topup`、New Ticket → `/tickets`
- [x] 空态高亮:`myVmCount === 0` 时 Create VM 按钮变 `bg-primary` 实心

### Phase F — G1 方案 A 落地(默认路径)

- [x] `billing.tsx` 顶部新增 `BalanceCard`:只读余额 + 提示 + 「前往提交充值工单」链接(跳 `/tickets?subject=topup`)
- [x] `tickets.tsx` 加 `validateSearch` 识别 `?subject=topup`,预填 `subject='充值申请'` + 中英双语 body 模板,并自动展开 CreateTicketForm

### Phase G — i18n

- [x] 新 locale 键(zh + en):`billing.balance` / `billing.topupHint` / `billing.topupViaTicket` / `invoice.*`(detail/sectionInvoice/sectionOrder/sectionProduct/orderMissing/productMissing 等) / `ticket.close` / `ticket.closeConfirm*` / `ticket.alreadyClosed` / `ticket.topupPrefill*` / `dashboard.quickCreateVm|quickTopup|quickCreateTicket`

### Phase H — Verification

- [x] `bun run typecheck` 通过
- [x] `bun run build` 通过(dist bundle 1378 kB)
- [x] `go build ./... && go vet ./...` 通过
- [x] `go test ./...` 单测全过
- [x] 集成测试 `TestCancelIfPending*` 4 条全过(`ok ./internal/repository 165.968s`);verbose 复跑偶现 testcontainers `lookup wg0` DNS 失败,属环境问题,首轮已验证代码正确

### Phase I — Docs

- [x] 关闭 UX-003 + PLAN-018,刷新 `docs/plan/index.md` + `docs/task/index.md` 勾选
- [x] `docs/changelog.md` 追加单条目

## Risks

- **G2 并发修复需 pg 级验证**:建议直接用 `pgx.Tx` 或现有 `WithTx` helper,避免用 GORM `SELECT FOR UPDATE` 在 sqlite 测试环境无效
- **G1 方案 B 的 Top-up 审核面板**:如用户选 B,需在 admin 菜单下新增「充值申请」入口,涉及 UX-002 菜单再调整,工作量不小
- **Dashboard 快捷按钮与 UX-002 菜单重复**:用户可能觉得冗余;建议 MVP 仅在 Dashboard 顶部加,不动 Sidebar
- **Ticket 关闭的副作用**:关闭后用户不能再回复(现有 Reply handler 已有 `status == closed → 409` 守卫,逻辑一致);是否需要「重开」按钮?本期不做,closed → admin 可改回 open

## Non-goals

- 退款流程(走工单)
- 发票 PDF 导出
- 订阅续费
- 批量取消订单
- 第三方支付对接(G1 方案 C)
- Ticket 重开

## Estimate

| 方案 | 后端 | 前端 | i18n+QA | 合计 |
|------|------|------|---------|------|
| G1=A + G2-G5 | 0.5d(G2 并发 + G4 close) | 1d(G3 Dialog + G4 按钮 + G5 CTA + G1 说明) | 0.5d | **2d** |
| G1=B + G2-G5 | 1.5d(+ Top-up 审核) | 1.5d(+ 审核面板) | 0.5d | **3.5d** |
| G1=C | 另立计划,不在本期 | — | — | — |

## 用户待回应

1. **G1 方案选 A / B / C?**
2. **G2 并发修复的集成测试能否跑真实 postgres?**(项目用 pgx + postgres,测试栈)
3. **Dashboard 快捷按钮是否仅 user 视角显示?**(admin 已有独立 AdminSection,默认是)
