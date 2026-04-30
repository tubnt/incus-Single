# PLAN-022 前端 Linear 重设计 + 交互范式重构

- **status**: completed
- **priority**: P1
- **owner**: claude
- **createdAt**: 2026-04-29
- **reviewedAt**: 2026-04-29（深度审查 + 调用链追溯 + 用户旅程闭环）
- **approvedAt**: 2026-04-29
- **completedAt**: 2026-04-29（M1+M2 单会话完成；前端 typecheck/build/test 全绿；后端 batch API 待用户本地编译验证）
- **relatedTask**: UX-004（待建）
- **parentPlan**: —
- **referenceDoc**: `DESIGN.md`（Linear 风设计系统蓝本）

## Context

`vmc.5ok.co` 当前前端是从 PLAN-004 起逐步迭代而成（PLAN-007/011/015/016/017/018），功能已经闭环但**整体观感与交互从未做过统一规划**。本次目标是把整套 SPA 按 `DESIGN.md`（Linear 风暗色系设计系统）重写视觉层，并借机把**因迭代而堆积的交互负债**一次性清掉。

### 待解问题

| 类别 | 现状 | 期望 |
|------|------|------|
| 视觉 token | `index.css` 是通用 oklch 调色板，light 为默认；Inter 但无 cv01/ss03 | DESIGN.md 三层 token：`:root`(dark) / `.light` / `@theme inline` 映射 + Inter Variable cv01/ss03 + JetBrains Mono Variable 作 Berkeley Mono 替身 |
| primitive 库 | 仅 3 个手写 primitive（`confirm-dialog`/`pagination`/`skeleton`），其余按钮/卡片/徽章/状态全部页面内联 Tailwind 类 | shadcn CLI 初始化（base-nova + base-ui），完整 primitive 集 |
| 布局 shell | `app-header.tsx` + `app-sidebar.tsx` 手写、无面包屑、无命令面板、无全局搜索 | 重写 layout：Header + Sidebar + PageShell + CommandPalette |
| 表格行操作 | `admin/vms.tsx` 单行内联 8 个按钮（Start/Stop/Restart/Console/Monitor/Snapshots/Reinstall/Rescue/Delete），移动端必爆 | 1 主操作（按状态切换） + DropdownMenu overflow，遵循 Carbon/PatternFly 标准 |
| 危险操作 | 仅 `confirm-dialog` 一个二次确认 | 不可恢复操作（删除 VM、重装系统、强制清理 Drift）使用**类型化确认**（输入资源名才能确认） |
| 状态展示 | 每页定义自己的 `StatusBadge`/`ActionBtn`/`StatCard`，颜色靠 `bg-success/20` 凑合 | 共享 `StatusDot` / `StatusPill`，遵循 DESIGN.md 5 级表面亮度阶梯 |
| 信息架构 | 三套并行 Dashboard（用户首页、admin/monitoring、admin/observability）功能边界模糊 | 明确层级：用户首页（自己资源）/ admin Overview（集群健康） / admin Observability（深度指标） |
| 键盘交互 | 无命令面板、无全局快捷键、无键盘导航 | Cmd+K 命令面板（路由 + 操作 + 最近访问），cmdk 库驱动 |
| 移动端 | 表格不塌缩、Header 不友好 | 卡片视图 fallback、sidebar 抽屉、关键操作放在底部固定栏 |
| 可访问性 | focus-visible 缺失、emoji 替代 ARIA 图标、shadow 模式无 role | 完整 focus ring、ARIA labels、prefers-reduced-motion 支持 |
| build pipeline | `task web-build && web-sync && build` 已稳定 | 保留，不动；nsl 作为 nice-to-have 不在本 PLAN |

### 范围

- **唯一前端面**：`incus-admin/web/`（SPA），通过 Go embed FS 服务（`internal/server/dist/`）
- **不在范围**：`/auth/emergency` 应急登录页（内联 HTML、localhost-only、与设计系统隔离）；后端 API；nginx/caddy；Go 模板（已确认全无）
- **i18n**：保留 zh/en 1:1 语义，迁移过程中删除孤儿 key + 把 `defaultValue` 内联中文统一收口到 `zh/common.json`
- **不动**：路由结构、Query key、auth 流程、API 调用 —— 仅换"长相和交互形态"，回归面收敛在 UI 层

## Decisions

1. **shadcn 路线 + token 覆盖**：用 `bunx shadcn@latest init`（base-nova、base-ui、Tailwind v4）生成 primitive 骨架，但 `src/index.css` 用 DESIGN.md 完整覆盖（5 级表面、Linear 调色板）。primitive 内部用 Tailwind 语义 token（`bg-background`、`text-foreground`、`border-border`），不直接 hardcode。
2. **暗色为原生**：`<html>` 默认 `dark` class，`light` 为可选切换；`index.css` 的 `:root` 直接放暗色 token，`.light` 放亮色覆盖（与 DESIGN.md 设计意图一致）。
3. **命令面板用 cmdk**：直接装 `cmdk` 包（headless、被 Linear/Raycast 验证），通过 shadcn `command.tsx` primitive 包装。Cmd+K / Ctrl+K 触发，三段：Recent / Pages / Actions（context-aware）。
4. **行操作模式**：每行最多 1 个 inline 主操作（按 VM 状态切换：Stopped → Start、Running → Console），其余进 DropdownMenu。批量操作走 checkbox + 顶部 sticky toolbar（Linear 模式）。
5. **类型化确认**：删除 VM、强制清理 Drift、重装系统、转移 Floating IP 必须输入资源名（VM name / IP）才能解锁确认按钮。
6. **数据表格统一走 TanStack Table**：抽 `<DataTable>` 高阶组件（columns + data + 服务端分页/排序/筛选），所有 list 页都迁移到这个组件。
7. **2 次交付**：
   - **M1**：底层 + Layout + 命令面板 + 模式手册 + 5 个高频页面（占总流量 ~80%）—— 一个 PR
   - **M2**：剩余路由批量迁移 + i18n 收口 + a11y 收尾 + 删除内联代码 —— 一个 PR
