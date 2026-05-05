# PLAN-036 用户级防火墙完整闭环（集中管理页 + 默认组 + 多 VM 批量绑）

- **status**: completed
- **createdAt**: 2026-05-05 15:30
- **approvedAt**: 2026-05-05 15:35
- **completedAt**: 2026-05-05 15:40
- **priority**: P1
- **owner**: claude
- **referenceDoc**: PLAN-035（用户私有组 + per-VM 绑定）/ PLAN-025 INFRA-007（jobs runtime）

## 现状（基于 PLAN-035 已上线）

PLAN-035 已交付：
- 用户可在 vm-detail Firewall Tab 创建私有组（owner_id = self）+ 编辑规则 + 删除
- admin 共享组（owner=NULL）保留旧名 fwg-<slug>，与生产兼容
- ACL 命名 `fwg-u<id>-<slug>` 隔离
- quota 5 组 × 20 规则
- per-VM bind/unbind via `vm-detail` UI

**痛点（用户反馈）**：
1. 绑定动作 per-VM——5 台 VM 第一次绑要进 5 个详情页（C 痛点）
2. 没有集中管理入口——必须先进某 VM 详情才能看到/编辑自己的组（C 痛点）
3. 新创建的 VM 不会自动应用任何默认策略（A 痛点）

## 决策（待批）

| # | 决策 | 备选 / 理由 |
|---|---|---|
| D1 | 加用户级 sidebar 链接 `/firewall`，对应新 route 集中管理页 | 备选：admin 共享组只读视图 + 我的组 CRUD 在同一页。简化用户心智 |
| D2 | 默认组用 junction table `user_default_firewall_groups (user_id, group_id, sort_order)` | 备选：在 users 表加 default_group_ids INT[]。junction 表更标准，便于 FK CASCADE 删用户/删组时自清 |
| D3 | 默认组应用时机：jobs runtime `vm.create` finalize 步骤后**软失败**绑定。失败 → audit log + 不阻塞 VM 创建 | 让 VM 一定能创建出来；用户事后看到默认组没装上可以手动补 |
| D4 | 批量绑定路径：`POST /portal/firewall/groups/{id}/bind:batch` body `{ vm_ids: [] }`，按 batchutil.Response 返 succeeded/failed；解绑同 | 与 PLAN-023 已有 batchutil 一致 |
| D5 | UI 批量绑定的 cold-modify 警告：UI 显示"将临时停机 N 台运行中 VM"，要求显式确认 | 用户必须知道 N 个 10-15s 离线的代价 |
| D6 | 集中管理页 `/firewall` 仅对**用户角色**可见；admin 仍走 `/admin/firewall` 不变 | 不污染 admin 视角 |
| D7 | 默认组的"应用到现有 VM" 不自动执行——只对**新创建** VM 生效 | 防止用户改默认列表时意外重启所有线上 VM。要应用到现有 VM 用 D4 的批量绑定 |

## 范围

### 后端

1. **migration 021**：
   - `user_default_firewall_groups (user_id BIGINT FK users, group_id BIGINT FK firewall_groups, sort_order INT, created_at, PRIMARY KEY (user_id, group_id))`
   - 索引 `(user_id, sort_order)`
   - ON DELETE CASCADE：用户/组删除自动清

2. **repository/firewall.go**：新方法
   - `ListDefaultGroupsForUser(userID) []FirewallGroup`
   - `ReplaceDefaultGroups(userID, groupIDs []int64) error`（事务原子）
   - `ListBoundVMsForGroup(groupID, userID) []model.VM`（仅返该用户拥有的 VM；admin 共享组从所有用户 VM 视角不暴露——D6 限定）

3. **handler/portal/firewall.go**：新 endpoint
   - `GET /portal/firewall/defaults`（list 用户默认组）
   - `PUT /portal/firewall/defaults` body `{ group_ids: [] }`（替换；group_ids 必须 owner_id IS NULL OR = current）
   - `GET /portal/firewall/groups/{id}/vms`（看哪些自己的 VM 绑了该组）
   - `POST /portal/firewall/groups/{id}/bind:batch` body `{ vm_ids: [] }`
   - `POST /portal/firewall/groups/{id}/unbind:batch` body `{ vm_ids: [] }`
   - 都加 owner check + group 可见性 check + per-VM owner check

