# PLAN-024 Linear 风交互三件套（浮层 toolbar / 列宽持久化 / 行内详情抽屉）

- **status**: completed
- **priority**: P2
- **owner**: claude
- **createdAt**: 2026-04-30
- **completedAt**: 2026-04-30（前端 typecheck/build 全绿；vmc.5ok.co 已部署 sha 27b7fd8ed180...）
- **parentPlan**: PLAN-022（Linear 重设计）
- **referenceDoc**: `DESIGN.md`、`PLAN-022`

## Context

PLAN-022 + 后续两轮 Linear 风迭代（hover-gated 主操作、g-序列导航、j/k 键盘
列表、原生 table 视觉统一）已落地。剩余三个高价值 Linear 交互未做：

1. **批量操作浮层化**：`BatchToolbar` 当前 `sticky top` 贴在表格上方，PR/视
   觉上形同 banner，不像 Linear 的 floating action bar。
2. **表格列宽**：`DataTable` 不支持列宽调整与持久化。运维场景下列宽偏好
   差异大（IP / 名称 / 备注谁宽谁窄），无法保存导致每次访问都要重新瞪。
3. **VM 详情快速预览**：列表行点击直接 `navigate` 到 `/admin/vm-detail`
   （独立路由），中断列表浏览节奏；Linear 的范式是**右侧滑出 detail
   peek panel**，列表保持可见，可连续切换不同行。

## 范围

| 模块 | 文件 | 改动 |
|------|------|------|
| 浮层 toolbar | `shared/components/ui/batch-toolbar.tsx` | sticky-top → fixed bottom-center，加 backdrop-blur + shadow-dialog；保持 API 不变 |
| 列宽持久化 | `shared/components/ui/data-table.tsx` | 启用 TanStack column resizing；新增 `tableId` prop 触发 localStorage 持久化；header 右侧 hover 出现 resize handle |
| Detail Peek | `shared/components/ui/sheet.tsx`（小幅扩展） + `features/vms/components/vm-peek-panel.tsx`（新文件） + `features/vms/components/cluster-vms-table.tsx`（接入） | base-ui Dialog `modal=false`，行点击进 peek，"完整详情"按钮跳 vm-detail |
| Tokens | `web/src/index.css` | 新增 `--shadow-floating`（浮层 toolbar 用）+ 复用现有 `--shadow-dialog` |

## 设计约束

- **DESIGN.md 优先**：浮层 toolbar 用 `surface-elevated` + 半透明 + `backdrop-blur-md`，圆角
  `radius-xl`(12px)，shadow 用多层栈；颜色全部读 token，禁止 hex 字面值。
- **API 兼容**：BatchToolbar / DataTable 现有调用方零改动，新功能通过新 props 渐进启用。
- **Peek vs Full Detail**：Peek 只展示概要（status / IP / cluster / 主操作），点击"完整
  详情"才跳页。保持 deep-link 仍可通过列表外部链接进入。

## 任务拆分

- [x] **PLAN-024.A**：BatchToolbar 浮层化
- [x] **PLAN-024.B**：DataTable column resize + localStorage 持久
- [x] **PLAN-024.C**：admin VM 列表 detail peek panel（cluster-vms-table 集成）
- [x] **PLAN-024.D**：tokens 补充（shadow-floating）
- [x] **PLAN-024.E**：build + typecheck + 部署

## 实现说明

### A. BatchToolbar 浮层

```tsx
// 关键样式（全部用 token）
"fixed left-1/2 -translate-x-1/2 bottom-6 z-30",
"flex items-center gap-2 rounded-xl",
"border border-border bg-surface-elevated/95 backdrop-blur-md",
"shadow-[var(--shadow-floating)] px-3 py-2",
// 进入：bottom + fade
"data-[starting-style]:opacity-0 data-[starting-style]:translate-y-2",
"transition-all duration-150"
```

### B. 列宽 resize + persistence

```tsx
const [colSizing, setColSizing] = useColumnSizingPersist(tableId);
useReactTable({
  ...,
  columnResizeMode: 'onChange',
  state: { ...rest, columnSizing: colSizing },
  onColumnSizingChange: setColSizing,
});
```

- `useColumnSizingPersist(tableId)`：tableId 为空时仍可调整但不持久化。
- header `<th>` 右边缘 hover 显示 1px accent 拖拽柄。

### C. Detail Peek

- base-ui `<Dialog.Root modal={false}>` 实现非阻塞抽屉。
- 行点击 → `setPeekVM(vm)` → 抽屉打开（不关闭列表）。
- 抽屉内：状态 / IP / cluster / 节点 / 主操作 + "完整详情" Link。

## 风险

- **column resize 与 row click 冲突**：拖拽手柄要 stopPropagation。
- **modal=false Dialog 焦点管理**：base-ui Dialog 在 modal=false 下不
  trap focus，但仍然 portal 到 body。需要测试 Esc 关闭。
- **CSS 体积**：backdrop-blur 在低端设备成本高，但浮层只在选中后渲染，可接受。

## 验收

- 选中多行 → 浮层 bar 在底部居中升起，半透明 + 模糊背景。
- 拖拽列分隔线 → 实时调整 + 刷新页面后宽度保持。
- 点击 admin VM 行 → 右侧 peek 抽屉滑出（不挡列表），可继续选其它行。
- typecheck 通过，build 通过，systemd active。