8. **不引入新框架**：保持 `react-i18next` / `zustand` / `sonner` / `recharts` / `xterm` 等已用库；新增仅 `cmdk`、`@tanstack/react-table`（headless 表格）、`react-hotkeys-hook`、`@fontsource-variable/inter` + `@fontsource-variable/jetbrains-mono`（自托管字体，OFL/Apache 2.0 许可）。**不**引入 `@nsio/nsl`（baseline nice-to-have，与本次重构无关）。
9. **回滚策略**：M1 单独成 PR、单独发布、单独 smoke test 后再启动 M2；如果 M1 上线后发现严重交互倒退，可整 PR revert（DOM 结构变化大但 API 完全不变）。

## Deep Audit Findings（审查补丁，强制纳入实现）

> 通过追溯调用链、模拟用户旅程、跨前后端比对发现的 22 个原 PLAN 未覆盖的缺口。每条都明确归属到 M1 或 M2，作为强制范围。

### A. 安全 / 认证旅程

**A1. Step-up 重认证后状态丢失（必须修，M1）**
- 现状：`shared/lib/http.ts:60` 在 401 step-up 响应时 `window.location.href = body.redirect` 全页跳走。OIDC 回调后用户回到原页面，但**所有 React state 清零**（输入到一半的资源名、打开的 dropdown、未提交的 form）。
- 影响所有 admin 敏感操作：删 VM、清理 Drift、Floating IP 转移、Shadow Login、Top Up。
- 方案：新增 `usePendingIntent` Hook + sessionStorage（TTL 5 分钟）。在 `http.ts` 抛 step-up 401 之前先存 `{action: "delete_vm", args: {...}, returnPath: location.pathname, createdAt}`；后端 `/api/auth/stepup-callback` 自带 302 回 `rd`，无需后端改动。`<AppShell>` mount 时**单次检查**：sessionStorage 有 intent + 未过期 + 当前 path = returnPath → 弹 confirm「检测到中断的操作：删除 vm-xxx，是否继续？」，同意后自定义事件 `replay:delete_vm` 触发原 mutation 重发。
- 备选（更优但工作量大）：silent reauth via popup window（OIDC 支持 `prompt=login` + `display=popup`）—— **不在 M1 范围**，M1 用 sessionStorage 即可。

**A2. Shadow Login 用 `window.prompt()` 收集理由（必须修，M1）**
- 现状：`admin/users.tsx:161` 用浏览器原生 prompt 收 reason。无 ARIA、无样式、无字符上限提示、无验证。
- 方案：替换为 `<ShadowLoginDialog>` 多步 Dialog（确认 → 输入理由 → 显示 redirect URL）。所有 `window.prompt/alert/confirm` 全站禁用（ESLint 规则）。

**A3. shadow header 红色与 DESIGN.md token 冲突（M1）**
- DESIGN.md 调色板里只有 `Brand Indigo` + 状态色 green/emerald；红色 `#e5484d` 没明确定义。`app-header.tsx` 的 `bg-destructive` 必须保留语义但 token 升级。
- 新增 token `--color-warning-strong` = `#e5484d`（暗色） / `#dc2626`（亮色），仅 shadow header 使用。

### B. UI 状态丢失 / 跳转

**B1. 13 处 `<a href>` 指向 SPA 路由，造成全页 reload（M1+M2）**
- 调用链：`admin/vms.tsx:309/329` `vms.tsx:70/86/104` `admin/ip-registry.tsx:60` `admin/vm-detail.tsx:124` `vm-detail.tsx:197` `console.tsx:40/52` `__root.tsx:22` `index.tsx:82` 等。
- 修复：统一改为 TanStack `<Link to>`；外部链接（`/oauth2/sign_out` `/shadow/exit` 表单 POST）保留 `<a>`/`<form>`。
- 验收：grep 后 `<a href="/...` 在 SPA 路由下零匹配。

**B2. VM 凭据明文展示（M1）**
- `admin/create-vm.tsx:56` `billing.tsx:62` 在创建 VM 后直接以 `font-mono` 明文显示用户名/密码，提示"将不再显示"。
- 方案：`<SecretReveal>` primitive：默认遮罩（`••••••••`）+ 显示按钮 + 复制按钮 + 8s 后自动复盖；关闭组件时清除 React state，不残留 console.log。
- 仅 admin 创建/重装 VM、shadow login redirect URL 使用。

### C. 路由 / 旅程闭环

**C1. 控制台路由全屏化（M1）**
- 当前 `/console` 仍套 `RootLayout`（sidebar + header），xterm 区域被压成 `height: 500px`。Linear/DigitalOcean 都把控制台做成"workspace mode"。
- 方案：`/console` 路由不嵌入 RootLayout（`__root.tsx` 加 path-aware 判断），独立全屏；左上角浮 Logo + Back，右上角浮 Disconnect / Reconnect / Fullscreen。
- 同时 xterm theme 改读 CSS variable（去掉 hardcode `#0d1117` `#c9d1d9`）。

**C2. Cmd+K vs xterm 焦点冲突（M1）**
- xterm 捕获所有键盘输入。当用户在控制台时按 ⌘K 既要进 xterm 也要进命令面板，行为不可预期。
- 方案：全局快捷键 hook 用 `useHotkeys` 的 `enableOnFormTags: false` + 自定义 scope；`/console` 路由 mount 时禁用全局 scope，命令面板按钮在 header 仍可点。Esc 退出 fullscreen 时恢复全局 scope。

**C3. NodeJoinWizard 步进缺乏 `<Stepper>` primitive（M2）**
- `admin/node-join.tsx:1-231` 4-step 手写 stepper（按钮+条件渲染）。Create VM 也是隐式多步。
- 方案：抽 `<Stepper>` primitive（步骤指示 + 步骤内容 + Prev/Next 控制 + 完成态），用于 node-join 和 create-vm（如果用户选择多步模式）。

**C4. 行内 `showSnaps/showMetrics/showReinstall` 模态（M1）**
- `admin/vms.tsx:226-228, 378-399` 在 `<tr>` 下面再插一个 `<tr colspan=6>` 嵌入面板。表格滚动 / 排序 / 重渲染时面板会跳动；多个同时打开导致行展开错乱。
- 方案：迁到 Sheet（slide-over from right）：点 "Snapshots" 打开右侧抽屉；同一时刻只允许一个 Sheet 打开；URL 带 `?sheet=snapshots&vm=...` 可分享。

### D. 性能 / 数据流

