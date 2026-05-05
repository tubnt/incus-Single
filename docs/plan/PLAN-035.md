# PLAN-035 用户级防火墙（user-owned firewall groups）

- **status**: completed
- **createdAt**: 2026-05-05 13:10
- **approvedAt**: 2026-05-05 13:47
- **completedAt**: 2026-05-05 14:22
- **priority**: P1
- **owner**: claude
- **referenceDoc**: PLAN-021 Phase E（admin firewall group） / OPS-017（egress） / VPC 决策（不做网络隔离）

## 现状（已调查）

`internal/handler/portal/firewall.go:42-48` PortalRoutes 仅 4 条 endpoint：
- `GET /portal/firewall/groups` — 只读列出**全部 admin 预设组**
- `GET/POST/DELETE /portal/services/{id}/firewall[/{groupID}]` — 给自己 VM 绑/解绑

用户**不能**：创建/编辑/删除 firewall group、写自己的规则。模型是"admin 定义模板 + 用户应用"。

技术架构调查（2026-05-05）已确认无 fundamental 限制：
- DB schema：单表 `firewall_groups` 仅缺 `owner_id`
- Service 层：`ACLName(slug)` 用 slug 直接命名 Incus ACL，slug 加 owner 前缀即可隔离
- Incus 后端：单 project (`default`) 下 ACL 名空间全局唯一，命名隔离即够
- Cluster 多机：`EnsureACL` 已遍历 `clusterMgr.List()`，用户组自动多 cluster 同步
- Owner check 模式：portal `BindVM` 已有 `vm.UserID != current → 403` pattern 可直接复用

## 决策（待批）

| # | 决策 | 备选 / 理由 |
|---|---|---|
| D1 | 用户**可创建私有组**（owner_id = self），与 admin 共享组（owner_id = NULL）共存 | 备选：仅"提交规则给 admin 审批"——更慢更安全但 UX 差。私有组对内部测试环境更直接。 |
| D2 | Slug 命名空间：admin 共享组保留旧名 `fwg-<slug>`（向后兼容生产已有 ACL）；用户组 ACL 名 `fwg-u<owner_id>-<slug>` | 不破坏生产现有 `fwg-default-web` / `fwg-ssh-only` / `fwg-database-lan` 绑定 |
| D3 | 用户组 quota：默认 `max_firewall_groups = 5`、`max_rules_per_group = 20`，进 `quotas` 表 | 防滥用 + 写库性能 |
| D4 | 用户**不能**绑别人的私有组（绑时校验 group.owner_id IS NULL OR = current） | 否则用户能借别人的组突破自己 quota |
| D5 | 不做 destination_port 黑名单（如禁用 25 防 spam） | 内部环境 + 当前定位；外部售卖时再加，PLAN-035 范围外 |
| D6 | UI：portal-firewall-panel 加"我的组" section + "+ 新建" Dialog + 内联 rule 编辑器；admin 防火墙页**不变** | 改动局部，不动 admin |
| D7 | 冷改造体感（stop→PATCH→start ~10-15s）保留现有 service 路径 | 业界改进路径需脱离 Incus ACL 模型，远超本 plan 范围 |

## 范围

### 后端
1. **migration 020_firewall_user_owned.sql**：
   - `firewall_groups` 加 `owner_id BIGINT NULL REFERENCES users(id) ON DELETE CASCADE`
   - 唯一约束 `slug` → `(COALESCE(owner_id, 0), slug)`（NULL=admin 共享，0 哨兵防 NULL 唯一性陷阱）
   - 索引 `idx_firewall_groups_owner ON firewall_groups(owner_id) WHERE owner_id IS NOT NULL`
   - `quotas` 表加 `max_firewall_groups INT NOT NULL DEFAULT 5` + `max_firewall_rules_per_group INT NOT NULL DEFAULT 20`

2. **model.FirewallGroup**：加 `OwnerID *int64` 字段。

3. **repository/firewall.go**：
   - `ListGroupsForUser(userID)` 返 owner IS NULL OR = userID 的组
   - `CreateGroup` 接受 ownerID
   - `CountGroupsByUser(userID)` for quota check
   - `GetGroupByID` 已存在，调用方加 owner check

4. **service/firewall.go**：
   - `ACLName(group)` 改签名：admin 组（OwnerID=nil）→ `fwg-<slug>`；用户组 → `fwg-u<id>-<slug>`
   - `EnsureACL` 取 group 全字段而不仅 slug

