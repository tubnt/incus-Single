# Session 3 — 前端性能与移动端适配审查（IncusAdmin）

> 审查范围：`incus-admin/web`（React 19 + Vite 8 + TanStack Router/Query + Tailwind v4 + Bun，Go embed 部署）
> 审查基准：Core Web Vitals（LCP / INP / CLS）+ WCAG 2.5.5 移动端触控目标
> 工具：Serena 符号检索、code-review-graph 关系查询、产物级 size/gzip 分析、TanStack Router 自动代码分割产物核对
> 审查对象：`main` 分支 commit `4cb8c52`，`web/dist/` 为已构建产物（约 7.4 MB）

---

## 0. 前端构建产物画像

| 指标 | 值 | 备注 |
|---|---|---|
| `dist/` 总大小 | 7.4 MB | 含字体 4.7 MB + JS 1.9 MB + CSS 175 KB |
| JS chunk 数 | 150 | TanStack Router `autoCodeSplitting: true` 已生效 |
| Top 5 JS（raw / gzip） | `index-*.js` 307 / 96 KB；`monitoring-*.js` 344 / 100 KB；`console-*.js` 349 / 89 KB；`vms-*.js` 86 / 24 KB；`InternalBackdrop` 74 KB | console/monitoring 已 split，**未** 在 modulepreload |
| 主 CSS | 175 KB raw / 58 KB gzip | 单文件，含 114 个 `@font-face` |
| `<link rel="modulepreload">` | **56 条** | 见 §1🟡-2 |
| 字体 woff2 数 | 110（主要 Noto Sans SC 切片） | 4.7 MB |
| 后端静态服务 | `internal/server/static.go` `http.FileServer(http.FS(distFS))` | **未启用 gzip / Cache-Control** — 见 §1🔴-1/2 |

> 注：dist 中的 `*.br` 文件不存在；当前后端没有协商压缩或预压缩文件 fallback 的代码路径。

---

## 1. Core Web Vitals 阻塞项

### 🔴 严重

#### 🔴-1 后端没有任何 HTTP 压缩 — 直接拖累 LCP / FCP

- **位置**：`internal/server/server.go:164-170`，`internal/server/static.go:38-80`
- **现象**：chi 路由仅装载 `chimw.RequestID / RealIP / Recoverer / Timeout / slogMiddleware`，**没有** `chimw.Compress` 或自定义 gzip 中间件；`staticHandler` 直接把 `embed.FS` 内容裸传。
- **量化影响**：entry chunk `index-L9ChSacN.js` 实测 raw 307 KB → gzip 96 KB（3.2× 收益）；`monitoring-*.js` 344 → 100 KB；`index-*.css` 175 → 58 KB。**首屏阻塞资源至少多传 ~300 KB**，4G 下 +150–400 ms LCP。
- **修复方案**：
  ```go
  r.Use(chimw.Compress(5, "text/html", "text/css", "application/javascript",
      "application/json", "image/svg+xml", "application/wasm"))
  ```
  优先级 P0。或在 build 阶段产出 `*.br` / `*.gz` + 后端 `Accept-Encoding` 协商（`vite-plugin-compression2` 或 `task web-build` 后置压缩）。
- **校验**：部署后用 `curl -H 'Accept-Encoding: gzip,br' -I https://vmc.5ok.co/assets/index-*.js` 应回 `Content-Encoding: br` 或 `gzip`。

#### 🔴-2 hashed assets 没有 `Cache-Control: immutable` — 重复访问浪费 RTT

- **位置**：`internal/server/static.go:38-80`。`http.FileServer` 仅依据 mtime 写 `Last-Modified` 与 `ETag`（embed.FS 时间为构建时间），不写 `Cache-Control`。
- **现象**：浏览器对没有 max-age 的资源只会发 304 协商。对于 `*-{8字符 hash}.js` 这种内容寻址资源，每次刷新都要 50–150 ms 304 回包；46 个 modulepreload 链同时握手时尤其明显。
- **修复方案**：在 `staticHandler` 内识别 `/assets/`、`/locales/`、`*.woff2`，写：
  ```go
  if strings.HasPrefix(path, "/assets/") || strings.HasSuffix(path, ".woff2") {
      w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
  } else if path == "/" || strings.HasSuffix(path, "/index.html") {
      w.Header().Set("Cache-Control", "no-cache")
  }
  ```
  HTML 必须 `no-cache`，否则旧 SPA 永远拉不到新 entry hash（QA-007 BUG-01 已涉及）。