**D1. 查询轮询无 background 抑制（M2）**
- 17 处 `refetchInterval`（10/15/30/60s），Tab 切走仍持续。
- 方案：在 `query-client.ts` 默认配置加 `refetchIntervalInBackground: false`、`refetchOnWindowFocus: "always"`（tab 回到前台立即拉一次新鲜数据）。
- 验收：DevTools Network 面板下，hidden tab 时无周期请求。

**D2. WebSocket 事件没驱动 query invalidate（M2）**
- 后端有 `/api/admin/events/ws` 推 lifecycle/operation 事件，但 `admin/observability.tsx` 只把它做"事件日志展示"。VM 状态变化仍靠 10s 轮询拉。
- 方案：在 `<AppShell>` 全局开 ws（admin only），按 lifecycle.{started,stopped,deleted}/operation.* 事件类型触发 `queryClient.invalidateQueries({ queryKey: vmKeys.all })`。
- 命令面板的 Recent + Pending Operations 也复用这个事件流。

**D3. xterm 颜色 hardcode（M1）**
- `features/console/terminal.tsx:25-30` 硬编码 4 个十六进制色。
- 方案：terminal.tsx 用 `getComputedStyle(document.documentElement).getPropertyValue('--xterm-bg')` 读 CSS 变量；新增 token `--xterm-bg/fg/cursor/selection`。dark/light 切换时重建 terminal theme（`terminal.options.theme = ...`）。

**D4. ProductCard 内联 expand 流程（M1）**
- `billing.tsx ProductCard` 用 `expanded` 状态切换"显示价格 → 展开 OS 选择 + 名字 → 提交"。点击不在视口内的卡片时其他卡片仍为收起，但已展开的下方滚动会乱。
- 方案：拆 `<ProductCard>`（仅展示） + `<PurchaseSheet>`（点 Buy 弹右侧抽屉，在抽屉里选 OS、命名、付款）。整页只一个抽屉，避免布局跳动。

### E. 可访问性（M2 收尾）

**E1. 全站 0 处 `focus-visible` / `focus:ring`（M2）** —— 整站无键盘焦点视觉。`@theme` 加 `--ring` token + Tailwind v4 默认 ring 的 plugin 启用。
**E2. 仅 18 处 `aria-label`** —— 大量 icon-only 按钮（语言切换、主题切换、菜单）无可访问名。M2.C 全检。
**E3. 部分按钮用 emoji（"⚠"）作图标** —— 屏幕阅读器读出"warning sign"，混乱。改 lucide-react 图标 + `aria-hidden="true"` + 旁边可见标签。

### F. 后端契约 / 兼容性

**F1. 无 batch 删除 API（M2）**
- `internal/server/server.go` 路由是 chi 单实体 `r.Delete("/admin/vms/{name}")`。M2 多选 + 批量操作只能前端 N 个并行 mutate + 错误聚合（用 `Promise.allSettled`）。
- 在 PLAN 标 ⚠ 后端跟进：建议 PLAN-023 加 `POST /admin/vms:batch` 之类的端点，事务化 + 部分失败可回滚。**M2 不做后端**，前端用 N 并行兜底。

**F2. CSV export 100k 行无进度条（M2）**
- `admin/audit-logs.tsx:32` 用 `<a href download>` 直链触发，浏览器只显示"下载中"小图标。
- 方案：保持下载方式，但加 `<DownloadButton>` 包装：点击后 mutation 调 `HEAD /api/admin/audit-logs/export?count=true` 拿预估行数（如果后端支持）→ 显示 toast "正在导出 N 行..."；下载完成或失败给反馈。后端是否支持 count 待验，不支持就退化为简单 toast。

**F3. SPA 路由 fallback 仰赖 Go embed（M1 注意）**
- `internal/server/server.go:164-166` 嵌入 `web/dist`。新增路由（如 `/internal/_design`）必须**仅 dev 环境路由**，不能进 production 包；用 `import.meta.env.DEV` 守卫。

### G. 视觉 / 排版细节

**G1. Vite 插件升级（M1.A）** —— `TanStackRouterVite` 已 deprecated，改 `tanstackRouter`（小写），按 pma-web baseline。
**G2. 主题切换从循环改下拉（M1.C）** —— `app-header.tsx:24` 现 click 在 dark/light/system 三态循环，对用户不友好（点错要循环回来）。改用 shadcn DropdownMenu 显式 3 选项。
**G3. 字体加载策略（M1.A）** —— `@fontsource-variable/inter` 用 woff2 + `font-display: swap`，避免 FOIT；预加载 latin subset，按需加载 cyrillic/greek。
**G4. Toast 位置 vs sidebar collapse（M1.C）** —— sonner 默认 `top-right`，sidebar 收起时无冲突；展开时（mobile drawer 模式）会被 drawer overlay 挡。验证后如冲突改 `top-center`。
**G5. Mobile 底部固定操作栏（M1.E + M2.A）** —— `/admin/create-vm` `/billing` 长表单在 mobile 下，主操作按钮在页底要滚到底；新增 `<MobileBottomBar>`，仅 <md 显示，包含主操作 + 取消。

### H. 类型化确认范围矩阵（M1.B 实现 primitive，全站使用）

> 26 处 `destructive: true` 的 confirm 点不全都需要类型化确认。下表是审查后的精确矩阵：

| 操作 | 文件 | 类型化？ | 理由 |
|------|------|--------|------|
| 删除 VM（admin） | `admin/vms.tsx:362` | **是** | 不可恢复 + 数据销毁 |
| 强制清理 Drift VM | `admin/vms.tsx:69` | **是** | 释放 IP，无回滚 |
| 重装系统 | `admin/vms.tsx:439` | **是** | 数据全清 |
| Rescue Enter（带快照） | `admin/vms.tsx:241` | 否（已经会拍快照） | |
| Rescue Exit Restore | `admin/vms.tsx:262` | 否 | 回到刚才的快照 |
| 删除用户 SSH key | `ssh-keys.tsx` | 否（可重新加） | |
| 删除 API token | `api-tokens.tsx` | 否（可重新加） | |
| 删除 firewall group | `admin/firewall.tsx:88` | 否（可重新加） | |
| 删除 OS template | `admin/os-templates.tsx` | 否（可重新加） | |
| Floating IP 转移 / 释放 | `admin/floating-ips.tsx` | **是** | 影响线上服务 |
| Shadow Login | `admin/users.tsx:152` | **是**（目前 + window.prompt） | 全权切换身份 |
| 用户角色降级 admin→customer | `admin/users.tsx:88` | **是** | 失去管理权限 |
| Top Up 充值 | `admin/users.tsx:105` | 否（金额输入即确认） | |
| 删除集群节点 | `admin/nodes.tsx` | **是** | 摧毁节点 |
| 删除 storage pool | `admin/storage.tsx` | **是** | 可能摧毁数据 |
| 删除工单 | `admin/tickets.tsx` | 否（关闭即可） | |
| 删除快照 | `snapshot-panel.tsx` | 否（频繁操作，已 confirm 足够） | |
| 删除 IP pool | `admin/ip-pools.tsx` | **是** | 影响 IP 分配 |
| 删除 cluster | `admin/clusters.tsx` | **是** | 摧毁集群引用 |
| 取消订单 | `billing.tsx:299` | 否 | 可重新下单 |
| 删除 VM（用户端） | `vm-detail.tsx`/`vms.tsx` | **是** | 同 admin |

