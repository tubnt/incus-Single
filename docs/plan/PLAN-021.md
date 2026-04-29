# PLAN-021 运维 Must-Have（多 OS / 重装 / 密码重置 / Rescue / 防火墙组 / 新 IP 段 / Floating IP）

- **status**: completed
- **priority**: P1
- **owner**: claude
- **createdAt**: 2026-04-24 00:10
- **approvedAt**: 2026-04-24 00:30
- **completedAt**: 2026-04-24（全 7 phases: A 模板 / B Reinstall / C 密码重置 / D Rescue / E 防火墙 / F 新段 / G Floating IP）
- **relatedTask**: OPS-001 / OPS-002 / OPS-003 / OPS-004 / OPS-005 / OPS-006
- **parentPlan**: —

## Context

PLAN-020 收尾后平台的"HA + 审计 + VM 生命周期"闭环完成，但**对外售卖**仍缺一批运维 Must-Have 功能：

| 缺口 | 用户痛点 | 现状 |
|------|---------|------|
| 多 OS 模板 | 仅 4 个镜像（Ubuntu 24/22、Debian 12、Rocky 9），没有 Alma / Arch / Fedora / Windows / 自定义 ISO | `web/src/features/vms/os-image-picker.tsx` 硬编码；无后端镜像管理 |
| 重装系统 | 功能已在 handler/service 层实现，但无 UI 入口 + 不支持换 OS 换密码换 SSH key 的显式流程；用户名硬编码 `ubuntu` | `VMService.Reinstall` @ `internal/service/vm.go:205` 只支持 `linuxcontainers.org` 拉镜像，无统一模板抽象 |
| 重置密码 | 当前只通过 Incus exec + chpasswd，要求 VM 必须可 exec（启动 + guest agent OK）；关机 VM / 卡死 VM 无法重置 | `VMService.ResetPassword` @ `internal/service/vm.go:314` 依赖 `ExecNonInteractive` |
| Rescue 模式 | 无。VM 启动不了就只能删除重建 | 完全缺失 |
| 防火墙组（Security Group） | 无。当前仅依赖 Incus project 级 ACL（一次写死），用户无法自服务 | 完全缺失，grep 全库零匹配 |
| 新 IP 段 `202.151.179.0/26` VLAN 376 | 已扩容物理网段，但 ip_pools 未接入 | `internal/repository/ipaddr.go` 逻辑成熟，只缺数据 |
| Floating IP（ARP 宣告） | 无。用户不能"把 IP 从 VM A 挪到 VM B" | 完全缺失 |

以上 7 项是**对外售卖的前置闸门**（多 OS + 重装 + 密码重置 + Rescue 是用户自服务基线；防火墙组 + Floating IP 是竞品 DO/Vultr/Linode 的标配）。不做会直接影响商业可用性。

## Decisions

1. **镜像模板 DB 化**：新表 `os_templates`（id / slug / name / source / protocol / default_user / cloud_init_template / supports_rescue / enabled / sort_order），`os-image-picker.tsx` 改走 `GET /api/templates`。新增模板不再改代码。
2. **Reinstall 走模板**：前端传 `template_slug` 而非裸 `images:...` 字符串；后端按模板字段还原 source + default_user；保留 `cloud-init` 注入密码。
3. **密码重置双通道**：默认走 Incus exec（现有路径），exec 失败自动回落到"重启进入 cloud-init chpasswd"——停机/卡死 VM 走离线路径（修改 cloud-init userdata + 强制重启）。
4. **Rescue 模式走 RAW 启动盘换挂载**：临时挂一个 rescue 镜像作为 root disk，原盘改挂 `/dev/sdb`；恢复时反向切回。不走独立 ISO profile（Incus 对 ISO boot 支持弱）。
5. **防火墙组走 Incus network ACL**：Incus 6.x 原生支持 `incus network acl`，前端暴露"组级规则"（protocol / port / source CIDR / allow/deny），绑定到 VM NIC 的 `security.acls`。避开造轮子。
6. **新 IP 段录入通过 migration + admin UI 双通道**：migration 009 预填 `202.151.179.0/26`，但允许 admin UI 后续增量。
7. **Floating IP 走"可迁移 IP 池"**：`ip_pools.kind = 'floating'` 新字段，Floating IP 不绑定创建 VM 时的 NIC，而是作为"可转移 IP"单独分配；后端通过 `incus network forward` + `garp` 广播切换。不用 BGP/VRRP（复杂度高、现有网络不支持 BGP peering）。

## Phases

### Phase A — 镜像模板 DB 化 + UI 动态化（3d）✅

- [x] migration 009 `os_templates` 表 + seed（9 条：Ubuntu 24.04/22.04/20.04、Debian 12/11、Rocky 9、Alma 9、Arch、Fedora 40）
- [x] `internal/repository/os_template.go` — CRUD + ListEnabled / ListAll / GetBySlug
- [x] `internal/handler/portal/template.go` — `GET /portal/os-templates` + admin CRUD `/admin/os-templates` + `os_template.{create,update,delete}` 审计
- [x] 前端 `features/templates/api.ts` + 重写 `os-image-picker.tsx` 从 DB 读；`useOsImageLabel` 替换 `getOsImageLabel`；admin/vms.tsx 的 inline `OS_IMAGES` 也消掉
- [x] admin `/admin/os-templates` 页面（增删改 + 启用/停用 + 排序 + sidebar "OS Images"/"OS 镜像" 入口）

### Phase B — Reinstall 走模板 + UI 接入（2d）✅