#### 🔴-3 主 JS chunk 96 KB gzipped 仍偏大 — 关键路径过长

- **位置**：`web/src/main.tsx`、`web/src/app/providers.tsx`、`web/src/app/routes/__root.tsx`
- **现象**：entry 同时打包了 React 19、TanStack Router、TanStack Query、`react-i18next`、`sonner`（带样式）、`cmdk`、`base-ui` 的 Dialog/Dropdown/Popover/Accordion 全家桶、`react-hotkeys-hook`、`lucide` 27 个常驻图标（CommandPalette + Sidebar）。`InternalBackdrop`（74 KB）也进了 critical 路径，因为 ConfirmDialogProvider 在根布局挂载。
- **量化**：root layout 已注入：`Toaster`（Sonner，~5 KB CSS-in-JS）+ `CommandPalette`（cmdk + 27 lucide + base-ui Dialog ≈ 50 KB）+ ErrorBoundary。这些都在用户尚未交互前就解析执行。
- **修复方案**：
  1. **CommandPalette 懒加载**：用 `React.lazy + Suspense` 包装；只有 `Cmd+K` 触发或 `state.commandOpen=true` 时再加载。`use-command-actions` 是简单 store，可保留在主包，但 `command-palette.tsx`（257 行 + cmdk + 全部 lucide ICON_MAP）下沉。
  2. **Sonner 懒加载**：toaster 触发时几乎都是用户操作之后；可用 `lazy(() => import("sonner"))` 包装 `<Toaster>`。
  3. **base-ui Dialog 仅在 ConfirmDialog 实际打开时挂载**：当前 `ConfirmDialogProvider` 渲染了一个常驻空 `<Dialog.Root open={open}>`，仍然 evaluate 模块。检查 `confirm-dialog.tsx` 是否能延迟 import 实际 Dialog primitive。

### 🟡 警告

#### 🟡-1 Tailwind v4 单 CSS 文件 175 KB / 58 KB gzip — render-blocking

- **位置**：`web/src/index.css`，构建产出 `dist/assets/index-C2qNnoaC.css`
- **现象**：单文件，包含：
  - 整套 `@theme inline` token（DESIGN.md 强制约束）
  - 114 个 `@font-face`（Inter / JetBrains Mono / Noto Sans SC）
  - 全部 utility classes（admin + portal + console + 10+ Sheet/Dialog 状态）
- **影响**：单个 render-blocking stylesheet ~58 KB gzip 在 3G 上 ~600 ms 才能下载完，FCP 直接受这条线限制。
- **修复方案**：
  1. **拆出 fontsource @font-face 到独立 stylesheet** — 把 `@import "@fontsource-variable/...wght.css"` 三条移到 `web/index.html` 用 `<link rel="preload" as="style">` 异步加载，主样式继续走 critical 通道；fontsource 自带 `unicode-range`，浏览器只会下载实际命中的字符切片，但 @font-face 声明本身不该阻塞渲染。
  2. **Tailwind 4 未启用 PurgeCSS scope 检查**：`tailwindcss` 的 scan 范围是 `src/**`，但 admin 路由只对管理员可见的 utility 也会进入 portal 用户的 critical CSS。Tailwind v4 没有按路由拆分 CSS 的官方机制，可考虑短期把字体抽出，长期评估 [vite-plugin-css-injected-by-js] 或 `@import` URL inline。

#### 🟡-2 `index.html` 56 条 `modulepreload` — HTTP/2 链路抢带宽

