# PLAN-034 UI 流程降步优化（VM 批量 + 节点向导 + 充值 + 全局快捷）

- **status**: completed
- **createdAt**: 2026-05-04 02:10
- **completedAt**: 2026-05-04 15:10
- **priority**: P1
- **owner**: claude
- **referenceDoc**: PLAN-024（VM 批量动作）/ PLAN-026（节点 UI）/ PLAN-033（节点向导）

## 完成摘要

后端 trash-undo 全栈（migration 019 + repo + service + worker + handler + main 注册），前端 P1-B 用户端 /vms checkbox + BatchToolbar + trash-undo toast + TrashBanner，P1-C 用户详情抽屉 + preset 充值 + 批量充值，P2-A 节点向导 TOFU 单步 + NIC 折叠 + 内联凭据 Dialog，P2-B 命令面板 `/` 快捷 + 全局 quick action，P3 订单审批 UI（Active=作废 / Pending=批准+拒绝 / Cancelled=空）。

部署 4 个版本到 vmc.5ok.co：
- v1：初版
- v2：worker `isAlreadyGoneErr` 幂等修复
- v3：UserDetailSheet `lastUserRef` 修"关不掉"
- v4：`/` 快捷键改原生 keydown（react-hotkeys-hook 不识别字面 /）

收尾 polish：i18n EN/ZH 50+ 新 keys 同步，`formatError` helper 解析后端 `body.error`（去 "HTTP 4xx:" 噪音前缀），step-up redirect `rewriteStepUpRD` 修复 GET 回跳 405 死路。

Playwright 端到端真链路验证：登录 → 真 +$10 充值（tom $940→$950）→ 真 trash MyVM + TrashBanner + restore endpoint → 命令面板 ⌘K + `/` + quick action keywords → 订单审批 UI 状态条件渲染 → /admin/users dialog 三种关闭方式（X/ESC/backdrop）+ 重复打开 + focus trap 释放。

## 背景

当前 UI 多处操作步骤偏多，按"clicks × 频率 × 痛感"排序得到 Top 3 高 ROI 路径：

| 排名 | 路径 | 现状 clicks | 业界基线 |
|---|---|---|---|
| 1 | 用户端 VM 删除/批量管理 | 3+ clicks 单台、N×3 批量、无 checkbox | AWS/Linode/Vultr 标配 checkbox + bulk toolbar |
| 2 | 节点加入向导 | 7-9 clicks（cred 跳页 + NIC 手选 + TOFU 双步） | OpenSSH 单步 fingerprint trust |
| 3 | 用户充值/配额 | 4-6 clicks/人（行内、无 preset、无批量） | HighLevel/Flexprice preset $200/$500/$1000 |