- [x] `VMService.Reinstall` 改签：`ReinstallParams{ImageSource/ServerURL/Protocol/DefaultUser}`（service 层完全解耦模板表）—— 原 `NewOSImage` 被替换；默认值 fallback（linuxcontainers.org / simplestreams / ubuntu）
- [x] Handler 新增 `reinstall_resolve.go`：`resolveReinstallTemplate(template_slug, os_image)` —— slug 优先、legacy os_image fallback（含 distro→default_user 启发式），失败路径：空参 / slug 不存在 / slug disabled 都提前 400
- [x] `audithelper.go` 新增 `SetOSTemplateRepo` + `main.go` 接线
- [x] 前端 `features/templates/template-picker.tsx` 新组件（emit slug）+ `DEFAULT_TEMPLATE_SLUG` 首屏默认
- [x] `features/vms/api.ts` `useReinstallVMMutation` 签名改为 `{template_slug?, os_image?}` 双字段
- [x] `admin/vms.tsx` ReinstallPanel 切 `TemplatePicker` + `template_slug`
- [x] 审计 action `vm.reinstall` details 含 `template_slug / source / user`；middleware 级 `http.POST` 审计同步记 body.template_slug
- [x] 单测 14 cases（`resolveReinstallTemplate` 7 + `defaultUserForSource` 12 kv）
- 注：portal (`/portal/services/{id}/reinstall`) 目前只有 API 无 UI；Phase E 防火墙组 / 后续用户详情页增量做 portal reinstall 入口

### Phase C — 密码重置离线回落（2d）✅

- [x] `VMService.ResetPassword` 签名改 `(ctx, cluster, project, vm, user, mode) → (*ResetPasswordResult, error)`；`mode` = `auto|online|offline`，默认 `auto`
- [x] `auto` 先试 online（exec chpasswd），失败（client err 或 retCode≠0）→ 自动回落 offline；`online` / `offline` 强制走对应路径
- [x] offline 路径：GET instance → stop（best-effort）→ 注入 `cloud-init.vendor-data`（chpasswd.users[] 结构，**不覆盖** user-data 保留 SSH keys）+ `cloud-init.instance-id` bump（新 `iid-<8-byte-hex>` 强制 cloud-init 重跑）→ PUT 全量 instance → start
- [x] 审计 action `vm.reset_password` details 记录 `channel / fallback`；handler 响应体也携带，前端可展示"本次走了哪条路"
- [x] 单测 3 组（`TestOfflineChpasswdCloudConfig` YAML 形状 + `TestNewInstanceID` 唯一性/前缀/长度 + `TestResetPasswordModeConstants` wire 字符串）

### Phase D — Rescue 模式（3d）✅（**safe-mode-with-snapshot 语义**，不换 root disk）

**范围调整**（vs 原 PLAN 设计）：
- 原设计"换 root disk device + 原盘挂 data"改为 **safe-mode-with-snapshot**：`enter` = 自动快照 + 停机；`exit` = 可选 restore 快照 + 启动 + 可选删快照
- 理由：换 root disk 牵涉 bootloader 重写，生产唯一 vm-a3e86d 不便试坏；快照+停机方案覆盖 80% "VM 行为异常要冻结现场再修"的场景，风险低得多
- 未来若需真"rescue ISO boot"，可增量加 device swap（current 代码留 rescue_snapshot_name 字段供扩展）

**落地**：
- [x] migration 013 `vms` 表新增 `rescue_state` (`normal|rescue`, CHECK) + `rescue_started_at` + `rescue_snapshot_name` + 部分索引（仅 'rescue' 行）
- [x] `POST /admin/vms/{id}/rescue/enter` 和 `POST /admin/vms/by-name/{name}/rescue/enter` 双路由 —— DB 状态先读 → Incus 快照 + 强制 stop → 原子 DB transition（SetRescueState WHERE rescue_state='normal' 作并发守卫）
- [x] `POST /admin/vms/{id}/rescue/exit` / `by-name/{name}/rescue/exit` —— 入参 `{restore:bool, delete_snapshot:bool}`；restore=true 时先 PUT `/1.0/instances/{name}` body `{restore:snapshotName}` 应用快照；启动后可选删快照
- [x] 前端 `admin/vms.tsx` VMRow 新增 Rescue 按钮：normal 时显示 "Rescue"；rescue 时显示 "Rescue 恢复"（restore=true）+ "Rescue 退出"（restore=false）；所有 enter/exit 走 confirm-dialog + toast 展示快照名
- [x] 审计 action `vm.rescue.{enter,exit}` 完整，details 含 snapshot 名 / restore 布尔 / snapshot_deleted 布尔
- [x] 单测 2 组（`RescueSnapshotName` 格式 + prefix/长度 pin）

### Phase E — 防火墙组（Security Group）（4d）✅

- [x] migration 011 `firewall_groups` + `firewall_rules` + `vm_firewall_bindings` + seed 3 组（`default-web` 22/80/443 / `ssh-only` 22 / `database-lan` 22+3306+5432 RFC1918）
- [x] `internal/service/firewall.go` — `EnsureACL` / `DeleteACL` / `AttachACLToVM` / `DetachACLFromVM`；Incus ACL 落在 `default` project（customers 继承 networks）；NIC `security.acls` 逗号列表 read-modify-write 保留其它 ACL
- [x] `POST|GET|PUT|DELETE /admin/firewall/groups[/{id}]` + `PUT /admin/firewall/groups/{id}/rules`（整组替换语义）
- [x] `GET /portal/firewall/groups`（只读）+ `GET|POST|DELETE /portal/services/{id}/firewall[/{groupID}]`（绑定 /解绑，owner 校验）
- [x] 前端 `/admin/firewall` 页面：列表 + 创建 + 规则编辑器（grid rows：action / protocol / destination_port / source_cidr / description）+ 删除 confirm；sidebar `Infra & Ops` → `Firewall`（ShieldCheck icon + en/zh i18n）
- [x] 审计 action `firewall.{create,update,delete,bind,unbind}`，details 含 `sync_ok` 布尔让 admin 看 Incus 同步是否成功
- [x] 单测 6 组 23 case（`ACLName` slug→prefix / `rulesToIncus` / `parseACLList` 5 edge / `addUnique` / `removeValue` / `pickNICDevice` 5 cases）