- **位置**：构建产物 `dist/index.html` 第 11-65 行
- **现象**：TanStack Router auto-codeSplitting 把根布局触达的所有路由 + 所有共享 chunk 全部预加载。包括 `vm-detail-Bgn0PXp0.js`、`vms-3baEIEct.js`、`createLucideIcon-*.js`、`InternalBackdrop-*.js`、`command-*.js` 等。
- **影响**：H2 多路复用下，56 条流并行竞争 entry HTML/CSS 的窗口。entry HTML 解析后立即 fire 56 个 GET，浏览器调度器仍要排序，弱网环境拉长 TTFB-to-LCP 距离。
- **修复方案**：
  1. 在 `vite.config.ts` 加上 `build.modulePreload.polyfill: false`（已隐式默认）+ 根据路由结构精减。Vite 5+ 支持 `build.rollupOptions.output.experimentalMinChunkSize`，但更直接的是：
  2. **实测哪些 chunk 真的被首屏需要**：进 chrome devtools coverage，把命中率 < 50% 的 chunk 从 manifest 中移除。常见可剔除：admin-only chunk（普通用户从未到达），但需要保证不破坏 SPA 跳转时的预加载。
  3. **降级方案**：保留 `modulepreload`，但改为 `<link rel="prefetch">`（低优先级），仅 entry 真正 import 的链路保留 `modulepreload`。

#### 🟡-3 数据轮询 14+ 处叠加 — INP / 主线程 / 后端压力

- **位置**：见下表（`grep refetchInterval`）

| 文件 | 间隔 | 备注 |
|---|---|---|
| `vms/api.ts:131` 我的 VM 列表 | 15 s | portal /vms 页 |
| `vms/api.ts:185` 回收站 | 5 s | trash banner 倒计时辅助 |
| `vms/api.ts:194` cluster VMs | 10 s | admin /vms 每集群一条 |
| `vms/api.ts:208/219` admin VM 详情 | 10 s | |
| `monitoring/api.ts:45/61` 指标总览 | 30 s | |
| `monitoring/vm-metrics-panel.tsx:37` VM 单机 | 30 s | |
| `nodes/api.ts:90/147/245/284` 节点列表/告警 | 15-60 s | |
| `tickets/api.ts:48` | 15 s | |
| `audit-logs/api.ts:28` | 15 s | |
| `storage/api.ts:63/71/79` | 30/60 s | |
| `ip-pools/api.ts:61` | 30 s | |
| `clusters/api.ts:52` 节点 | 可选 | |
| `healing/api.ts:77` | 30 s | |
| `billing/api.ts:133/144` | 15/30 s | |

- **现象**：admin 同时停留在 `/admin/vms`（多集群即多条 10 s 轮询）+ `/admin/monitoring`（30 s）+ ws 事件流（`startAdminEventStream`）— 其实 ws 已经覆盖了 lifecycle/operation 事件，VMs 轮询只是兜底。
- **风险**：每次轮询 = JSON parse + react-query 比对 + 可能整页重渲染。多页 tab + 多集群时累计每分钟数百次抢主线程，**直接拖低 INP**。
- **修复方案**：
  1. 在 ws 已连接时，把 vms 轮询升至 60 s，作为纯兜底。在 `useClusterVMsQuery` 接收 `wsHealthy: boolean`，连接好就关掉/拉长 interval。
  2. 全局 `refetchOnWindowFocus: "always"` 改为 `true`（默认 staleTime gate），避免切 tab 时一次性重发所有 query。

#### 🟡-4 列表无虚拟化 — 大集群 INP 抖动

- **位置**：`web/src/shared/components/ui/data-table.tsx`、`web/src/app/routes/vms.tsx:343-358`
- **现象**：`DataTable` 直接 `table.getRowModel().rows.map()` 全量渲染。当某集群 200 台 VM 时：
  - 每行 1 个 Checkbox + 1 个 StatusPill + 1 个 DropdownMenu + 5–8 个 cell
  - `<DropdownMenu>`（base-ui）每行都挂载 trigger 监听 — 即便菜单未打开
- **影响**：首次渲染 200 行 ≈ 200 × 30 vdom 节点；后续 react-query refetch 时 `data` 引用变更（`useMemo(() => data?.vms ?? [], [data])`，对 `data` 变就 break）→ 整表重排序。INP > 200 ms 风险大。
- **修复方案**：
  1. 引入 `@tanstack/react-virtual`，给 `DataTable` 加可选 `virtualize?: { estimatedRowSize, overscan }`。≥ 100 行启用。
  2. 把 `DropdownMenu` 的 trigger 改为 hover/keyboard 触发再 mount（`useDeferredValue` 或 `<Suspense>`）。
  3. `useMyVMsQuery` 与 `useClusterVMsQuery` 接服务端分页（已有 portal/admin 列表 API，但前端没传 limit/offset）。