5. **handler/portal/firewall.go**：新增 4 个 endpoint：
   - `POST /portal/firewall/groups`（owner_id = current；quota 校验）
   - `PUT /portal/firewall/groups/{id}`（owner check）
   - `DELETE /portal/firewall/groups/{id}`（owner check + 检查无 VM 绑定否则 409）
   - `PUT /portal/firewall/groups/{id}/rules`（owner check + per-group rule quota）
   - `ListGroups` portal 路径改用 `ListGroupsForUser`
   - `BindVM` 加 group 可见性校验（`group.OwnerID == nil || group.OwnerID == current`）

6. **audit**：所有用户组 CRUD 写 audit_logs，target_type='firewall_group' target_id=group.id。

### 前端
1. **features/firewall/api.ts**：
   - `usePortalCreateGroupMutation` / `usePortalUpdateGroupMutation` / `usePortalDeleteGroupMutation` / `usePortalReplaceRulesMutation`
   - `usePortalFirewallGroupsQuery` 已有，复用（后端过滤）

2. **features/vms/components/portal-firewall-panel.tsx**：加"我的组"section + "+ 新建" 按钮（打开 Dialog）+ 行内"编辑规则"按钮（打开 Sheet 内嵌 rule editor）。

3. **新组件 `features/firewall/components/user-group-editor.tsx`**：
   - 字段：name / slug（auto from name, 用户可改）/ description / rules array
   - rules editor：每行 direction / action / protocol / port / source_cidr / description；加/删行；拖拽 sort_order
   - Quota 提示："已用 X / 上限 Y 组"
   - 视觉走 DESIGN.md token，无 hex 字面量

4. **i18n EN/ZH**：约 15 个新 keys（vm.firewall.* 子树扩展 + 错误消息）。

### 不做（明确）
- ❌ Destination port 黑名单
- ❌ 用户共享组给同租户其他用户（暂保持 owner-private）
- ❌ Egress 规则 UI（model.FirewallRule.Direction 已支持 egress；UI 暂仅暴露 ingress 给用户，admin 仍可通过 admin 页用 egress）
- ❌ 冷改造路径替换（脱离 Incus ACL，远超 plan 范围）
- ❌ 改 admin 防火墙页

## 风险 / 回滚

| 风险 | 缓解 |
|---|---|
| 现有生产 fwg-* ACL 被改名打断绑定 | D2：admin 共享组 OwnerID=nil → 仍走旧名 `fwg-<slug>`；migration 020 不动现有行 |
| 用户开 `0.0.0.0/0 ALL ports` 攻击其他租户 | 多租户隔离不归 firewall 管（VPC 决策已 declinen）；本 plan 不解决也不引入新风险 |
| 唯一约束改 `(COALESCE(owner_id,0), slug)` 撞旧数据 | 现有 3 个 seed 组 owner_id=NULL → COALESCE=0；slug 互不相同（default-web/ssh-only/database-lan），无冲突 |
| 用户高频改规则，VM 频繁中断 | UI 加强 toast 提示 + 加可选"应用"按钮（编辑期不立即触发 PATCH） |
| Quota 默认 5/20 太严或太松 | 加进 quotas 表后 admin 可调整；不动用户量级时无影响 |
| 删除被绑定的组 | repo `DeleteGroup` 检查 `vm_firewall_bindings.group_id` 非空 → 409 with hint |

## 验收标准

- 用户在 vm-detail "防火墙" Tab 可见"我的组" + "+ 新建组"按钮
- 创建组成功后可在自己任意 VM 绑定，admin 共享组绑定不变
- 编辑规则触发 service 冷改造（VM 短暂离线）
- 用户**不能**绑别人的私有组（404/403）
- 用户**不能**编辑/删除 admin 共享组
- 用户超过 quota 创建第 6 个组时收到清晰 toast
- migration 020 在生产 DB 应用后，现有 admin 共享组绑定的 VM 网络无中断
- Playwright E2E：登录 ai → vm-detail → 创建组 → 加 2 条规则 → 绑定到 MyVM → 解绑 → 删除组 全流程绿

## 估时

- 后端 migration + model + repo + service: 0.5 天
- 后端 handler + audit + 单测: 0.5 天
- 前端 user-group-editor 组件: 1 天
- 前端 portal-firewall-panel 整合 + i18n: 0.5 天
- 端到端测试 + 部署 + memory: 0.5 天
- **合计 ~3 天**

---

## 等待

按 PMA 流程：**proposal 已落地，等用户回复 `proceed` 再进入 implement 阶段**。