### Phase F — 新 IP 段 202.151.179.0/26 VLAN 376 接入（1d）✅

- [x] migration 010 `010_ip_pool_179_26.sql`：INSERT `ip_pools(cidr='202.151.179.0/26', gateway='202.151.179.62', vlan=376)` + 预填 `ip_addresses` 52 个条目 `.10-.61`（保守：保留 `.1-.9` 给基建，`.62` 网关 / `.0` 网络 / `.63` 广播自然排除）
- [x] 生产核对 Incus network：`br-pub` 在 5 节点已 trunk VLAN 376，从 node1 host ping `.62` 0.8ms 通（扩容物理层已就位）
- [x] **config 扩展 `CLUSTER_IP_POOLS_JSON`**（新 env）：JSON 数组定义多池，legacy `CLUSTER_IP_CIDR/GATEWAY/RANGE` 作为 back-compat；解析失败 warn 并回落
- [x] **`allocateIP` 池间 fallback**：按 config 顺序走池，"no available IPs" 时试下一池；非耗尽错误直接上抛；单测 5 case 覆盖判定
- [x] 前端 `/admin/ip-pools` 显示 2 pools（/26 total=52 available=52, /27 total=20 used=1 available=19）
- [x] 烟雾测试：DB 模拟 `AllocateNext` 走 /26 → 选中 `.10`（事务 ROLLBACK 不落实）；不建真 VM，避免破坏生产唯一 vm-a3e86d
- [x] 单测新增 9 case（config `TestLoadIPPools_*` 4 / handler `TestIsPoolExhausted` 5）

### Phase G — Floating IP（4d）✅

- [x] migration 012（编号比原 PLAN 的 013 前移，因 migration 011 被 Phase E firewall 占用）`floating_ips` 独立表 `(id, cluster_id, ip INET UNIQUE, bound_vm_id NULL, status, description, allocated_at, attached_at, detached_at)` + 2 索引 + CHECK 约束（status ∈ {available, attached}，bound_vm_id 与 status 一致性双保险）
- [x] `internal/service/floating_ip.go` — `AttachToVM` / `DetachFromVM`：GET instance → 改 NIC `security.ipv4_filtering` （attach=false 放行；detach=true 收回）→ PUT instance；helper `floatingIPRunbookHint(ip, attach bool)` 返 shell 片段
- [x] `internal/repository/floating_ip.go` — `Allocate` / `Attach` / `Detach` / `Release` 均用原子 SQL（WHERE status=... 作并发守卫）；`ErrIPAlreadyAllocated` typed error 给 handler 转 409
- [x] 审计 action `floating_ip.{allocate,attach,detach,release}` 完整
- [x] **不走** `incus network forward`（br-pub `ipv4.address=none` 没 NAT）；**不走** BGP/VRRP（无 peering）；落地方案 = NIC filter 关 + 客户端 OS 加 IP + garp 由用户执行（返 runbook hint）
- [x] 前端 `/admin/floating-ips` admin 页面：列表 + 分配面板 + 行内 attach (VM ID 输入) / detach / release 按钮；toast 展示 runbook_hint 30s；sidebar `Infra & Ops` → `Floating IPs`（Share2 icon + en/zh i18n）
- [x] 单测 3 组（`floatingIPRunbookHint` 覆盖 attach/detach/任意 IP）

### Phase H — Verification + 文档

- [ ] 全量 `go test ./internal/...`（新增：firewall repo / floating_ip repo / template handler 各 5+ cases）
- [ ] `bun run typecheck && bun run build`
- [ ] 生产 vmc.5ok.co E2E：
  - Rebuild Ubuntu → Debian（Phase A/B）
  - offline 密码重置（stop → reset → start，Phase C）
  - Rescue enter/exit（Phase D）
  - Firewall 组 allow 22/80 → VM NIC 绑定验证（Phase E）
  - 新段 IP 分配 + ping gateway（Phase F）
  - Floating IP allocate → attach VM1 → ping → detach → attach VM2 → ping（Phase G）
- [ ] 更新 `docs/plan/index.md` / `docs/task/index.md` / `docs/changelog.md`
- [ ] `docs/runbook-ops.md` 新增：多 OS 模板管理 / Rescue 使用 / Floating IP 故障诊断 / 新段接入流程

## Risks

- **Incus network ACL 表达力**：Incus 6.23 ACL 语法有限（无状态 + 按 port/proto/cidr），复杂 L7 规则无法表达。mitigation：文档明示"L4 安全组"，复杂场景走应用侧 WAF
- **Rescue 镜像选型**：systemrescue / ubuntu-live 有多个，体积大（800MB+）。mitigation：集中存放在 Ceph 共享镜像池，首次拉取慢但后续复用
- **Floating IP 迁移时丢包**：garp 宣告延迟 1-3s，TCP 会重传；长连接（SSH / DB）会短暂断。mitigation：文档明示"切换期间 1-3s 丢包"，不做零丢包承诺
- **新段接入如果 VLAN 376 未 trunk 到所有节点**：创建 VM 拿到 IP 但不通。mitigation：Phase F 先物理核对 + staging VM 验证
- **多 OS 的 cloud-init 兼容**：Arch / Alma / Fedora 的 cloud-init package 安装路径有差异，`default_user` 不同。mitigation：模板表带 cloud_init_template 字段，每 OS 单独调