**11 处必须类型化，15 处普通 confirm 即可。**

## UX / 交互重设计原则（模式手册）

> 这一节是 M1+M2 所有页面迁移的对照表。新写或迁移任何页面必须遵守。引用业界最佳实践：Carbon Design / PatternFly / Linear / shadcn 表格示范、Superhuman 命令面板。

### 1. 页面骨架

每个路由页统一用 `<PageShell>`：

```
<PageShell>
  <PageHeader
    title="所有云主机"
    breadcrumbs={[...]}
    description="跨集群 VM 总览，支持批量操作"
    actions={[<Button>新建 VM</Button>]}
  />
  <PageToolbar>      // 搜索、筛选、视图切换
  <PageContent>      // 主内容（表格 / 网格 / 详情）
</PageShell>
```

不再允许在路由文件里直接堆 `<h1>` + table。

### 2. 数据表格（DataTable）

| 元素 | 规则 |
|------|------|
| 列头 | 可点击排序时显示 chevron；列宽固定优先（避免内容变化跳动） |
| 行高 | 紧凑 36px（compact）/ 标准 48px（comfortable），用户偏好持久化 |
| 选择 | 第一列 checkbox（业务列表必备），选中后顶部出现 sticky `<BatchToolbar>` |
| 主操作 | 行末单一 inline 按钮（按状态切换标签：Stopped→"启动"、Running→"控制台"） |
| Overflow | 主操作右侧 `MoreHorizontal` 图标 → DropdownMenu，含其余动作（最多 7 项，超过分组） |
| 空态 | `<EmptyState>`：图标 + 标题 + 描述 + 单一 CTA |
| 错误 | `<ErrorState>`：红色边框 + 错误消息 + 重试按钮（不阻塞页面其他部分） |
| 加载 | Skeleton 匹配最终列结构（不是通用 spinner） |
| 移动端 | <640px 切卡片视图（每个 row 折叠成卡片），失去多选 |
| 分页 | 服务端分页：page/limit/sort/filter 走 URL 参数（可分享/前进后退） |

### 3. 状态指示

废弃各页自定义 `StatusBadge`，统一用：

```
<StatusDot status="running" />   // 8px 圆点 + label，inline 用
<StatusPill status="error" />     // pill 形 badge，独立显示用
```

状态色映射（DESIGN.md）：
- `running`/`active`/`success` → `#27a644` 实心圆点
- `pending`/`pending-action` → `#7170ff` 旋转圈
- `error`/`failed` → `#e5484d` 实心圆点
- `gone`/`stale`/`disabled` → `#62666d` 空心圆点
- `frozen`/`paused` → `#828fff` 半透明圆点

### 4. 表单

| 元素 | 规则 |
|------|------|
| 字段 label | 上方 14px weight 510，必填用 `*`（红色 0.5em） |
| 错误 | 字段下方红色 12px，提交后才显示（不要"写一个字红一次"） |
| 帮助文本 | label 右侧 `<Tooltip>`（图标 i），不挤占布局 |
| 提交 | 长表单 sticky bottom bar（取消 + 主操作） |
| 不可逆 | 类型化确认（见下） |

### 5. 危险操作 / 类型化确认

```
确认删除 VM？
此操作不可撤销，VM 内数据将永久丢失。

输入 VM 名称以确认: [vm-a3e86d]
                    [   _______________   ]   ← 必须精确匹配才能解锁

[取消]   [删除（红色，禁用直到匹配）]
```

适用：删除 VM、强制清理 Drift、重装系统、转移 Floating IP、删除集群节点、删除用户。

### 6. 命令面板（Cmd+K）

cmdk 驱动，`<CommandPalette>` 在根 layout 中常驻：

| 段 | 内容 | 来源 |
|----|------|------|
| Recent | 最近 5 条访问 | `localStorage` |
| Pages | 全部路由 + sidebar 可达项 | `sidebar-data.ts` |
| Actions | 上下文相关动作 | 当前路由声明的 `useCommandActions()` 钩子 |

举例：在 `/admin/vms` 上打开 Cmd+K，Actions 段会出现 "新建 VM"、"切换到用户视角"、"打开监控总览"；在某个 VM 详情页则出现 "启动/停止/控制台/重启"。

键盘：
- 全局：`⌘K` / `Ctrl+K` 打开
- 列表：`↑↓` 移动，`↵` 执行，`Esc` 关闭
- 字符前缀：`>` 强制 Actions、`/` 强制 Pages、`@` 搜资源（预留 M2+）

### 7. Toast 与非阻塞反馈

- 成功：`sonner` 默认（绿色，2.5s 自动消失）
- 错误：`sonner` 红色 + 5s + 关闭按钮
- 长事务（>1s 的操作）：在按钮内置 spinner（disabled），完成后转 toast
- 进度类（VM 创建中）：使用 SSE 已有通道，但用 `<ProgressSheet>` 抽屉展示，不再用 alert/toast

### 8. 颜色与 token 使用纪律

- 所有页面禁止 hardcode 颜色值（`#ffffff` / `rgb(...)` 等），只能用语义 token（`bg-background` / `text-muted-foreground` / `border-border` 等）
- 所有透明度叠加禁止 `/20` `/30` 这种 opacity scale，改用 DESIGN.md 5 级表面 token：`bg-surface-1` / `bg-surface-2` / `bg-surface-3`
- 单独增加 5 个 token：`--surface-1` ~ `--surface-5`（对应 `rgba(255,255,255,0.02)` 到 `rgba(255,255,255,0.05)`），暗色模式生效
- ESLint 规则：禁止 `style={{ color: '...' }}` inline 写颜色（除 chart 主题文件）