#### 🟡-5 i18n 远端 backend 无 Suspense 兜底 — 潜在 CLS

- **位置**：`web/src/app/i18n.ts:11-25`，`web/src/main.tsx`
- **现象**：`HttpBackend` 异步拉 `/locales/{lng}/common.json`（60 KB）。`useTranslation()` 在数据未到时全部回退 `defaultValue`（中文）。但很多 `t()` 没传 `defaultValue` 或 default 是中文而用户实际语言是英文 — 数据回包后整树重渲染，**侧边栏宽度、按钮文字长度变化 → 视觉 CLS**。
- **修复方案**：
  1. `i18n.init({ ... initImmediate: false, partialBundledLanguages: true })`，再把当前语言的 `common.json` **直接 inline** 到 entry chunk（用 vite `?inline` 或 build-time JSON import），避免额外往返。
  2. 或用 `<Suspense fallback>` 等待 i18n ready 后再 paint App，避免文案抖动。

### 🔵 优化

#### 🔵-1 触控目标 < 44 px — WCAG 2.5.5 AAA 不达标

- **位置**：`web/src/shared/components/ui/button.tsx:41-47`
- **现象**：
  - `sm`: `h-7` (28 px)
  - `md`: `h-8` (32 px)
  - `icon-sm` / `icon`: 28 / 32 px
- **影响**：移动端误点率高，尤其 VM 卡片操作菜单（28 px）、行内 dropdown trigger（28 px）；DataTable 头部 chevron 12 px 过小。
- **修复方案**：移动端断点（`md:`）下 size 强制 ≥ 40 px。在 `button.tsx` 的 `sm/md` 保留桌面紧凑，移动端通过 `class="h-9 md:h-7"` 或全局 `[@media(pointer:coarse)]` 媒体查询提升。

#### 🔵-2 监控页 4 张 BarChart 同屏渲染 + recharts 344 KB

- **位置**：`web/src/app/routes/admin/monitoring.tsx:170-282`
- **现象**：`monitoring-AbbXk9ST.js` 已是单独 chunk，但页面初次进入时同步加载 recharts 全集。4 个 `<ResponsiveContainer>` + 200+ Bar 元素同屏，30 s 轮询整张表重渲染。
- **修复方案**：
  1. 用 `recharts/es/...` 路径直接 import 子模块；recharts 3.x 暴露了子路径减少 tree-shake 难度。
  2. 把 4 个 chart 用 `react-intersection-observer` 懒挂载（折叠下面 2 个直到 scroll 到）。
  3. 非 admin 用户从未访问 monitoring，确认 sidebar 不会触发预加载。

#### 🔵-3 自托管字体 4.7 MB — 移动端流量敏感

- **位置**：`web/src/index.css:5-11` + `node_modules/@fontsource-variable/noto-sans-sc`
- **现象**：Noto Sans SC 切了 110 个 unicode-range 文件（每片 ~60 KB）。中文用户首屏只下载命中的 2-5 片，但 admin 翻页时新汉字会触发更多片下载。`font-display: swap` 已配（FOUT 而非 FOIT，✓）。
- **修复方案**：
  1. 给最常用的几片 Noto Sans SC（`100/101/102/103` 是 GB2312 高频区）加 `<link rel="preload" as="font" type="font/woff2" crossorigin>` 到 `index.html`，避免 swap 后第一帧文字"长大"。
  2. 移动端实测：在 `@media (max-width: 640px) and (max-width: 600kbps)` （Network Information API）下回退 system font，不下载 Noto Sans SC（fontsource 默认仍下载）。可加 utility class `font-system-only`。

#### 🔵-4 `useIsMobile` 监听 resize — 频繁 setState

- **位置**：`web/src/shared/components/layout/app-shell.tsx:14-25`
- **现象**：`window.addEventListener("resize", handler)` 直接 `setIsMobile(window.innerWidth < 768)`。resize 期间触发数十次。每次都 setState→ AppShell 重渲染。
- **修复方案**：改用 `window.matchMedia("(min-width: 768px)").addEventListener("change", ...)` — 只在跨过断点时触发一次。