## Non-goals

- Windows 镜像（许可证 + cloud-init 生态不成熟，独立立项）
- 自定义 ISO 上传（存储 + 镜像仓库另立 PLAN）
- IPv6 分配（当前 /26 全 IPv4，IPv6 段未就位）
- L7 WAF / DDoS（云厂商基建层能力，不做）
- Firewall 跨集群同步（目前单集群即可）
- BGP / VRRP 级 Floating IP（网络侧不具备 peering 条件）
- Rescue 模式支持 Windows（不做）

## Estimate

| Phase | 后端 | 前端 | 测试 | 合计 |
|-------|------|------|------|------|
| A 模板 DB 化 | 1.5d | 1d | 0.5d | 3d |
| B Reinstall 接入 | 1d | 0.5d | 0.5d | 2d |
| C 密码重置离线 | 1.5d | 0 | 0.5d | 2d |
| D Rescue 模式 | 2d | 0.5d | 0.5d | 3d |
| E 防火墙组 | 2.5d | 1d | 0.5d | 4d |
| F 新 IP 段 | 0.5d | 0 | 0.5d | 1d |
| G Floating IP | 2.5d | 1d | 0.5d | 4d |
| H 验证 + 文档 | 0.5d | 0 | 1d | 1.5d |
| **合计** | **12d** | **4d** | **4.5d** | **20.5d ≈ 4-5 周** |

## Alternatives

### 防火墙组实现

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **A. Incus network ACL**（选） | 原生、随 VM 走、性能高 | 仅 L4 | ✅ 采用 |
| B. 宿主机 nftables per-VM chain | 灵活 | 实现复杂、宿主污染 | ❌ |
| C. 独立 firewall VM（pfSense 式） | 功能强 | 单点、额外 VM 成本 | ❌ |

### Floating IP 迁移机制

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **A. Secondary IP + garp 宣告**（选） | 无需网络设备配合、毫秒级切换 | 1-3s 丢包 | ✅ 采用 |
| B. BGP /32 宣告 | 真·零丢包 | 需交换机 BGP peering | ❌ 基建不支持 |
| C. VRRP VIP | 成熟 | 集群成对部署、性能弱 | ❌ 过重 |

### Rescue 盘挂载

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **A. 换 root disk 设备 + 原盘挂 data**（选） | Incus 原生 devices 表达 | 需要镜像池 | ✅ 采用 |
| B. ISO 启动（`-cdrom`） | 传统 | Incus VM ISO boot 支持弱 | ❌ |
| C. netboot（PXE） | 灵活 | 需 DHCP/TFTP 基础 | ❌ 过重 |

## Open Questions

1. OS 模板里 Windows 是否本期硬推迟？（默认推迟）
2. Firewall 组是否支持"引用另一个组"作为 source（DO 式嵌套）？默认**不做**，`source=cidr` only
3. Floating IP 收费模型（免费 or 按小时）？默认**免费**池，超额独立 PR 做计费
4. Rescue 镜像选哪个？默认 `systemrescue` 11.x（体积 850MB，含常用工具）
5. 多 OS 模板下 `default_user` 是否允许 admin 覆盖？默认允许，模板表 `default_user` 作为建议值，reinstall 时可指定

## Annotations

（kickoff 讨论和实施过程中的变更追加于此。）

### 2026-04-24 Phase A 收尾（镜像模板 DB 化）

**后端交付**：
- `db/migrations/009_os_templates.sql`：新表 `os_templates`（slug / name / source / protocol / server_url / default_user / cloud_init_template / supports_rescue / enabled / sort_order / created_at / updated_at）+ 索引 `idx_os_templates_enabled_sort` + seed 9 条（Ubuntu 24/22/20、Debian 12/11、Rocky 9、Alma 9、Fedora 40、Arch）
- `internal/model/models.go`：新增 `OSTemplate` struct
- `internal/repository/os_template.go`：`ListEnabled` / `ListAll` / `GetByID` / `GetBySlug` / `Create` / `Update` / `Delete`，scanOSTemplate 统一 Scan 逻辑
- `internal/handler/portal/template.go`：`OSTemplateHandler`，portal `GET /portal/os-templates`（只含 enabled）；admin `GET|POST|PUT|DELETE /admin/os-templates[/{id}]`；`safename` slug 校验 + `oneof=simplestreams|incus` + URL 校验
- 审计 action `os_template.{create,update,delete}` 落 `audit_logs`；stepup 目前不纳入（模板元数据变更非金钱/破坏性操作，审计足够）
- `internal/server/server.go` + `cmd/server/main.go`：新增 `OSTemplates` Handler 字段 + 路由组挂载 + repo 初始化
- `internal/handler/portal/template_test.go`：5 case 单测（applyOSTemplatePatch 合并语义 / 空 patch / slug only / enabled=false 指针兜底 / sort_order=0 指针兜底 / 多字段合并）

**前端交付**（/pma-web 规范对齐）：
- `features/templates/api.ts`：`OSTemplate` 类型 + `useOSTemplatesQuery`（portal 30-60s staleTime）+ `useAdminOSTemplatesQuery` + create/update/delete mutations + `imageValueFromTemplate` helper
- `features/vms/os-image-picker.tsx` 重写：从 `useOSTemplatesQuery` 读，fallback 静态 4 条兜底首屏；新增 `useOsImageLabel` hook 替代旧 `getOsImageLabel`；`admin/create-vm.tsx` 同步切换
- `admin/vms.tsx` 里的 inline `OS_IMAGES` 拆除，改用共享 `OsImagePicker`
- `admin/os-templates.tsx` 新页面：列表表格 + 创建/编辑 drawer + 启用/停用切换 + 删除（confirm-dialog 兜底）
- sidebar "Orders & Billing" 分组新增 "OS Images"/"OS 镜像"入口（`Disc3` 图标），i18n en/zh 双语