### 9. 排版规则

- 全局 `font-feature-settings: "cv01","ss03"` 写在 `body`（DESIGN.md 不可省略）
- 字号 token：`text-display-xl` (72px) / `text-display` (48px) / `text-h1` (32px) / `text-h2` (24px) / `text-h3` (20px) / `text-body` (16px) / `text-small` (15px) / `text-caption` (13px) / `text-label` (12px)
- 字重 token：`font-normal`(400) / `font-emphasis`(510) / `font-strong`(590)
- 严禁 `font-bold` (700)；DESIGN.md 上限 590

### 10. 信息密度 & 层级

- 用户首页（`/`）：3 个核心卡片（VM 数 / 余额 / 工单）+ 快捷操作 + 最近 VM 列表（top 5）
- admin Overview（`/admin/monitoring`）：集群健康全景（节点 / 总 VM / 失败任务 / 最近告警），不下钻
- admin Observability（`/admin/observability`）：图表深度指标，专给 ops 看
- 详情页统一 Tab 布局：Overview / Snapshots / Metrics / Firewall / Activity / Settings

## Phases

### Milestone 1 — 底层 + Layout + 命令面板 + 5 个核心页（M1）

> 单 PR 交付，估时 4-6 天。M1 上线后整站观感即换；剩余页面**保留旧观感临时不影响功能**（token 兼容层）。

#### M1.A 设计 token 重写 + 字体（0.5d）

- [ ] 重写 `src/index.css`：
  - `:root` → DESIGN.md 暗色 token（5 级表面 / 4 级文本 / 边框 / 焦点环 + xterm 4 token + warning-strong）
  - `.light` → 浅色覆盖
  - `@theme inline` → 映射 CSS 变量到 Tailwind 语义 token
  - `body` 加 `font-feature-settings: "cv01","ss03"`
- [ ] 自托管字体：`@fontsource-variable/inter`（默认）+ `@fontsource-variable/jetbrains-mono`（替代 Berkeley Mono）；`font-display: swap`
- [ ] **G1**：Vite 插件升级 `TanStackRouterVite` → `tanstackRouter`（小写，带 `target: "react"` + `autoCodeSplitting: true`）
- [ ] 删除现有 oklch token，保留语义名向下兼容（旧页面仍能渲染）
- [ ] 验收：黑屏不闪烁、Inter cv01/ss03 生效（"a"是单层）、Vite dev 启动不 warn

#### M1.B shadcn 初始化 + primitive 库（1.5d）

- [ ] `bunx shadcn@latest init`（base-nova、base-ui、不安装 Radix）
- [ ] 生成基线 primitive：`button` / `card` / `badge` / `input` / `textarea` / `label` / `dialog` / `alert-dialog` / `tabs` / `select` / `tooltip` / `dropdown-menu` / `table` / `sheet` / `separator` / `skeleton` / `command` / `popover` / `checkbox` / `switch` / `toggle` / `scroll-area` / `breadcrumb` / `avatar`
- [ ] 项目自有 primitive：
  - `status-dot` / `status-pill` —— 状态指示
  - `data-table` —— TanStack Table 高阶包装（columns + URL state + sticky toolbar）
  - `typed-confirm-dialog` —— 类型化确认（输入资源名解锁，**H 节矩阵的 11 个场景**）
  - `secret-reveal` —— **B2** VM 凭据/Token 安全显示（默认遮罩 + 复制 + 8s 自动复盖）
  - `pending-intent` Hook —— **A1** step-up 重认证后的意图恢复（zustand + sessionStorage TTL 5min）
  - `stepper` —— **C3** 多步流程指示
  - `mobile-bottom-bar` —— **G5** 移动端 sticky 操作栏
  - `filter-bar` —— **G2** 共享筛选栏（用于 audit-logs 等）
  - `download-button` —— **F2** 下载操作 + toast 反馈
- [ ] 替换现有手写 `confirm-dialog.tsx` / `pagination.tsx` / `skeleton.tsx` 为 shadcn 标准实现
- [ ] 装 `cmdk` + `@tanstack/react-table` + `react-hotkeys-hook`（替代手写键盘监听）
- [ ] **A1** 实现 `usePendingIntent` Hook：
  - 在抛 step-up 401 之前，`http.ts` 写 sessionStorage `pendingIntent = {action, args, returnPath, createdAt}`
  - `<AppShell>` mount 时单次检查：sessionStorage 有 intent + 未过期（5min TTL）+ 当前 location = returnPath → 弹 confirm "检测到中断的操作: <描述>，是否继续？"
  - 同意则发自定义事件 `replay:<action>`，对应路由订阅后用原 mutation 重发；不同意或过期清除
  - 后端 `/api/auth/stepup-callback` 现已 302 回 `rd`（原 path），不需后端改动
- [ ] **D3** xterm theme 改读 CSS 变量（`getComputedStyle(documentElement)`），dark/light 切换重建 theme
- [ ] ESLint 规则增强：禁止 `window.prompt/alert/confirm` + 禁止 `style={{ color/background: '...'}}` + 禁止 `bg-success/20` opacity-scale + SPA 路由禁用 `<a href>`（自定义规则）
- [ ] 验收：`/internal/_design`（仅 `import.meta.env.DEV` 守卫，**F3** 生产 bundle 不带）展示所有 primitive

#### M1.C Layout shell + 路由分层（1d）

- [ ] `<AppShell>` 替代现有 `__root.tsx` 内联布局
- [ ] **C1** `__root.tsx` 路径感知：`/console`（fullscreen workspace mode，无 sidebar/header，浮动 Back/Disconnect/Fullscreen 控件）；其他路由走标准 AppShell
- [ ] `<AppHeader>` 重写：左 logo + 中面包屑 + 右（Cmd+K 触发器、语言、主题 **G2 改 DropdownMenu 三选项**、余额、用户菜单 DropdownMenu）；shadow mode 红色顶栏用新 token `--color-warning-strong`（**A3**）
- [ ] `<AppSidebar>` 重写：Linear 风（紧凑、ghost 状态、active 用左侧 2px indicator 而非全背景）、collapsed 状态用 Tooltip 显示标签
- [ ] `<PageShell>` / `<PageHeader>` / `<PageToolbar>` / `<PageContent>` 4 件套
- [ ] 移动端 sidebar 抽屉用 shadcn `Sheet`
- [ ] **G4** Toast 位置 `top-right` 验证 sidebar drawer 不冲突，必要时切 `top-center`
- [ ] 验收：现有 5 个核心页临时填进 PageShell；`/console` 全屏后 Back 按钮可见可达