#### 🔵-5 Console (xterm) 体积 89 KB gzip — 进 /console 页才加载，但加载完才连 ws

- **位置**：`web/src/features/console/terminal.tsx:43-67`
- **现象**：xterm Terminal 实例化 + addon 加载完成后再 `new WebSocket(...)`。WebSocket 握手 RTT 是阻塞性的，应当并行。
- **修复方案**：在 `useEffect` 顶部立刻 `new WebSocket(wsUrl)`，先入 buffer，等 xterm 就绪后 `terminal.write(buffered)`。可省 100-300 ms 黑屏。

#### 🔵-6 `useClusterVMsQuery` 把 `data` 整体当作依赖 — refetch 抖动

- **位置**：`web/src/features/vms/components/cluster-vms-table.tsx:50`
  ```ts
  const allVMs = useMemo(() => data?.vms ?? [], [data]);
  ```
- **现象**：依赖应是 `data?.vms`。当 `cached_at` / `stale` 字段变了但 vms 数组实际不变时也会触发下游 useMemo / Table 重排序。
- **修复方案**：依赖换成 `[data?.vms]`。同样模式在 `vms.tsx:69` 已正确（`[data?.vms]`），保持一致。

#### 🔵-7 `lucide-react` 41 KB chunk — `createLucideIcon` 集中

- **位置**：59 处直接 named import；`createLucideIcon-BebJ3JJX.js` 41 KB raw / ~10 KB gzip
- **现象**：CommandPalette + Sidebar 静态白名单 27 + 27 = 54 个图标常驻；Vite tree-shake 已做，但仍 ~10 KB gzip。
- **修复方案**：tree-shake 已生效，可不优先处理；如要进一步降，CommandPalette 的 `ICON_MAP` 可改 `lazy import` — 用户不打开命令面板就不下载这一坨。

#### 🔵-8 `<select>` 原生节点筛选 vs base-ui — 视觉一致性

- **位置**：`web/src/features/vms/components/cluster-vms-table.tsx:303-320`
- **建议**：移动端原生 `<select>` 体验最好（系统弹层），保持。**仅观察**，无需修改。

#### 🔵-9 observability iframe 700 px / vm-detail iframe 500 px — 移动端体验

- **位置**：`web/src/app/routes/admin/observability.tsx:93`、`web/src/app/routes/admin/vm-detail.tsx:394-396`
- **现象**：`h-iframe-tall` (700 px) 在 iPhone Mini (568 px 视口) 会撑出滚动条，且嵌入 Grafana 内部 viewport 又有自己的滚动。
- **修复方案**：移动端 `h-[calc(100vh-7rem)]` 替代固定 700 px。

#### 🔵-10 `refetchOnWindowFocus: "always"` — 多 tab 切换抖

- **位置**：`web/src/shared/lib/query-client.ts:15`
- **现象**：每次 tab focus 一次性 invalidate 所有正在挂载的 query。结合 §🟡-3 列出的 14+ 条 query，单次 focus = 几十次 fetch + parse + 重渲染。
- **修复方案**：改为默认行为（`true`，依 staleTime gate）；只对真正实时关键的（VM 状态 / 余额）显式覆写为 `"always"`。

---

## 2. 移动端适配审查

### 已做对的

- ✅ `<meta viewport ... viewport-fit=cover>` ✓（`index.html:5`）
- ✅ `theme-color` 配 dark/light 双 media query ✓
- ✅ `MobileBottomBar` 使用 `env(safe-area-inset-bottom)` ✓
- ✅ AppShell `useIsMobile` 768 px 断点；mobile 抽屉 + overlay
- ✅ `prefers-reduced-motion` 全局降级动画（`index.css:437-446`）
- ✅ `font-display: swap` + system font 回退栈完整（含 PingFang SC / Microsoft YaHei UI）
- ✅ 详情/快照统一走 `<Sheet>`（`size="min(96vw, 38rem)"`），移动端不会被裁
- ✅ Console 路由 `WORKSPACE_PATHS` 拆出全屏 shell，不嵌 sidebar — VM 终端在手机端可用

### 🔴 严重移动端问题