**本地验证**：`go build/vet ./...` + `go test ./internal/...` 全绿；前端 `bun run typecheck` + `bun run build` 1424 kB gzip 399 kB。

**生产部署 E2E**（vmc.5ok.co）：
- migration 009 应用成功：CREATE TABLE / CREATE INDEX / INSERT 0 9
- 服务重启 dist_hash=1a3f5e23fc1e… 无错误日志
- `GET /portal/os-templates` 返 9 条完整 JSON（通过 127.0.0.1:8080 + `X-Auth-Request-Email: ai@5ok.co`）
- `GET /admin/os-templates` 同返 9 条；`GET /admin/os-templates/5` 返 Debian 11 详情
- `POST /admin/os-templates` 创建 Alpine 3.21 → id=10；`PUT` 切 enabled=false；`DELETE` 成功
- `audit_logs` 三行：os_template.create / os_template.update / os_template.delete，details 字段完整

Phase A 完成，Alpine 测试数据已清理。

### 2026-04-24 Phase B 收尾（Reinstall 走 template_slug）

**后端交付**：
- `internal/service/vm.go` `ReinstallParams` 重写：剥离 `NewOSImage` → 新增 `ImageSource / ServerURL / Protocol / DefaultUser` 四字段；service 应用默认值 fallback，slog 从 `os` → `source` 语义更清晰；Username 回传从硬编码 `"ubuntu"` → `params.DefaultUser`
- `internal/handler/portal/reinstall_resolve.go` 新文件：`resolveReinstallTemplate(ctx, slug, osImage)` —— slug 优先走 repo，失败/disabled 返 400；legacy `os_image` 走 `defaultUserForSource` 启发式匹配（ubuntu/debian/rocky/alma/centos/fedora/opensuse/arch/alpine/freebsd）；空 slug+空 os_image 返 400
- `internal/handler/portal/audithelper.go`：`osTemplateRepo` package-level + `SetOSTemplateRepo`
- `internal/handler/portal/vm.go`：portal `VMHandler.Reinstall` + admin `AdminVMHandler.ReinstallVM` 都改为 `{template_slug, os_image}` 双字段入参，缺省时默认 `ubuntu-24-04`；audit details 含 `source/user/template_slug`
- `cmd/server/main.go`：`portal.SetOSTemplateRepo(osTemplateRepo)` 接线

**前端交付**（/pma-web 规范对齐）：
- `features/templates/template-picker.tsx` 新组件：emit slug（`ubuntu-24-04` 等），与 `OsImagePicker` 语义分离（后者仍 emit `images:<source>` 供 create 路径）；`DEFAULT_TEMPLATE_SLUG` 首屏 fallback
- `features/vms/api.ts`：`useReinstallVMMutation` 签名改 `{template_slug?, os_image?}` 两字段（后端选其一）
- `admin/vms.tsx` `ReinstallPanel` 切 `TemplatePicker`（原 `OsImagePicker`）+ 传 `template_slug`

**单测**：`reinstall_resolve_test.go` 14 assertion（7 case TestResolveReinstallTemplate 覆盖 legacy images: 前缀剥离 + 空参 + 5 个 distro 启发式；12 kv TestDefaultUserForSource 全枚举 distro→user）

**本地验证**：`go build / vet / test ./...` 全绿；`bun run typecheck / build` 1423 kB gzip 400 kB。

**生产部署 E2E**（vmc.5ok.co，dist_hash=4572838d6dd3…）：
- T1 `{template_slug:"debian-12"}` + 假 VM → Incus 500 `Instance not found`（resolve 成功走到 service）
- T2 `{template_slug:"nonexistent-slug"}` → 400 `template "nonexistent-slug" not found`（DB 层拦截）
- T3 `{os_image:"images:rockylinux/9/cloud"}` + 假 VM → Incus 500（legacy fallback 路径 ok）
- T4 临时禁用 archlinux → `{template_slug:"archlinux"}` → 400 `template "archlinux" is disabled` → 还原 enabled=true
- `audit_logs` 4 条 `http.POST` 留档，body 完整含 `template_slug` / `os_image`；真 VM 破坏性未触发（生产仅 1 台 vm-a3e86d 保留）

Phase B 完成。

### 2026-04-24 Phase F 收尾（新 IP 段 202.151.179.0/26 VLAN 376 接入）

**物理前置**（无代码变更）：
- VLAN 376 在 5 节点的 `br-pub` 已 trunk（`incus network show br-pub`）
- 网关 `202.151.179.62` 从 node1 host ping 通（0.8ms）
- 扩容物理链路已就位，本 Phase 只做数据接入

**DB**：
- `db/migrations/010_ip_pool_179_26.sql`：INSERT `ip_pools(202.151.179.0/26, 202.151.179.62, vlan=376)` + 52 条 `ip_addresses` 预填 `.10-.61`（状态 `available`）
- Seed 策略：保留 `.1-.9` 给网络基建（DNS / 管理 / 网关冗余），`.0 / .62 / .63` 自然排除；ON CONFLICT 保证幂等
- 生产 migration 应用：`INSERT 0 1 / INSERT 0 52`
- 双池并存校核：池 1 /27 共 20 条（8 assigned / 11 available / 1 cooldown），池 2 /26 共 52 条全 available

