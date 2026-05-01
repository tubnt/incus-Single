# PLAN-032 DESIGN.md 严格合规清零（OPS-030）

- **status**: completed
- **completedAt**: 2026-05-01
- **priority**: P3
- **owner**: claude
- **createdAt**: 2026-05-01
- **referenceDoc**: DESIGN.md / CLAUDE.md "禁止 hex / arbitrary value" 纪律 / OPS-029 全功能 UI 测试报告
- **task**: [OPS-030](../task/OPS-030.md)

## Context

OPS-029 后做 UI 视觉合规审查发现：

1. **14 处 arbitrary value 散落业务组件** —— `[NNpx]` / `[Nrem]` 容器尺寸（dropdown 宽 / iframe 高 / chart 高 / 命令面板 max-h / sidebar active indicator 2px 等），违反 CLAUDE.md "禁止 arbitrary value"
2. **api-tokens.tsx 源码 hardcoded 中文** —— `TTL_OPTIONS` 选项 "1 小时" / "24 小时（默认）" 等、`formatTimeLeft` 倒计时 "永不过期" / "{N} 天后过期" 都直写中文，i18n 失效
3. **console.tsx aria-label 漏 i18n** —— "返回" / "全屏" / "退出全屏" 直写中文

## 范围

| 文件 | 改动 |
|---|---|
| `web/src/index.css` | `@theme inline` 加 10 个 `--size-*` token：`chart` / `iframe-tall` / `iframe-console` / `palette` / `table-skeleton` / `select-sm` / `form-textarea-min` / `row-actions-menu` / `topbar-user` / `input-narrow` |
| 业务组件 ×9 | 14 处 `*-[NN(px|rem)]` 替换为 `*-{size-token}` 或 Tailwind 内置（如 `w-0.5` / `min-w-56` / `min-w-50`） |
| `api-tokens.tsx` | `TTL_OPTIONS` 改 `ttlOptions(t)` helper 接 i18n key；`formatTimeLeft` 接 t fn 参数；新加 11 个 i18n key（`apiToken.ttl.*` + `apiToken.neverExpires` / `expired` / `expiresInDays/Hours/Minutes`） |
| `console.tsx` | 引入 `useTranslation`；3 个 aria-label 走 `t("console.{back,fullscreen,exitFullscreen}")` |
| `zh + en common.json` | 同步补 console + apiToken 新 key |
| 文档 | OPS-030 / PLAN-032 / changelog |

## 设计约束

- **size token 命名按用途而非字面值**：`--size-chart` 而不是 `--size-280`，将来调尺寸只需改一处
- **能用 Tailwind 内置的优先用内置**：sidebar 2px → `w-0.5`、dropdown 14rem → `min-w-56`、textarea 64px → `min-h-form-textarea-min`（同 16，但语义更清）
- **不要为单一使用点新增 token**：尽量复用 `--size-row-actions-menu` 这类多处共享的命名
- **禁用 hex / rgba in JSX**：但 xterm `terminal.tsx` 三个 fallback hex 例外（CSS var 缺失时的 sane default，注释说明）

## 任务拆分

- [x] **PLAN-032.A** `index.css @theme` 加 10 个 `--size-*` token
- [x] **PLAN-032.B** 14 处 arbitrary value 替换（vm-row-actions / tickets / monitoring / observability / vm-detail / users / tickets / vms / api-tokens / app-header×2 / app-sidebar / command / data-table）
- [x] **PLAN-032.C** api-tokens.tsx i18n 化 + zh/en 补 11 个 key
- [x] **PLAN-032.D** console.tsx i18n 化 + zh/en 补 3 个 key
- [x] **PLAN-032.E** tsc + build + 后端 unit/integration + 部署 + PR

## 验收

- `grep -rEn 'className=.*\\[(#[0-9a-fA-F]+|rgba?\\(|[0-9]+(px|em|rem))\\]' web/src --include='*.tsx' --include='*.ts' | wc -l` = 0
- 生产 vmc.5ok.co：
  - admin/monitoring 4 张 chart 高度跟修复前一致（280px）
  - admin/observability iframe 700px
  - admin/vm-detail console iframe 500px
  - 命令面板（Cmd+K）max-height 420px
  - sidebar 选中项左侧 2px indicator 渲染
  - api-tokens 卡片显示 "Never expires" 而不是 "永不过期"
- tsc / build / Go test 全绿

## 不在范围

- DESIGN.md 颜色 / 字重 / 圆角 / 阴影 token 改动（已合规）
- xterm terminal.tsx 3 个 hex fallback（防御性 default，CSS var 缺失时才生效）
- 进一步去 hardcoded 中文 defaultValue（en/common.json 已补完，defaultValue 只在 i18n key 完全缺失时生效）