#### M1.D 命令面板（1d）

- [ ] `<CommandPalette>` 在 `<AppShell>` 中常驻，全局 ⌘K/Ctrl+K 触发
- [ ] `useCommandActions()` Hook：每个路由声明上下文动作（注册到 zustand store）
- [ ] Recent 段：localStorage 持久化最近 5 条
- [ ] Pages 段：从 `sidebar-data.ts` + 路由表生成
- [ ] **C2** `useHotkeys` 全局快捷键带 scope；`/console` 路由 mount 时禁用全局 scope，header 的命令面板 icon 仍可点；blur xterm 后或 Esc fullscreen 后恢复 scope
- [ ] 字符前缀路由（`>` Actions、`/` Pages、`@` 资源 - **@ 段 M2 实现**）
- [ ] 验收：键盘可达，符合 ARIA combobox 模式，Esc 还原焦点；在 `/console` xterm 聚焦时 ⌘K 不触发（手动测）

#### M1.E 核心 5 页迁移（2.5d）

按访问频度排序：

1. [ ] `/`（用户首页）：StatCard → DataCard primitive；快捷操作改 Button + Icon 标准；`<a href>` → `<Link>`（**B1**）
2. [ ] `/admin/monitoring`（admin Overview）：定位为"集群健康全景"，简化为节点状态网格 + 关键计数 + 最近事件，不再做图表（图表给 observability）
3. [ ] `/admin/vms`（最痛的页）：
   - 单行 8 按钮 → 1 主操作 + DropdownMenu（按 vm.status 切换主操作语义）
   - 表格走 DataTable（URL 同步 page/limit/sort/filter）
   - Drift 面板用 `<Alert variant="warning">`，"清理"按钮走 **TypedConfirmDialog**（H 矩阵）
   - **C4** Snapshots/Metrics/Reinstall 行内展开 → Sheet 抽屉，URL `?sheet=...&vm=...` 可分享
   - **B2** Reinstall 完成后凭据用 SecretReveal
4. [ ] `/vms`（用户 VM 列表）：同样的 DataTable 模式 + 卡片移动端 fallback
5. [ ] `/billing`：
   - **D4** 产品卡片重构 + 购买走 PurchaseSheet 抽屉（OS 选择 + 名字 + 付款全在抽屉，不内联展开）
   - 订单表格用 DataTable
   - **B2** VM 凭据 SecretReveal
- [ ] **B1** 全站 grep 检查 `<a href="/...`，本批 5 个页面零匹配
- [ ] 验收：5 页面 Lighthouse a11y ≥ 95、键盘导航全通、移动端 viewport 360px 不溢出

#### M1 收口

- [ ] `bun run lint && bun run typecheck && bun run build && bun run test` 全绿
- [ ] 手动 smoke：dark/light 切换、移动端、Cmd+K 全场景、删除/重装确认流
- [ ] 提 PR；merge 后部署到测试环境验证

### Milestone 2 — 剩余页面 + 收口 + a11y / i18n 净化

> 单 PR 交付，估时 3-5 天。M2 上线后整站完成度 100%。

#### M2.A 剩余路由迁移（2-3d）

按 sidebar 分组批量迁移到 PageShell + DataTable + 模式手册：

**用户视角**：
- [ ] `/ssh-keys` / `/api-tokens` / `/tickets`（用户工单 + 内联表单 → Sheet）
- [ ] `/console`（fullscreen workspace mode 已在 M1.C 完成路由层，M2 收尾 xterm 主题切换 + 错误态）
- [ ] `/settings` / `/vm-detail`（Tab 布局：Overview / Snapshots / Metrics / Activity）

**Admin 监控**：
- [ ] `/admin/observability` / `/admin/ha`（Tabs primitive 已在用，迁到 shadcn `Tabs`）

**Admin 资源**：
- [ ] `/admin/create-vm`（**C3** 改 Stepper：Cluster → Size → OS → Name → Confirm；**B2** 凭据 SecretReveal；**G5** mobile bottom bar）
- [ ] `/admin/storage`（**B1** Sheet 化 create form）
- [ ] `/admin/vm-detail`（Tab 布局）

**Admin 基建**：
- [ ] `/admin/clusters` / `/admin/nodes` / `/admin/node-ops`
- [ ] `/admin/node-join`（**C3** Stepper primitive 取代手写 4-step）
- [ ] `/admin/ip-pools` / `/admin/ip-registry`
- [ ] `/admin/firewall`（rules 编辑保留 inline，但 create group 改 Sheet）
- [ ] `/admin/floating-ips`（**H** 转移/释放走 TypedConfirmDialog）

**Admin 计费**：
- [ ] `/admin/products`（create form Sheet 化）/ `/admin/os-templates`（同）/ `/admin/orders` / `/admin/invoices`

**Admin 用户运营**：
- [ ] `/admin/users`（**A2** Shadow Login 的 `window.prompt` → `<ShadowLoginDialog>`；**H** 角色降级类型化）
- [ ] `/admin/tickets` / `/admin/audit-logs`（**G** 筛选 → FilterBar primitive；**F2** CSV 导出走 DownloadButton）

每个页面验收：
1. 路由文件 < 200 行（业务组件下沉到 `features/<name>/components/`）
2. 不再 hardcode 颜色 / 内联 button 样式
3. 表格使用 DataTable
4. 危险操作走类型化确认（按 H 矩阵）
5. 命令面板注册了上下文动作
6. 全部 SPA 内部跳转走 `<Link to>`，零 `<a href="/...`
7. Mobile viewport 360px 不溢出

#### M2.B i18n 净化（0.5d）

- [ ] 扫描 `t("...defaultValue: ...")` 内联中文 → 抽出到 `zh/common.json`
- [ ] 删除孤儿 key（grep 确认未引用）
- [ ] 新增组件相关 key（`pageHeader.*` / `dataTable.*` / `command.*` / `confirm.*`）
- [ ] zh/en key 数对齐