无 — 关键路径（登录、VMs 列表、launch 流程）在 ≤ 768 px 都有降级。但 §🔵-1 触控目标过小是主要遗留点。

### 🟡 警告

#### 🟡-M1 DataTable 完全不响应式

- **位置**：`web/src/shared/components/ui/data-table.tsx:191-262`
- **现象**：`<table>` 包了 `overflow-x-auto`（`web/src/shared/components/ui/table.tsx:23`），即横向滚动 — 在 iPhone 上每列 100+ px、5-8 列即 500-800 px 横向，单手滑动看不全 + checkbox 列被推到屏幕外。
- **修复方案**：≤ md 断点改为"卡片视图"（参考 portal `/vms` 已经用 `VMCard` 列表，效果好）。`admin/vms` 不复用是因为 admin 视角需要批量选择 — 可以仿 `/vms` 的卡片 + 全选 toolbar。

#### 🟡-M2 PageShell `mx-auto max-w-7xl px-4 md:px-6 py-4 md:py-6` 在 mobile 上仍 16 px 内边距

- **位置**：`web/src/shared/components/layout/app-shell.tsx:120`
- **现象**：手机宽 360 px 时，内容宽度仅 360 - 32 = 328 px。卡片密集页（dashboard / monitoring）单卡边距吃掉 ~10% 屏宽。
- **建议**：mobile 改为 `px-3`（12 px）或 `px-2 md:px-6`，让卡片占满。

#### 🟡-M3 顶栏右侧操作过密

- **位置**：`web/src/shared/components/layout/app-header.tsx:97-216`
- **现象**：⌘K 框 (`min-w-[14rem]`) 在 sm: 显示；语言切换、theme、avatar 在 mobile 上挤在顶栏右侧 32 px 按钮串。
- **建议**：mobile 把 lang/theme 折叠进 avatar dropdown。

### 🔵 优化

- 🔵-M1 `xl:grid-cols-2`（monitoring）下，4 张图表只有桌面 ≥ 1280 px 才并排；平板/横屏手机 (768-1279) 仍单列 — 体验 OK，但可以加 `md:grid-cols-2`。
- 🔵-M2 命令面板 ⌘K 在 mobile 没替代触发器（按钮 `hidden sm:inline-flex` 在 < 640 px 隐藏）。可在移动端 header 放一个 `<Search>` icon 按钮触发 `setCommandOpen(true)`。
- 🔵-M3 表单 input 高度未显式设 `font-size: 16px+`，iOS Safari 在小于 16 px 的 input focus 时会强制缩放。检查 `Input` 组件默认字号。
- 🔵-M4 `useIsMobile` `<768 px` 断点偏粗 — 768-1023 平板未识别为 mobile，但 sidebar 切到 collapsed rail 体验更好。可考虑 `<1024` 加 `tabletCollapsed` 中间态。

---

## 3. Core Web Vitals 量化预估（修复前/后）

> 基线：4G 慢速（Slow 4G profile，约 1.6 Mbps），中端安卓机，冷启动 https://vmc.5ok.co/

| 指标 | 当前预估 | 主要负担 | 修复 §1🔴 后预估 | 修复 §1🟡 后预估 |
|---|---|---|---|---|
| **TTFB** | ~200 ms | Go embed 直供 | 不变 | 不变 |
| **FCP** | ~1.6 s | 175 KB CSS render-blocking + 96 KB entry JS | ~1.0 s（CSS gzip → 58 KB） | ~0.8 s（fontsource 异步） |
| **LCP** | ~2.4 s | 等 entry JS exec + i18n fetch | ~1.5 s | ~1.2 s |
| **CLS** | ~0.10 | i18n fallback → 真值文案宽度变化 | 不变 | ~0.02（i18n inline） |
| **INP** | ~200 ms（admin /vms 大集群）| 200 行 table 全量渲染 + 15 s polling 抖 | ~150 ms | <100 ms（虚拟化 + ws-only） |

> 数字是粗估；落地时用 Chrome DevTools "Performance Insights" + WebPageTest 实测。

---

## 4. 修复优先级路线图

### Phase 1（一周内，纯后端 + 配置）

1. **🔴-1**：`server.go` 加 `chimw.Compress(5)`（10 行改动）
2. **🔴-2**：`static.go` 区分 `/assets` immutable vs `index.html` no-cache（20 行）
3. **🟡-3 部分**：`refetchOnWindowFocus: true`（替代 `"always"`）