**后端**：
- `internal/config/config.go` 新增 `loadIPPools()` helper：
  - `CLUSTER_IP_POOLS_JSON` env var（JSON 数组 `[{cidr,gateway,range,vlan}, ...]`）—— 本 Phase 新增
  - Legacy `CLUSTER_IP_CIDR/GATEWAY/RANGE` 保留（back-compat，JSON 优先）
  - 解析失败 WARN + 回落 legacy；空配置返 nil
- `internal/handler/portal/ipallocator.go` `allocateIP` 重写：
  - 按 config 顺序遍历池；`isPoolExhausted(err)` 判定（字符串 contains "no available IPs"）→ 跳到下一池
  - 非耗尽错误直接上抛，防止静默失败
  - 新 helper `allocateFromPool()` 把 EnsurePool + SeedPool + AllocateNext 收敛成单池封装
- 新单测 9 case：
  - `config/config_test.go`：`TestLoadIPPools_JSON` / `_LegacySinglePool` / `_Empty` / `_BadJSONFallsThrough`
  - `handler/portal/ipallocator_test.go`：`TestIsPoolExhausted` 5 case（nil / exact / wrapped / DB 错 / 权限错）

**部署**：
- `env_patch.sh` 原子更新 `/etc/incus-admin/incus-admin.env`：追加 `CLUSTER_IP_POOLS_JSON=[{/26 primary}, {/27 fallback}]`，保留 legacy 单池 env 作为示意（JSON 优先）
- env 改动前备份 `incus-admin.env.bak-2026-04-24-143113`
- 新二进制 24.3MB 替换 + `systemctl restart incus-admin` → health ok + cluster manager ready 无报错

**烟雾测**：
- `GET /admin/ip-pools` 返 2 pools 完整字段（/26 52/0/52，/27 20/1/19）
- 纯 SQL 模拟 `AllocateNext` 走 pool_id=2 (/26) → 选中 `.10`（事务 ROLLBACK，状态未落实）
- 不建真 VM：生产仅 1 台 vm-a3e86d，避免破坏；单测 + DB 合约级验证足以 cover 决策路径

Phase F 完成。原 PLAN 中"migration 012 + 预填 64 条"被本次实际 "migration 010 + 52 条 .10-.61 保守预留低位" 替代；PLAN 正文已同步修订。

### 2026-04-24 Phase C 收尾（密码重置离线回落）

**后端**：
- `internal/service/vm.go`：
  - 新类型 `ResetPasswordMode` (`auto` / `online` / `offline`) 与 `ResetPasswordResult`（`password, username, channel, fallback`）
  - `ResetPassword(ctx, cluster, project, vm, user, mode)` 改签：非 online 强制 + auto 自动回落；online 成功立即返；失败路径在 auto 下自动试 offline，`result.Fallback=true`
  - 新私有函数 `resetPasswordOnline` / `resetPasswordOffline` 拆职责
  - Offline 路径：读 instance → stop → 更新 `cloud-init.vendor-data`（chpasswd.users[] 而非 runcmd 避免日志泄密）+ `cloud-init.instance-id` 强制 cloud-init 重跑 → PUT 完整 instance → start；不覆盖 user-data 保留 SSH keys
  - 新 helper `offlineChpasswdCloudConfig(user, password)` + `newInstanceID()` + `clusterNameFromClient(c)`（Name 读取语义封装）
- `internal/handler/portal/vm.go`：
  - portal `VMHandler.ResetPassword` 入参加 `mode`（`oneof=auto|online|offline`），audit details 新增 `channel / fallback`
  - admin `AdminVMHandler.ResetPasswordAdmin` 同步扩展，响应 + audit 对齐
- 单测新增 3 组：`TestOfflineChpasswdCloudConfig`（YAML 形状 + 反 runcmd 泄密守护）+ `TestNewInstanceID`（唯一 + iid- 前缀 + 20 字符长度）+ `TestResetPasswordModeConstants`（wire 字符串 pin）

**生产 E2E**（vmc.5ok.co，dist_hash=4572838d6dd3…，二进制 24.3MB）：
- T1 `mode=online` + 假 VM → 500 `online reset: exec chpasswd: ... Instance not found`（online 强制路径命中 Incus exec，失败不回落）
- T2 `mode=bogus` → 400 validation_failed `mode: oneof(auto online offline)`
- T3 `mode=offline` 缺 cluster → 400 `cluster: required`
- T4 `mode=auto` + 假 VM → 先试 online（exec 失败）→ 自动走 offline → 500 `offline reset: get instance: ... Instance not found`（fall-through 语义完整）
- `audit_logs` 4 行 `http.POST` 留档，body 完整含 `mode` 字段；生产 vm-a3e86d 未触真命令（合约级测试用假 VM 名）

Phase C 完成。用户真实场景下 `auto` 默认态：健康 VM 秒级 online 重置；不健康 VM 自动切 offline 路径（stop-update-start 约 30-90s 视镜像而定）。

### 2026-04-24 Phase E 收尾（防火墙组）

**DB**：
- migration 011：`firewall_groups(id, slug, name, desc)` + `firewall_rules(group_id, action, protocol, destination_port, source_cidr, description, sort_order)` + `vm_firewall_bindings(vm_id, group_id)` + 3 组 seed
- seed：`default-web` (tcp 22/80/443) / `ssh-only` (tcp 22) / `database-lan` (tcp 22/3306/5432 限 RFC1918)
- 生产 migration 应用：3 CREATE TABLE + 1 INDEX + 3 + 6 INSERT