#### M2.C a11y / 性能收尾（1d）

- [ ] **E1** 全站 focus-visible 走统一 ring（DESIGN.md `Focus` 阴影栈）；Tailwind v4 `@theme` 加 `--ring`
- [ ] **E2** 全部 `<button>` icon-only 有 `aria-label` / Tooltip；扫描后零警告
- [ ] **E3** `⚠` emoji icon 全替换为 lucide `<AlertTriangle aria-hidden="true">` + 可见标签
- [ ] `prefers-reduced-motion` → 禁用过渡动画（Tailwind v4 自带 motion-safe）
- [ ] DataTable 大数据集（>200 行）启用 virtualization（`@tanstack/react-virtual`）
- [ ] **D1** `query-client.ts` 默认配置 `refetchIntervalInBackground: false` + `refetchOnWindowFocus: "always"`
- [ ] **D2** admin 端 `<AppShell>` 接 `/api/admin/events/ws`，按 lifecycle.* / operation.* 事件触发 query invalidate（VM、节点、healing）
- [ ] Bundle 分析：移除未使用的 lucide 图标、确认 tree-shaking 生效；目标 main bundle < 350KB gz

#### M2.D 删除遗留代码（0.5d）

- [ ] 删除所有页面内的 inline `StatusBadge` / `ActionBtn` / `StatCard` 定义
- [ ] 删除所有 `bg-success/20` `bg-destructive/20` 这类 opacity scale，统一用 token
- [ ] **B1** 全站 grep `<a href="/`：仅允许 `/oauth2/`、`/shadow/`、`/auth/emergency` 这类后端跳转保留
- [ ] **F3** 验证 `/internal/_design` 仅 dev bundle 出现，prod bundle grep 不到
- [ ] 删除已废弃路由（如有）
- [ ] 更新 `CLAUDE.md` 的前端章节（如需）

#### M2 收口

- [ ] 全 lint/typecheck/build/test 绿
- [ ] Lighthouse 全站 a11y ≥ 95、performance ≥ 80
- [ ] PR 合并 → 部署生产 → smoke 测试

## Acceptance Criteria

### 视觉
- [ ] 全站符合 DESIGN.md：暗色为原生、Inter cv01/ss03、5 级表面阶梯、brand indigo 仅在 CTA/active
- [ ] 无任何 `bg-success/20` `bg-destructive/20` opacity-scale 写法
- [ ] 无任何 hardcode `#xxxxxx` / `rgb(...)` 颜色（chart 主题文件除外）

### 交互
- [ ] Cmd+K 全局可用，路由跳转 + 上下文动作 + 最近访问；`/console` 路由禁用全局快捷键
- [ ] 数据表格统一走 `<DataTable>`，行操作不超过 1 个 inline + DropdownMenu
- [ ] 删除/重装/转移/角色降级/Shadow Login 类操作走 TypedConfirmDialog（H 矩阵 11 处）
- [ ] 全部 SPA 内部跳转走 `<Link to>`；`<a href="/...">` 仅允许后端 redirect（OAuth/shadow/emergency）
- [ ] `window.prompt/alert/confirm` 全站 0 处（ESLint 强制）
- [ ] VM 凭据/Token 通过 `<SecretReveal>` 展示，默认遮罩
- [ ] step-up 重认证后能恢复中断的操作（A1 intent replay）

### 移动端
- [ ] sidebar 抽屉、表格→卡片、长表单底部固定操作栏
- [ ] viewport 360px 不溢出

### 可访问性 / 性能
- [ ] Lighthouse 全站 a11y ≥ 95
- [ ] 全部 icon-only 按钮有 `aria-label` 或 Tooltip
- [ ] focus-visible ring 全站统一，键盘 Tab 全可达
- [ ] `prefers-reduced-motion` 时无过渡
- [ ] main bundle gzip < 350KB
- [ ] hidden tab 时无周期 fetch（D1）

### 工程
- [ ] `bun run lint && typecheck && build && test` 全绿
- [ ] i18n zh/en key 数对齐，无孤儿 key
- [ ] 路由文件均 < 200 行（业务下沉到 features/<name>/components/）
- [ ] `/internal/_design` 仅 dev bundle，prod 不可达
- [ ] CI: golangci-lint v2 + bun run lint + tsc + vitest + go test 全过
- [ ] 部署后 smoke：登录 → Cmd+K → 创建 VM → 删除 VM（类型化确认）→ Shadow Login → 退出 Shadow → 控制台连接 → 主题切换

## Risks

| 风险 | 影响 | 缓解 |
|------|------|------|
| shadcn CLI 与现有 `@base-ui-components/react` 版本冲突 | M1.B 卡 | 先在临时分支验证；最坏情况手写一份 base-nova 风格 primitive |
| 移动端 DataTable→卡片视图工作量被低估 | M1.E 延期 | 先做 1 个样板页（admin/vms），确认模式后批量复制 |
| Cmd+K 与 xterm console 焦点冲突 | 控制台不可用 | **C2** `useHotkeys` scope；`/console` 全屏时禁用全局 scope；blur xterm 后恢复 |
| step-up 重认证回来后 intent replay 失败 | 用户操作无反馈 | **A1** sessionStorage TTL 5min；replay 前再次 confirm；失败给明确 toast |
| 大表格 virtualization + sticky toolbar 兼容问题 | 视觉错位 | M2.C 阶段实测；fallback 到无 virtualization |
| i18n key rename 漏改 | 运行时显示原始 key | 提供 `i18next.missingKeyHandler` 上报到 console.error；CI 检测 |
| 视觉切换太大引发用户投诉 | 体验回退 | M1 直接全量（用户已确认）；保留 PR 整 revert 能力（DOM/CSS 变化大但 API 完全不变） |
| WebSocket 事件驱动 invalidate 触发风暴 | 频繁重渲染 | **D2** invalidate debounce 500ms；按 vm_id/cluster 范围只 invalidate 受影响的 query |
| 后端缺 batch API | M2 多选体验受限 | 前端 `Promise.allSettled` N 并行 + 错误聚合 toast；后端 batch 端点列入 PLAN-023 follow-up |
| OAuth 回调被命令面板挡 | redirect 失败 | 命令面板路由级别 mount，OAuth 回调路由（`/api/auth/stepup-callback`）由后端处理，不进 SPA |
| 字体加载阻塞首屏 | LCP 退化 | `font-display: swap` + 仅预加载 latin subset；首次访问 fallback 到系统字体也可读 |