4. **service/jobs/vm_create.go**：finalize 步骤后调用 `applyUserDefaultFirewallGroups(ctx, userID, vmName, ...)`
   - 读 `ListDefaultGroupsForUser`
   - 循环 `service.FirewallService.AttachACLToVM` + `repo.Bind`
   - **失败软处理**：log + audit `firewall.default_apply_failed`，不阻塞 finalize

### 前端

1. **新路由 `web/src/app/routes/firewall.tsx`**（用户级集中管理页）：
   - 三个 section：
     - **我的默认组**（A）：拖拽排序的组列表 + "+ 添加默认" / "移除"
     - **我的组**（C）：list + "+ 新建" + 行内"编辑 / 删除 / 应用到 VMs"
     - **管理员共享组**（C）：read-only list + 行内"应用到 VMs"
   - 复用 `<CreateUserGroupSheet>` / `<EditUserGroupSheet>`

2. **新组件 `<BindToVMsDialog>`**（B）：
   - 列出当前用户所有未在 trash 的 VM（checkbox）
   - 显示哪些已绑（disabled）/ 哪些未绑（可勾）
   - 显示"将临时停机 N 台运行中 VM" 警告（D5）
   - 提交 → `bind:batch` endpoint
   - partial 失败 toast 显 `succeeded / failed` 数

3. **新组件 `<DefaultGroupsManager>`**（A）：
   - 显示用户当前默认组（按 sort_order）
   - 加/删 / 排序
   - 提示"仅对新建 VM 生效；要应用到现有 VM 请用'应用到 VMs'"

4. **sidebar 加链接**：用户视角加 "Firewall" 入口指向 `/firewall`，sidebar-data.ts 一行

5. **i18n EN/ZH** 约 25 个新 keys

### 不做（明确）

- ❌ admin 端集中页改造（`/admin/firewall` 不动）
- ❌ 默认组自动应用到现有 VM（D7：仅新建 VM）
- ❌ 拖拽排序在第一版只用上下按钮（react-dnd 太重）
- ❌ "应用到 VMs" 时智能选已绑/未绑——只显示当前状态让用户明确选

## 风险 / 回滚

| 风险 | 缓解 |
|---|---|
| 批量绑定 N 台 running VM 全部 10-15s 离线，用户没意识到 | UI 显式 warning + 数字确认 N 台。后端串行处理（不并发）让用户看进度 |
| 默认组绑定失败但 VM 创建成功，用户以为"防火墙安全" | jobs finalize 失败时 audit + dashboard 通知（可选）。文档明示"默认组是 best-effort" |
| 删除组时 default 表残留外键 | ON DELETE CASCADE 自动清；ListDefaultGroupsForUser 也再 join 过滤已删 |
| 默认组改了但已有 VM 没同步 | D7 决策不自动同步；UI 文案明示。用户用 D4 批量绑定补 |
| `ListBoundVMsForGroup` 暴露的 VM 跨用户 | 加 user_id 过滤；admin 共享组不通过此 endpoint 暴露绑定关系（D6） |
| 集中管理页与 admin /admin/firewall 路由命名冲突 | 用户路由 `/firewall`，admin `/admin/firewall`，路径前缀区分 |

## 验收标准

- 用户登录后 sidebar 看见 "Firewall" 入口；点击进 `/firewall`
- `/firewall` 页面三 section 全显示；admin 共享组 read-only / 自己的组可 CRUD
- 我的组 → "应用到 VMs" → Dialog 列我所有 VM + checkbox + warning → 提交 → 串行绑定 → toast partial 结果
- 默认组：先 PUT 默认组列表 → /launch 创建新 VM → VM 自动绑定该组 → vm-detail Firewall Tab 显示已绑
- 默认组失败（如组在 PUT defaults 后被删）→ VM 创建成功但 audit log 有 `firewall.default_apply_failed`
- ACL 在 Incus 实际生效（已绑组规则起效）—— 单 VM smoke test
- migration 021 应用：现有用户 default 表为空，无 default 行为，向后兼容
- E2E：注入 phantom 2 台 VM（owner=ai） → /firewall 页 → 我的组"应用到 VMs"全选 → 都绑定成功 → batch unbind 全选 → 都解绑

## 估时

- 后端 migration + repo + service + handler + jobs 集成: 1 天
- 前端 /firewall 页 + DefaultGroupsManager + BindToVMsDialog: 1 天
- i18n + tsc/lint/build + 部署 + E2E: 0.5 天
- **合计 ~2.5 天**

---

## 等待

按 PMA 流程：**proposal 已落地，等用户回复 `proceed` 再进入 implement 阶段**。如要调整 D1-D7 任一决策也告知。