业界研究：[Eleken bulk actions](https://www.eleken.co/blog-posts/bulk-actions-ux) / [NN/g 危险动作](https://www.nngroup.com/articles/confirmation-dialog/) / [Mobbin command palette](https://mobbin.com/glossary/command-palette) / [HighLevel 自动充值](https://help.gohighlevel.com/support/solutions/articles/155000005620)。

## 决策

| # | 决策 | 来源 |
|---|---|---|
| D1 | VM 删除走 trash-with-undo（30s 软删）后端全栈实现，刷新页不丢失 undo 窗口 | 用户拍板 2026-05-04 |
| D2 | TOFU 双确认放宽为单步——按钮文字"信任并继续"承担确认语义；fingerprint 仍可见 | 用户拍板 2026-05-04，定为内部环境信任口径 |
| D3 | 一次性把 P1+P2+P3 全做完再统一部署测试 | 用户拍板 |
| D4 | 视觉值统一走 DESIGN.md → Tailwind v4 @theme token，禁止 hex 字面量与 arbitrary value | 项目纪律 |
| D5 | trash-undo 不一刀切：仅"普通 vm.delete"走 trash；批量删除 ≥ 3 台仍 type-to-confirm；force-delete-gone 走原路径不变 | NN/g 严重度分级 |

## 范围

### P1（高频日常）

**P1-A 后端 trash-undo（Go）**
- VM 表新增 `trashed_at TIMESTAMPTZ NULL`（migration 019）
- `repository/vm.go`：list 查询过滤 `trashed_at IS NULL`；新增 `MarkTrashed/UnmarkTrashed/ListTrashedBefore`
- `service/vm.go`：新增 `Trash`（stop + 标 trashed_at）/ `Restore`（取消标记 + 启动）/`PurgeTrashed`（worker 调原 Delete）
- `handler/portal/vm.go`：`DELETE /admin/vms/{name}` 改为 trash 语义（不立即删）；新增 `POST /admin/vms/{name}/restore`；后台 worker 30s 后清理
- 运维兜底：reconciler 启动后扫描 trashed_at > 60s 的行（worker 漏跑也最终一致）

**P1-B 用户端 /vms 批量工具栏**
- `vms.tsx` 加 checkbox 列 + selectedIds Set + 接现成 `BatchToolbar`
- 批量：start / stop / restart / delete（≥ 3 台触发 typed confirm）
- 单台 delete：toast 显示"已移入回收站，30s 内可撤销"+ undo 按钮
- 复用 `useBatchVMMutation`（已有），扩 portal 路径

**P1-C 充值/配额抽屉化**
- 行内编辑器抽离为 `<UserSheet>`（右侧 drawer）：余额 + 配额 + 历史 + 操作日志同处
- Top-up preset：+¥10 / +¥50 / +¥200 / 自定义 → 1 click 完成
- 批量充值：toolbar"每人 ¥X"→ 后端 batch endpoint，单笔 audit log

### P2（次频）

**P2-A 节点加入向导优化**
- Stage 1 加"+ 新建凭据"内联弹层（用现有 SaveCredential mutation）
- NIC 角色：自动推断后默认折叠，置信度 ≥ 阈值时仅显示一行摘要 + "调整"按钮
- TOFU：去 checkbox，按钮改 "信任并继续 →"，单按钮承担确认（D2 决策）

**P2-B 命令面板补全 + 全局快捷键**
- 补 quick actions：创建 VM / 加节点 / 给 X 充值 / 打开 Console
- 全局：`g v` → /vms，`g d` → /，`g a` → /admin，`/` 聚焦命令面板搜索
- /vms 已有 j/k/Enter/n（保留）

### P3（打磨）

- HA 单页：Status + History 合并为时间线左、当前状态右
- 订单审批：行内"批准/退款/拒绝"按钮 + 状态流转
- Firewall：JSON 批量导入（保底；不在主目标）

## 不做

- ❌ Auto-topup 阈值自动充值（HighLevel 第二代功能，需先有支付通道支撑，缓做）
- ❌ Smart Adjustment 自动升档 preset（数据驱动，待观察一段）
- ❌ Floating IP 批量绑定（脱离本次范围）

## 视觉合规

所有新组件视觉值经 Tailwind token 接入：
- 颜色：`bg-surface-*` / `text-*` / `border-*` / `bg-destructive` 等
- 字号：`text-caption` / `text-body` / `text-h3` 等（不用 `text-[14px]`）
- 半径：`rounded-md` / `rounded-xl` / `rounded-pill`
- 阴影：`shadow-floating` / `shadow-dialog` / `shadow-elevated`
- 间距：8px 网格（`gap-2`/`p-3`/`p-4` 等内置 scale）

如有冲突 DESIGN.md 优先 pma-web。

## 风险 / 回滚

| 风险 | 缓解 |
|---|---|
| trash-undo 后台 worker 漏跑导致 VM 永远 trashed | 启动期 reconciler 扫一遍；trashed_at > 60s 强制 purge |
| 30s 时窗内连续 trash → restore → trash 抢占 | 后端 Restore 检查 trashed_at IS NOT NULL；worker purge 用 SELECT ... FOR UPDATE 防 race |
| 批量充值出错部分成功 | 复用 batchutil.Response[K]：返回 succeeded/failed 数组，前端按现有 partial-toast 模式 |
| TOFU 单步降级 = 安全审查放宽口径 | 内部环境约定，已在 D2 记录；仍显示 fingerprint，按钮带 lock icon |

## 验收标准

- VM 单台删除 1 click + 30s undo 可撤回（刷新页面后 undo 仍可用）
- VM 批量 N 台 = 1 confirm + 1 进度条
- 节点加入"标准路径"3-4 clicks（凭据存在 + NIC 自动推断成功）
- 充值 preset 1 click（+¥50）即触发，audit log 单独记录
- 命令面板可查"创建 VM"/"加节点"/"给 X 充值"
- 全局 `/` 聚焦命令面板，`g v` 跳 /vms
- 所有新增组件零 hex 字面量、零 arbitrary value（CI lint 不报警）
