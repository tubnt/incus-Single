# UI 组件选型指南

> 适用于 `incus-admin/web` 前端。新增页面 / 重构页面前先读本文档。

## 选型决策表

| 场景 | 组件 | 触发器 | 容器 | 关闭方式 |
|---|---|---|---|---|
| **查看详情**（只读：发票详情、VM peek 等） | `Dialog` | Button / 行内"详情"链接 | 居中 modal，宽 `w-sheet-md`(32rem) | 关闭按钮 / 点击 backdrop |
| **新建 / 编辑**（多字段表单、需要更大空间） | `Sheet` | "+ 新建" / 行内"编辑"按钮 | 右侧抽屉 `w-sheet-md` 或 `w-sheet-lg` | Cancel / 关闭按钮 |
| **快照 / 监控等长面板**（与对应 VM 紧密绑定） | `Sheet` | 行内 dropdown menu item | 右侧抽屉 `w-sheet-md` | Sheet header X 按钮 |
| **危险确认**（删 VM / 删 SSH key / reinstall / reset password） | `AlertDialog` 通过 `useConfirm()` hook | 行内 destructive button | AlertDialog（带 typeToConfirm） | 显式 Cancel / Confirm |
| **下拉选择**（OS 镜像、Cluster、Project 等枚举） | `Select`（base-ui）或自建 `Combobox`（cmdk + Popover） | trigger button 自身 | Popover anchored 到 trigger | 选择 item / Esc / 点击外部 |
| **轻量提示 / 标签筛选** | `Popover` 或 `Tooltip` | 触发元素 | 小弹层 | 鼠标移开 / Esc |
| **全局命令面板** | `Dialog` 包 cmdk | `Cmd+K` / 顶部按钮 | 居中 dialog `w-sheet-lg` | Esc / 选项触发 |

## 边界规则

1. **危险动作必须走 `useConfirm()`**：删除 / 重装 / 重置密码 / 强制操作。禁止用 `window.confirm` 或临时手写 div。
2. **typeToConfirm**：高危（删 VM、降级 admin、释放 Floating IP）必须要求用户输入对象名/特征字符串才能解锁 Confirm 按钮。
3. **Sheet 不放阅读类内容**：详情查看走 Dialog，因为 Dialog 的居中模态更适合"看"。Sheet 适合"做"（编辑表单 / 多步流程）。
4. **整页流程优先于 Sheet**：跨多段表单（如创建云主机）使用整页路由（`/launch`、`/admin/create-vm`），而非塞进右侧 Sheet。
5. **Listing 布局**：默认用 `Table`/`DataTable`；只有在每行需要独立操作 + 有视觉重 cards（如工单列表带历史预览）才用 Card 堆叠。
6. **宽度走 `--size-sheet-{sm,md,lg}` token**：禁止业务侧出现 `w-[min(...)]` 这种 arbitrary value。

## 当前现状（OPS-033 归档）

| 现状 | 评价 |
|---|---|
| `InvoiceDetailDialog` 用 Dialog | ✅ 符合规则（详情查看） |
| `VMPeekPanel` 用 Sheet | ✅ 符合规则（绑定 VM 的多区域面板） |
| `CommandPalette` 用 Dialog | ✅ 符合规则 |
| `useConfirm()` 全 destructive 动作 | ✅ 100% 覆盖（删 VM / SSH key / reinstall / reset-pwd / 降级 admin / 释放 IP） |
| `tickets` 列表用 Card 堆叠 | ⚠️ 有分歧 —— 但 ticket 列表项含历史摘要 + 操作，Card 比 Table 信息密度更合理；保留 |
| `OsImagePicker` 用 Combobox | ✅ 符合规则（可搜索枚举） |

## 反模式（请避免）

- ❌ 用 Sheet 装单字段输入（应该用 Dialog 或 inline editing）
- ❌ 用 Popover 装表单（应该用 Sheet / Dialog）
- ❌ 用 `window.confirm()` / `alert()` / 临时模态（必须走 `useConfirm()`）
- ❌ 给 Dialog 自定义 width 用 arbitrary value（应使用 `--size-sheet-*` token）
- ❌ 在 Listing 上同时混用 Card 和 Table（一页内应一致）

## 决策原因记忆

- **为什么 Dialog 阅读 / Sheet 编辑**：Linear 风格里 Dialog 居中、Sheet 右侧。居中带 backdrop 更聚焦用户阅读；右侧抽屉允许保留主页面上下文，适合表单回退查看数据。
- **为什么不用 `Modal` 这个名字**：base-ui 没有 `Modal`，统一用 Dialog/AlertDialog 区分。
- **为什么 typeToConfirm 默认开**：上线后误删 VM / Floating IP 能力毁灭性，输入对象名是最低成本的 cognitive friction。