## Test Plan

### 单测
- 新增 `<DataTable>` / `<TypedConfirmDialog>` / `<CommandPalette>` 单测
- 现有 `default-user.test.ts` / `audit-logs/helpers.test.ts` 保持

### 集成
- 关键流：登录 → Cmd+K 跳转 → 创建 VM → 类型化确认删除 → 工单提交
- 主题切换：dark/light/system，刷新后状态保留
- shadow 模式：进入/退出，Header 红色不影响命令面板

### E2E（手动）
- Chrome / Safari / Firefox 桌面
- iOS Safari / Android Chrome 移动
- 键盘导航全站可达（Tab + Enter + Esc）
- prefers-reduced-motion 启用时无动画

### 性能
- M1/M2 上线前 lighthouse + 主要页面 bundle 大小对比
- 大表格（1000 行 mock）滚动 60fps

## Out of Scope

- 后端任何改动（路由、handler、service、middleware）
- 后端 batch API（前端用 N 并行 + 错误聚合兜底；列入 PLAN-023 后端 follow-up）
- `/auth/emergency` 应急登录页（隔离、内联 HTML）
- nginx/caddy 配置
- 邮件模板
- 真正的 marketing landing page（如果以后要做单独 PLAN）
- 数据可视化深度 redesign（observability 图表）—— 仅做容器迁移，图表内部 recharts 主题更新放 M2.C 收尾
- Silent re-auth via popup window（A1 备选方案，工作量大，留 PLAN-024+）
- `@nsio/nsl` 接入（pma-web baseline 要求，但本项目 dev 故事已稳定，列为 nice-to-have）

## 用户旅程闭环验证（M1 / M2 收尾必走）

> 调用链已通过 code-review-graph 校对。每条旅程都要在 staging 跑通，覆盖前后端 + UI 交互完整闭环。

### J1. 用户购买 VM（最高频）
1. 登录 → `/`（用户首页看到 0 VM、有余额）
2. ⌘K → "新建云主机" → 跳 `/billing`
3. 选产品 → PurchaseSheet 抽屉 → 选 OS / 命名 → "支付"
4. 后端 `POST /api/portal/orders` → 返回 order
5. `usePayOrderMutation` → 后端余额扣款 + provision VM → 返回 credentials
6. SecretReveal 展示用户名/密码（一次性）
7. 跳 `/vms` 看到刚创建的 VM
8. 旅程闭环检查：余额刷新、订单状态、SSE 推送 lifecycle 事件、命令面板"控制台"动作

### J2. Admin 删除 Drift VM（中频，敏感）
1. `/admin/vms` → Drift 面板出现 vm-aaa
2. 点"清理" → TypedConfirmDialog 要求输入 `vm-aaa`
3. 解锁后点"清理"→ `DELETE /admin/vms/{name}/force-delete`
4. 后端 step-up 401 → http.ts 持久化 intent → 跳 OIDC
5. OIDC 回来 → intent replay confirm "继续清理 vm-aaa？" → 同意 → 重新发起请求
6. 成功 → toast + DataTable 刷新（D2 ws 事件驱动）
7. 闭环：审计日志记录、IP 释放、查询缓存失效

### J3. Shadow Login 排障（中频）
1. `/admin/users` → 找到目标 → 点 "Shadow"
2. ConfirmDialog（普通） → "继续"
3. ShadowLoginDialog 收 reason（替代 window.prompt）
4. POST `/admin/users/{id}/shadow-login` → redirect_url
5. window.location.href = redirect_url（**不能用 Link，是后端跳转**）
6. 进入用户视角 → header 红色 banner（warning-strong token）+ 用户菜单 "退出 Shadow"
7. POST `/shadow/exit` → 回 admin
8. 闭环：审计日志（with reason）、退出后 admin 端可见

### J4. 控制台连接 VM（中频）
1. `/admin/vms` 行内 DropdownMenu → "控制台"
2. 跳 `/console?vm=&cluster=&project=`
3. **C1** 全屏模式（无 sidebar/header）+ 浮动 Back/Disconnect
4. xterm 连 ws → 可输入命令（**C2** ⌘K 不冲突）
5. 主题切换 → xterm theme 重建（D3）
6. Esc fullscreen 或 Back → 回到原页面
7. 闭环：ws 关闭、xterm dispose、热键 scope 恢复

### J5. 工单提交（中频）
1. `/tickets` → "新建工单" → Sheet 抽屉
2. 输入 subject + body + 附件（如果支持）
3. POST `/api/portal/tickets`
4. 抽屉关闭 → 列表刷新（refetchInterval 15s 或事件驱动）
5. 闭环：admin 端 `/admin/tickets` 看到、回复后 `/tickets` SSE 收到（如果有；当前轮询）

### J6. CSV 导出（低频但慢）
1. `/admin/audit-logs` → FilterBar 选日期 + action prefix
2. DownloadButton 点击 → toast "正在导出..."
3. `<a href download>` 触发浏览器下载
4. 完成后 toast 消失（启发式：5s 后 dismiss，因为下载是浏览器原生）
5. 闭环：导出文件可读、行数符合预期

## Notes

- DESIGN.md 是设计蓝本，与本 PLAN 同步引用；如设计 token 出现矛盾，**以本 PLAN 决议为准**（DESIGN.md 是设计师视角，工程上需要可实现性微调）。
- 所有 PR 标题用中文 conventional commits（`refactor: PLAN-022 M1 前端 Linear 重设计 - 底层 + 5 核心页`）。
- 完成后归档：`/docs/task/UX-004.md` 标记 completed；`MEMORY.md` 增加 `plan022_overview.md`。
- 部署：M1 / M2 各自完成后走 `task web-build && task web-sync && task build` 三连，部署到 vmc.5ok.co。**Never compile on remote servers**（CLAUDE.md 纪律）。
- M1 发布前手动测：登录、Cmd+K、删 VM、step-up redirect、Shadow Login、控制台、移动端 360px。
- 字体许可：JetBrains Mono Variable（Apache 2.0）+ Inter Variable（OFL 1.1），均可商用。
- 这次重构不动 i18n key 的语义结构（仅删孤儿 + 抽 defaultValue），保留对 e2e 测试和 audit 报表的兼容。