预期：FCP/LCP −400 ms，无功能变化。

### Phase 2（前端拆分，2 周）

4. **🔴-3**：CommandPalette + Sonner 懒加载
5. **🟡-1**：fontsource @font-face 抽出独立异步 stylesheet
6. **🟡-5**：i18n 当前语言 inline + Suspense
7. **🟡-2**：modulepreload 实测后精简

预期：entry chunk 96 → 60 KB gzip；首次中文访问 CLS −0.08。

### Phase 3（性能 / 移动端优化，2-4 周）

8. **🟡-4**：DataTable 接 `@tanstack/react-virtual`
9. **🟡-M1**：`admin/vms` 在 mobile 改卡片视图
10. **🔵-1**：触控目标 ≥ 40 px
11. **🟡-3 完整**：ws-aware 自适应轮询间隔

预期：admin 大集群 INP <100 ms；移动端体验对齐 portal。

---

## 5. 验证清单

- [ ] `curl -I` 校验 gzip + Cache-Control 已生效
- [ ] WebPageTest（mobile 4G）测 LCP < 2.0 s（修复后）
- [ ] Chrome DevTools "Performance Insights" 检查 long task < 50 ms
- [ ] iPhone SE 真机测 portal /vms：批量操作、滑动列表流畅
- [ ] Lighthouse mobile 综合分 > 80（当前估计 60-70）
- [ ] 手动 throttling "Slow 4G + 4× CPU" + 模拟 360×640 视口
- [ ] axe-core 扫描 触控目标 ≥ 44 px

---

## 附录 A：未审查项 / 范围外

- `cluster/` `single/` 仅运维脚本，无前端
- 后端 API 性能、SQL 查询、SSE 心跳间隔等不属于前端审查
- 字体子集化（pyftsubset）属于构建工程，未在范围内深挖
- A11y 仅扫了 reduced-motion / focus-visible / aria-label，键盘导航完整性未做（PLAN-034 P2-B 已做 g 序列导航）

## 附录 C：Phase 1 已落地（本地未部署）

> 修改时间：与本审查同次会话；编译 + typecheck 全绿；未在远端服务器执行。

| 项 | 文件 | 改动 |
|---|---|---|
| 🔴-1 gzip 压缩 | `incus-admin/internal/server/server.go` | `r.Use(chimw.Compress(5, ...))` 在 RealIP/Recoverer 之后 |
| 🔴-2 静态资源缓存 | `incus-admin/internal/server/static.go` | `/assets`、`*.woff2/.woff` `immutable` 1y；`index.html` `no-cache`；`/locales` 5min must-revalidate |
| 🟡-3 / 🔵-10 query focus | `incus-admin/web/src/shared/lib/query-client.ts` | `refetchOnWindowFocus: "always"` → `true` |

**部署校验脚本**（`task web-build && go build` 后部署，再 curl 验证）：

```bash
curl -sI -H 'Accept-Encoding: gzip' https://vmc.5ok.co/ | grep -iE 'content-encoding|cache-control'
curl -sI -H 'Accept-Encoding: gzip' https://vmc.5ok.co/assets/$(curl -s https://vmc.5ok.co/ | grep -oE 'index-[A-Za-z0-9]+\.js' | head -1) \
  | grep -iE 'content-encoding|cache-control'
```

期望：HTML 响应 `cache-control: no-cache`；JS/CSS `content-encoding: gzip` + `cache-control: public, max-age=31536000, immutable`。

未触及（Phase 2/3 待办）：CommandPalette/Sonner 懒加载、fontsource 异步、i18n inline、modulepreload 精简、DataTable 虚拟化、移动端卡片视图、触控目标 ≥40 px。

## 附录 B：调用工具记录

- `mcp__serena__initial_instructions` ✓
- Glob/Read 用于路由与 build 产物体积；ToolSearch 加载 Serena tools
- code-review-graph 在本审查中未发现需要追溯的复杂调用链（前端结构清晰，可直接用 Serena/Glob）；如要量化"哪些组件被首屏路由可达"可补 `query_graph(callers_of, "RootLayout")`