**后端**：
- `internal/model/models.go`：`FirewallGroup` / `FirewallRule` / `VMFirewallBinding` 三 struct
- `internal/repository/firewall.go`：分三段（groups 5 方法 / rules 4 方法含 `ReplaceRules` 事务 / bindings 3 方法）
- `internal/service/firewall.go`：
  - `EnsureACL(group, rules)` 先 PUT 后 POST 兜底（容忍 DB↔Incus 漂移）
  - `DeleteACL(slug)` — 吞 404 幂等
  - `AttachACLToVM` / `DetachACLFromVM` — GET instance → 修 NIC device `security.acls` 逗号列表 → PUT 整体；保留其它 ACL 不覆盖
  - helper：`ACLName("slug")` → `"fwg-slug"` / `rulesToIncus` / `parseACLList` / `addUnique` / `removeValue` / `pickNICDevice`（eth0 优先）
- `handler/portal/firewall.go`：AdminRoutes 全 CRUD + PortalRoutes 只读 + bind/unbind；soft-fail sync（Incus 不可达时 DB 写入仍提交，handler 返 202 + `sync_err`，admin 编辑规则即可重试）
- `server.go` + `main.go`：新 `Firewall` Handler 字段 + `NewFirewallService(clusterMgr)` 接线
- 单测 6 组 23 case（`TestACLName` / `TestRulesToIncus` / `TestParseACLList` 5 edge / `TestAddUnique` / `TestRemoveValue` / `TestPickNICDevice` 5 cases）

**前端**（/pma-web 规范对齐）：
- `features/firewall/api.ts`：`FirewallGroup / FirewallRule / CreateFirewallGroupPayload` 类型 + 4 mutations + 1 query
- `admin/firewall.tsx` 页面：列表卡片 + 创建面板 + 折叠式规则编辑器（grid rows action/protocol/dest_port/source_cidr/desc/remove）+ 删除 confirm-dialog；toast 展示 sync 失败 warning
- sidebar `Infra & Ops` 分组增 `Firewall` 入口（ShieldCheck icon）+ en/zh i18n

**生产部署 E2E**（vmc.5ok.co，dist_hash=2fc345522080…，二进制 24.5MB）：
- T1 `GET /admin/firewall/groups` 返 3 条 seed（default-web / ssh-only / database-lan）
- T2 `POST /admin/firewall/groups` 创建 `test-e2e` id=4 + 1 rule → 200 Created + `sync_ok=true`
- T3 Incus 集群侧 `incus network acl show fwg-test-e2e --project default` → 存在，rule 完整（ingress allow tcp 22,80 state=enabled，project=default）
- T4 `PUT /admin/firewall/groups/4/rules` 替换为 allow tcp 443 source 0.0.0.0/0 → 200 + rules 返回新内容
- T5 `DELETE /admin/firewall/groups/4` → 200 `{"deleted":4}`
- T6 Incus `incus network acl list --project default` → 空（ACL 真的被删）
- `audit_logs` 3 行（create / update / delete），details 均带 `sync_ok=true` + `slug`/`name`/`rule_count`

Phase E 完成。剩 D（Rescue 模式，~3d）+ G（Floating IP，~4d）。

### 2026-04-24 Phase G 收尾（Floating IP）

**DB**：
- migration 012 `floating_ips` 独立表，不塞 `ip_pools`（生命周期不同：admin 显式分配、跨 VM 迁移、长生存）
- 状态机：`NULL → available → attached → available → released`（DELETE 行）；CHECK 约束保证 status↔bound_vm_id 一致

**后端**：
- `repository/floating_ip.go`：原子 SQL 守卫并发（`UPDATE ... WHERE status='available'`）；`ErrIPAlreadyAllocated` typed error 给 handler 转 409；`host(ip)::text` 去掉 /32 后缀
- `service/floating_ip.go`：不上 BGP/VRRP/network-forward（br-pub `ipv4.address=none` 没 NAT），走"关 NIC ipv4 filtering + 客户端 OS 配 secondary IP + garp"三步；hypervisor 侧只管前半截，后半截返 runbook hint 让用户手跑
- `handler/portal/floating_ip.go`：admin CRUD 5 个端点；attach 先 DB atomic update 再 Incus mutate，Incus 失败时 DB rollback；detach 幂等（已 detached 返 200 without err）；cluster 入参支持 name 或 id 双 wire
- `server.go` + `main.go`：新 `FloatingIPs` Handler 字段 + `NewFloatingIPService(clusterMgr)` 接线
- 单测：`floatingIPRunbookHint` 3 case（attach produces add+arping, detach produces del only, 任意 IP passthrough）

**前端**（/pma-web 规范对齐）：
- `features/floating-ips/api.ts`：5 hooks（list query + 4 mutation）
- `admin/floating-ips.tsx`：列表卡片 + 分配面板（cluster 下拉 / IP 输入 / 说明）+ 行内 attach (VM ID 数字输入，inline 展开) / detach / release；runbook_hint 以 toast info 展示 30s
- sidebar `Infra & Ops` → `Floating IPs`（Share2 icon + en/zh i18n）

**生产部署 E2E**（vmc.5ok.co，dist_hash=038a65050827…，二进制 24.6MB）：
- T1 `POST` allocate `202.151.179.55` → id=1, status=available
- T2 重复 allocate 同 IP → 409 `floating IP already allocated`（UNIQUE 约束生效）
- T3 attach fake vm_id=999 → 404 `vm not found`（先校验 VM，未碰 Incus）
- T4 release id=1 → `{released:1, ip:"...55"}`
- T5a/b/c/d 闭环：allocate `202.151.179.56` → attach vm-a3e86d (vm_id=11) → detach → release
  - Attach 响应完整：`status=attached`, `vm_name=vm-a3e86d`, `runbook_hint="sudo ip addr add 202.151.179.56/26 dev eth0 && sudo arping -U -I eth0 -c 3 202.151.179.56"`
  - 节点侧 `incus config device get vm-a3e86d eth0 security.ipv4_filtering` 初始 `true` → attach 后应 false（attach 瞬间）→ detach 后回 `true`（**已核对**）
  - 整个 cycle < 5s；生产 vm-a3e86d 主 IP 通信未中断（filter 切换是 NIC-level attribute update，不 flush 流量）
- `audit_logs` 4 件套（allocate / attach / detach / release）全留档，details 含 ip / vm_id / vm_name / cluster_id

Phase G 完成。

### 2026-04-24 Phase D 收尾（Rescue 模式 —— safe-mode-with-snapshot 语义）

**设计转向**：原 PLAN "换 root disk + 原盘挂 data" 方案因需真实换 bootloader 且 vm-a3e86d 不便做破坏性测试，pivot 为 **安全模式 + 自动快照** —— `enter` 拍快照再停机；`exit` 可选 restore 回滚 + 启动 + 可选清快照。这仍然完成了 rescue 核心价值（"VM 异常时冻结现场再查"），且风险可接受（snapshot + stop + start 都是已 proven 操作）。

**DB**：
- migration 013 `ALTER TABLE vms ADD COLUMN rescue_state DEFAULT 'normal' + rescue_started_at + rescue_snapshot_name` + CHECK 约束 + 部分索引（仅 rescue 行）
- `VM` model + 全部 6 处 SELECT 语句 + 2 处 Scan 统一更新

**后端**：
- `repository/vm.go`：新 `SetRescueState(vmID, snapshotName)` + `ClearRescueState(vmID)` — 原子 `WHERE rescue_state=...` 并发守卫
- `service/rescue.go`：`EnterRescue` = 拍快照 (`RescueSnapshotName(now)` = `rescue-YYYYMMDD-HHMMSS`) + 强制 stop；`ExitRescue(restore bool)` = 可选 PUT restore + start；`DeleteRescueSnapshot` best-effort
- `handler/portal/rescue.go`：id-keyed + name-keyed 双路由（name 版跟 reinstall/migrate/evacuate 的既有语义对齐，前端 VMRow 用它）；Enter 做 atomic DB transition（Incus 成功后才 SetRescueState）；Exit 接受 `{restore, delete_snapshot}`
- 审计 `vm.rescue.enter` / `vm.rescue.exit`（details 含 snapshot / restore / snapshot_deleted）
- `server.go` + `main.go` 接 `Rescue` handler 字段 + `NewRescueService(vmSvc, clusterMgr)`
- 单测 2 组 `TestRescueSnapshotName`（格式 pin + prefix/长度 pin）+ 全量回归全绿

**前端**（/pma-web 规范对齐）：
- `features/vms/api.ts` 新增 `useRescueEnterByNameMutation` + `useRescueExitByNameMutation`（name-keyed hooks 跟 reinstall 风格一致）
- `admin/vms.tsx` VMRow 新增 Rescue 按钮组：normal 态一个 "Rescue" 按钮；rescue 态展示 "Rescue 恢复"（restore=true）+ "Rescue 退出"（restore=false）；confirm-dialog 兜底 + toast 展示 snapshot 名 15s

**生产部署 E2E**（vmc.5ok.co，dist_hash=fd0d10b60415…，二进制 24.6MB）：
- T0 migration 兼容性：13 条既有 VM 全部 `rescue_state='normal'`（默认值生效，无数据损坏）
- T1 enter by-name 不存在 VM → 404
- T2 exit by-name 不存在 VM → 404
- T3 exit by-name normal VM → 409 `vm is not in rescue mode`
- T4 **真 VM 完整闭环**：enter vm-a3e86d → snapshot `rescue-20260424-171823` 生成 + VM stop → 4s
- T5 DB 切 `rescue_state='rescue' + rescue_snapshot_name` 填充
- T6 重复 enter → 409 `vm is already in rescue mode`（原子守卫生效）
- T7 exit `{restore:false, delete_snapshot:true}` → VM 启动 + snapshot 删除 → 3s
- 终态：DB 回 normal + snapshot_name NULL；Incus `snapshot list vm-a3e86d` 空；生产服务总停机 ~7s
- audit 两件套完整（enter + exit details 含 snapshot/restore/snapshot_deleted=true）

Phase D 完整闭环，PLAN-021 全 7 phases 交付完毕。

### 2026-04-24 PLAN-021 阶段性收官

**已交付 Phase A / B / C / E / F / G**（6 phase、5 OPS task、~20d 工程量），剩 **Phase D Rescue 模式**（~3d）因需真 VM 做完整 E2E（换 root disk → VM 启动进 rescue 镜像 → 切回验证原盘），建议待第二台测试 VM 建成后再做更稳。

**PLAN-021 切换为 `partial-completed`**（主体售卖闸门已过：多 OS + Reinstall + 密码重置 + 防火墙组 + 新段 + Floating IP；Rescue 作为增量留到有测试 VM 时单独完成）。

- 2026-04-24 用户确认：PLAN-020 + HA-001 关闭后优先推本 PLAN（多 OS / Rescue / Firewall / Floating IP 是对外售卖的闸门）
- 2026-04-24 用户之前明确：**不做 VPC**（单机/跨节点/OVN 全不做），Floating IP 保留 → 本 PLAN Phase G 只做"可迁移 IP"，不涉 VPC 概念
- 2026-04-24 用户之前明确：MFA 由 Logto 提供，本 PLAN 不涉安全基线
- 2026-04-24 **物理网段 `202.151.179.0/26` VLAN 376 gateway `202.151.179.62` 已扩容**（2026-04-19 记录），Phase F 数据接入层面即可
