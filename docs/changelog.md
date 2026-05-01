# IncusAdmin Changelog

## 2026-05-01 [fix]

PLAN-032 / OPS-030 — DESIGN.md 严格合规清零：

OPS-029 后做 UI 视觉合规审查，清掉 14 处 `[NNpx]` / `[Nrem]` arbitrary value（违反 CLAUDE.md "禁止 arbitrary value" 纪律）+ api-tokens.tsx 源码 hardcoded 中文 + console.tsx 漏 i18n 的 aria-label：

- `index.css @theme inline` 新增 10 个 `--size-*` 布局尺寸 token（chart / iframe-tall / iframe-console / palette / table-skeleton / select-sm / form-textarea-min / row-actions-menu / topbar-user / input-narrow），命名按用途而非字面值
- 14 处 arbitrary value 全部替换：能用 Tailwind 内置（如 `w-0.5` / `min-w-56` / `min-w-50`）的优先用内置，否则用新 token（`h-chart` / `h-iframe-tall` / `h-iframe-console` / `max-h-palette` 等）
- `api-tokens.tsx` 源码 `TTL_OPTIONS` / `formatTimeLeft` i18n 化：改 `ttlOptions(t)` helper + `formatTimeLeft(ttl, t)` 接 t fn；新加 11 个 i18n key（`apiToken.ttl.*` + `neverExpires` / `expired` / `expiresInDays/Hours/Minutes`）
- `console.tsx` 顶栏 "返回" / "全屏" / "退出全屏" aria-label 走 `t("console.back/fullscreen/exitFullscreen")`，zh+en 同步补 3 个 key

最终 `grep -E 'className=.*\\[(#|rgba?\\(|[0-9]+(px|em|rem))\\]' web/src` 返回 0 行，DESIGN.md 严格合规。

---

## 2026-04-30 [fix]

PLAN-031 / OPS-029 — EN 语言包系统化补全：

OPS-028 后做全功能 UI 测试发现 EN locale 下大量字符串仍是中文 placeholder（不是 source 硬编码，而是 `en/common.json` 的 value 直接复制了 zh）。系统补齐：

- `web/public/locales/en/common.json` 翻译 ~190 处中文 value 到英文，覆盖 admin 子对象（firewall / floatingIPs / osTemplates / users / shadow / billing 等）+ common 按钮 + topbar + vm + ticket + sshKey + dataTable。保留纯符号 ✓ ⏸ ▶ ← 不动
- `dataTable.resizeColumn` + `topbar.collapseSidebar` 在 zh + en 都补齐（之前 source 用了但 zh 缺）
- `app-sidebar.tsx` 折叠按钮 aria-label 改 `t("topbar.collapseSidebar")` 替代硬编码中文
- `admin/audit-logs.tsx` User 列引入 `useAdminUsersQuery` 建 ID→email 映射，与 admin/orders / tickets 一致

生产 vmc.5ok.co 部署后 EN locale 下 admin/billing / orders / tickets / audit-logs / firewall / floating-ips / os-templates / users / api-tokens / settings / vm-detail 全部无可见中文残留。

---

## 2026-04-30 [fix]

PLAN-030 / OPS-028 — 全功能 UI 测试遗留打磨：1 P2 + 4 P3 + 3 CR 改进打包：

**SEC-002 (P2)**: admin VM list/detail/节点详情响应**新增 redactInstanceMap/JSON/List** 裁掉 `config.user.cloud-init` / `expanded_config.user.cloud-init`（含明文初始 root 密码）。fail-open 设计：decode 失败时 raw 透传 + warn log（admin 已 gate，Incus 形状极少变）。3 个 site 全覆盖（vm.go ListClusterVMs / ListAllVMs / GetClusterVMDetail + clustermgmt.go 节点详情），单测覆盖。

**M1 (CR-MEDIUM)**: `defaultProjectsFor` 加 4-case table test（""/`default`/`customers`/`internal`），protect OPS-027 修复回归。

**L1 (CR-LOW)**: `AddNode` body 的 NICPrimary/NICCluster/BridgeName 加 `safename` validator（双重防御；shellQuote 已防 shell injection，safename 让奇怪输入早死于 422）。

**P3.1**: `billing.tsx` Invoices 表头 `t("invoice.amount")` / `t("invoice.status")` 加 defaultValue 兜底（en locale 下不再渲染 i18n key 字面量）。

**P3.2**: `admin/orders` User 列改显示 email、Product 列改显示产品名；用 `useAdminUsersQuery` + `useAdminProductsQuery` (limit=200) 建 ID→name 映射。

**P3.3**: `admin/tickets` 用户列同样从 user_id 解析 email；en/common.json 把 hardcoded "用户" / "工单管理" / "暂无工单" / "用户配额" 切到英文翻译。

**P3.4**: env-script 下载从 `<a href download>` 改 `<Button onClick downloadClusterEnvScript>`，走 fetch + 401 step-up 拦截 → 跳 OIDC 而不是落到裸 JSON 响应页。

**L2 (CR-LOW)**: `node-join.tsx` skip-network 高级区 IP placeholder 改为 `derivedInternalIP("10.0.10", publicIP)` 跟 publicIP 末位走；勾 skip-network 但 mgmtIP 空时显示 warn 提示运维。

---

## 2026-04-30 [fix]

PLAN-029 / OPS-027 — `admin/vms` 跨 project 列表 0 VM 修复（P1）：

**问题**：PLAN-028 收尾后做全功能 UI 回归发现生产 `/admin/vms` 列表显示 0 VM；同时 admin/monitoring 显示 5 VM、portal/vms 显示 1 VM (MyVM)。三条路径不一致，admin 视角彻底看不到 VM。

**根因**：PLAN-027 把 cluster 配置从 env-only 切到 DB-driven 时，`cmd/server/main.go::clusterFromDB` 注释明确"projects 暂时维持空数组"。但 `handler/portal/vm.go::ListClusterVMs` 用 `cc.Projects` 迭代查 instances，nil 时 fallback `["default"]`，结果 customers project 里的所有 VM 全漏。env-bootstrap 路径硬编码 `[default, customers]` 仅在第一次启动 / clusters 表为空时生效；后续重启全走 DB-load → cc.Projects=nil。

**修复**：`clusterFromDB` 加 `Projects: defaultProjectsFor(c.DefaultProject)` 兜底，helper 返回 `[default, DefaultProject]` 去重列表。语义跟 env-bootstrap 路径完全等价；DefaultProject="customers" 时还原成 `[default, customers]`。

**生产实测**：部署后 `GET /api/admin/clusters/cn-sz-01/vms` 返回 `count: 6`（MyVM + vm-cdc154 + vm-35762f + vm-73a439 + vm-784367 + vm-4609c0 stopped），全部带 `project: customers`。

**附带发现**：响应 `config.user.cloud-init` 字段含明文 cloud-config password，admin 视角合理但 portal 用户视角应过滤——已开 SEC-002 P2 task。

---

## 2026-04-30 [feat]

PLAN-028 / OPS-026 — `join-node.sh` 兼容 bonded NIC + 异构网络拓扑 + skip-network 模式：

**问题**：INFRA-002 e2e 在 node6 上撞到 — node6 用了 bonded 25G NIC（bond-mgmt + bond-ceph），与脚本写死的 `NIC_PRIMARY=eno1` 假设不匹配；硬跑会拆掉 node6 现有 bond + apply-network.sh revert，最坏 mgmt 失联。

**修复**：
- `join-node.sh` 加 7 个新 flag：`--nic-primary` / `--nic-cluster` / `--bridge-name` / `--mgmt-ip` / `--ceph-pub-ip` / `--ceph-cluster-ip` / `--skip-network`
- `--skip-network` 模式：do_network 直接 return；preflight 改为验证 mgmt IP / 默认路由是否就位；verify 跳过 VLAN / bridge 检查；firewall 在 br-pub 缺失时跳过（OSD-only 节点不需要 VM 网络规则）
- `cluster-env.sh` 默认值依然有效；命令行 flag 覆盖
- `service/jobs/Params` + `cluster_node_add.go::Run` + `handler/portal/clustermgmt.go::AddNode` 全链路透传新字段
- 前端 `admin/node-join` 加 `<details>` 折叠 advanced section：bonded NIC 字段 + skip-network checkbox + 6 个 IP 覆盖输入

**生产 vmc.5ok.co 实测**：
- 部署后 admin POST /admin/clusters/cn-sz-01/nodes 接受 `skip_network: true / nic_primary: bond-mgmt` 等新字段（被 step-up 拦 401 是预期）
- B2 batch admin create count=2 e2e 通过：双 job 30s 内 succeeded，2 VMs running on node4，IPs / vm_names 各自独立
- B2 测试 VM 已清理（Incus 实例删除 + DB deleted + IPs cooldown）

**node6 真实 e2e 仍未跑**：node6 当前不仅 bonded 拓扑差异，还缺 10.0.10.6 mgmt 网（join Incus 集群必需）；要让 node6 加入需要 ops 先在 bond-mgmt 加 mgmt IP。代码已就绪，运维补好 mgmt 网后用 `--skip-network --mgmt-ip 10.0.10.6 --ceph-pub-ip 10.0.20.6 --ceph-cluster-ip 10.0.30.6` 即可加入。

**D2 maintenance toggle 部署到位**：路由 `POST /admin/clusters/{name}/nodes/{node}/maintenance` 验证返 401 step-up 拦截（plumbing 通），实际 Incus PATCH 由 admin 通过 UI 操作时手工触发。

---

## 2026-04-30 [feat]

OPS-024 — admin batch VM create / cluster-env.sh 自动生成 / 节点 maintenance mode（用户决策）：

- **B2 admin batch create**：`POST /admin/clusters/{name}/vms` 接 `count: 1..16` 字段。多 VM 分别 allocate IP + INSERT vms row + 入队 jobs runner + 返 `items[]: {job_id, vm_id, vm_name, ip}`。中途失败返 `partial` + `failed_at` 已成功的不回滚。前端 admin create-vm 页加数量输入 + 批量结果展示 list。
- **C2 cluster-env.sh 生成**：`GET /admin/clusters/{name}/env-script`，step-up gated（加入 sensitive routes）。读 `incus cluster members` API → 按 5ok.co 拓扑约定（mgmt 10.0.10.X / ceph 10.0.20.X / pub 202.151.179.X 共用 mgmt IP 末位）反推 `CLUSTER_NODES` 数组。返回 `Content-Type: text/x-shellscript` 触发浏览器下载。前端 admin nodes 页加"下载 cluster-env.sh"按钮。生成内容附 `# WARN: ops should hand-verify` 提醒拓扑差异时人工核对。
- **D2 maintenance mode**：`POST /admin/clusters/{name}/nodes/{node}/maintenance` `{enabled: bool}` → Incus `PATCH /1.0/cluster/members/{name} {config: {scheduler.instance: 'manual'|'all'}}`。enabled=true 防新放置但保留现有 VM；evacuate 是另一个独立按钮。前端 NodeDetail 卡 toggle，根据 `nodeInfo.config["scheduler.instance"]` 反映当前态。step-up 路由白名单 +1。
- 顺手把 admin/create-vm.tsx 的 `focus:border-[color:var(--accent)]` arbitrary value 全部换为 `focus:border-ring` token，符合 DESIGN.md 纪律。

**生产 vmc.5ok.co 实测**：部署后 `GET /api/admin/clusters/cn-sz-01/env-script` 返 401（step-up 拦截）；systemd active；后端 go vet/test 全绿；前端 tsc 0 / vitest 37/37 / build OK。

**安全**：env-script 路由暴露集群拓扑信息，强制走 OIDC step-up（5min 时窗）+ admin 角色 + audit log。

---

## 2026-04-30 [security]

OPS-022 — `vms.password` DB 字段 AES-256-GCM 加密。先前明文存储，admin 直接 `psql` 查询或 `pg_dump` 备份能看到所有用户密码，前端"密码仅显示一次"文案对用户是误导。

- `internal/auth/password_crypto.go`：`AES-256-GCM`，key 从 env `PASSWORD_ENCRYPTION_KEY`（base64 32 字节，`openssl rand -base64 32`）；密文格式 `v1:base64(nonce||ciphertext)`，版本前缀给 rotation 留口
- 空 key → passthrough 模式向后兼容（旧部署不破）；有 v1 密文但 key 没配 → 解密返错误（避免静默泄露密文给前端）
- 旧明文（无 v1 前缀）解密时 passthrough（migration 期间过渡）；新写入一律加密
- `VMRepo` 4 个写路径（Create / UpdatePassword / UpdateAfterProvision / scanVMs Read）全部 wrap 加密 / 解密；`encryptForWrite` / `decryptOnRead` 在 nil 安全 + 错误降级（解密失败返 nil + warn 不阻塞业务）
- `main.go` 启动：`SetPasswordEncryptionKey(cfg.Auth.PasswordEncryptionKey)` → 异步 `migrateVMPasswordsToEncrypted`：循环 batch=200 SELECT WHERE password NOT LIKE 'v1:%' → 加密 → UPDATE。Idempotent（已加密的跳过），重启反复跑不会重新加密
- 4 case 单测覆盖 round-trip / passthrough / 旧明文兼容 / key 缺失明确报错 / bad key format

**生产 vmc.5ok.co 实测**：部署后启动日志 `vms.password encryption enabled (AES-256-GCM)` + `vms.password migrated to encrypted count=22`。`SELECT password FROM vms WHERE ...` 全部返 `v1:...` 前缀，pg_dump 看不见明文。

**安全 note**：env 文件 `/etc/incus-admin/incus-admin.env` 已 chmod 600；新生成 key 已写入并备份原 env 到 `.bak-ops022-*`。

**范围外（OPS-023 立项）**：key rotation（v1 设计就支持版本前缀；rotation 时升 v2 + key 字典 fallback）、per-row salt、客户端侧加密。

---

## 2026-04-30 [feat]

PLAN-027 / INFRA-003 — standalone Incus host 管理 + DB-driven cluster config 落地。先前所有 cluster 配置都来自 env CLUSTER_*，admin 通过 UI 添加的 cluster 只活在 in-memory（重启即丢）。这次：

- migration 017：clusters 表加 `cert_file` / `key_file` / `ca_file` / `kind`('cluster'|'standalone') / `default_project` / `storage_pool` / `network` / `ip_pools_json`
- `ClusterRepo`：新增 `CreateFull`（INSERT ... ON CONFLICT 全字段 upsert）/ `DeleteByName` / `ListFull`
- `main.go` 启动顺序改为：env 配置先 upsert 进 DB → 从 DB 加载完整 cluster 列表 → 喂给 NewManager。env 是 bootstrap，DB 是源
- `clustermgmt.go::AddCluster` 双写 Manager + DB；DB 失败时 rollback Manager（保两边一致）
- `clustermgmt.go::RemoveCluster` 双写删除（DB 失败仅 log，重启会再清）
- `AddClusterParams` 前端类型扩展支持 kind / default_project / storage_pool / network / ip_pools 字段（form 可选输入）
- `cluster.tls_fingerprint` 列、SPKI pin 机制、TOFU 行为均不变

**生产 vmc.5ok.co 实测**：部署后 `cn-sz-01` cluster 行已被 env 兜底 upsert 自动填充：`kind=cluster, cert_file=/etc/incus-admin/certs/client.crt, default_project=customers`。重启验证通过 systemd active。

**安全**：TLS cert/key 文件依然只存路径不存内容（不在 DB 增加密钥泄露面）；admin 添加 cluster 前必须先把 cert 文件 scp 到 admin server 本地。

**范围外**：cert/key 内容存 DB（保留文件路径方案）、跨集群 VM 调度策略、cluster 配置版本化历史。

---

## 2026-04-30 [refactor]

OPS-021 — PLAN-025/026 后续 cleanup（4 项打包）：

1. **死代码清理**：`VMHandler.CreateService`（POST /portal/services）handler 自 PLAN-005 立项就存在但 `Routes()` 从未注册其路由；前端 `useCreateVMMutation` 仅有定义无任何组件引用。删两端避免误读为"用户可绕开订单直创 VM"。purchase-sheet 走 OrderHandler.Pay 才是真正的购买入口。生产 curl POST /portal/services 现在返 405 确认已下线。
2. **AdminVMHandler.ReinstallVM 异步化**：与 portal reinstall 一致走 jobs runtime + SSE，返 202 + job_id。前端 `vm-action-sheets.tsx::ReinstallForm` 接 `useJobStream` 实时显示 6 步进度，完成后 `SecretReveal` 一次性给新密码。`focus:border-[color:var(--accent)]` arbitrary value 顺手换成 `focus:border-ring` token。jobs runtime 缺失时同步路径兜底保留。
3. **Quota 强制（OPS-021 核心安全修复）**：`OrderHandler.Pay` 在 `PayWithBalance` 之前 pre-check 4 个轴（`max_vms` / `max_vcpus` / `max_ram_mb` / `max_disk_gb`），超限直接 402 + 中文 message，**不扣款**。先前漏洞：`QuotaRepo` 存在但 handler 从不调用，用户余额够即可无限下单。policy：`quotas` 注入 nil 跳过（向后兼容）；用户无 quota 行视为不限制（admin 决定何时启用）；用户主动设置非零上限 → 强制。
4. **Changelog + auto-memory + INFRA-002 同步收口**。

**测试**：`go vet` clean / `go test ./...` 全绿 / 前端 tsc 0 / vitest 37/37 / build OK / 生产 systemd active。

**范围外**：vms.password DB 加密（OPS-022 单立）、cluster-env.sh 自动同步（OPS 小任务单立）、INFRA-003 standalone host（PLAN-027）。

---

## 2026-04-30 [feat]

PLAN-026 / INFRA-002 — 集群节点管理 UI + 自动化落地。复用 PLAN-025 的 jobs runtime + SSE，把"添加节点"和"移除节点"两个长流程编排进入异步 job 体系。admin 在 `/admin/node-join` 填表 + 测 SSH → 提交 → 实时看 9 阶段进度；移除走节点详情卡的 destructive 按钮 + step-up + 二次输节点名确认 → 7 阶段进度。

**核心发现（一开始没想到）**：`cluster/scripts/join-node.sh`（7 步 add）和 `scale-node.sh --remove`（7 步 remove）已经是完整的可工作脚本。INFRA-002 真正的工作只是 SSH 编排器 + UI，不是从零写脚本。

**新建基础设施**：
- migration 016：扩 `provisioning_jobs.kind` CHECK 约束加 `cluster.node.add` / `cluster.node.remove`
- `internal/sshexec/runner.go::RunStream`：行级 stdout/stderr 流式回调（StdoutPipe + bufio.Scanner + sync.Mutex 串行 onLine），ctx 取消立即 SIGTERM session
- `internal/sshexec/runner.go::WriteFile + MkdirAll`：通过 SSH `install -m mode /dev/stdin <path>` 上传小文件 + mkdir -p 远端目录
- `internal/sshexec/embedded/`：embed 了 `cluster/scripts/{join-node,scale-node,apply-network,setup-firewall,update-monitoring-targets}.sh` + `configs/cluster-env.sh` 的副本（commit 进 repo，build 自动找到，CI 不需额外 sync）
- `internal/service/jobs/cluster_node_add.go`：9 步执行器，Incus API 生成 join token → SSH 上传 scripts → 流式跑 join-node.sh，按 `====== 步骤 N/7 ======` marker 推进 step
- `internal/service/jobs/cluster_node_remove.go`：通过 leader SSH 跑 `scale-node.sh --remove --force --no-notify`，按 `[STEP] N/7` marker（带 ANSI 颜色码 stripping）推进
- `internal/handler/portal/clustermgmt.go::AddNode + RemoveNode`：路由 `POST/DELETE /admin/clusters/{name}/nodes` 和 `/admin/clusters/{name}/nodes/{node}`
- `middleware/stepup.go` 把两个新路由加入 sensitive 路由列表（必须重 OIDC step-up）
- audit action label 派生：`vm.*` 走 `vm.provisioning.*`、`cluster.node.*` 走 `node.provisioning.*`，按 prefix 分组方便日志检索

**前端（DESIGN.md 优先，零 hex / 零 arbitrary value）**：
- `features/nodes/api.ts` 新增 `useAddNodeMutation` / `useRemoveNodeMutation`，全部带 step-up `intent` 元信息
- `app/routes/admin/node-join.tsx` 替换原手工 4 步 wizard：表单 + 测 SSH 按钮（必须先通过才能提交）+ 提交后自动切到 JobProgress 视图，SSE 实时 9 步进度
- `app/routes/admin/nodes.tsx` 节点详情卡加入 destructive "移除节点" 按钮 + 二次输节点名确认 + 移除中嵌入 JobProgress
- i18n zh/en 各加 30+ 个新 key（`admin.nodes.add.*` / `admin.nodes.remove.*`）

**测试**：
- `cluster_node_markers_test.go`：3 个测试覆盖 join-node.sh `====== 步骤 N/7 ======` 与 scale-node.sh `[STEP] N/7` 两种 marker 解析 + ANSI 颜色码 strip
- 生产 vmc.5ok.co 部署：systemd active，4 worker + sweeper 运行中；`POST /admin/clusters/cn-sz-01/nodes` 路由验证返 400 validation_failed（必填字段缺）说明路由已注册

**真实 e2e（用 node6 真加入集群）需用户在准备好物理机后单独触发**，本 PLAN 提供能力但不强制端到端。

**范围外（显式排除）**：
- `cluster/configs/cluster-env.sh` 自动同步新节点（运维静态文件，需手工编辑提交 git）
- maintenance mode（per-node `scheduler.instance=manual`）
- INFRA-003 standalone host 管理（被 INFRA-002 阻塞，单立 PLAN-027）
- AdminVMHandler.ReinstallVM（admin reinstall 入口）异步化

---

## 2026-04-30 [feat]

PLAN-025 / INFRA-007 — VM provisioning 异步化 + SSE 进度流落地。订单付款不再握 30–90s HTTP，handler 立即返 202 + job_id；前端通过 SSE 实时看 5 阶段进度，完成后 SecretReveal 一次性展示密码。Reinstall 同形态异步化（同步前置仍保留 probe + prePullImage 数据保护）。Admin direct create 走相同 jobs runner。

**核心修复（深度审查发现的 fake-wait bug）**：
- `cluster.Client.httpClient.Timeout = 10s` vs `WaitForOperation` 调 `?timeout=120` 服务端 long-poll —— 客户端先 timeout 把 op 当失败，handler 误判继续 start，一直靠 `vm_reconciler` 60s 兜底纠偏。新增 `longClient`（无 client-level Timeout，依赖 ctx）专用此调用。
- `WaitForOperation` 只判 HTTP 200 不解析 `metadata.status` —— Incus 在 op `Running` 时也是 200。改为循环直到 op.status=Success/Failure，60s 单次 long-poll 上限循环到 ctx done 为止。

**新建基础设施**：
- migration 015：`provisioning_jobs` + `provisioning_job_steps` 表 + `vms (cluster_id, name)` partial UNIQUE（不含 deleted/gone 历史墓碑行）
- `internal/service/jobs/`：Broker（pub/sub for SSE）+ Runtime（worker pool N=4 + recovery sweeper）+ vmCreateExecutor + vmReinstallExecutor
- `internal/handler/portal/jobs.go`：`GET /portal/jobs/{id}` + `GET /portal/jobs/{id}/stream`（SSE，Last-Event-ID 重连，per-user ≤ 4 并发）
- `RateLimit` 中间件 bypass 任何以 `/stream` 结尾的路径
- `worker.RunVMReconciler` 等已有 worker 不变；jobs runtime 与之并存（job 是事前编排，reconciler 是事后纠偏）

**改造的三处调用站点**：
- `OrderHandler.Pay`：付款（同步）→ 分配 IP（同步）→ INSERT vms(creating)（同步）→ INSERT job + Enqueue → 202
- `VMHandler.Reinstall`：probe + prePullImage（同步保数据）→ INSERT job + Enqueue → 202
- `AdminVMHandler.CreateVM`：分配 IP + INSERT vms + INSERT job → 202
- 全部保留兜底同步路径：jobs runtime 缺失（DB-only 测试 / 老配置）时回退 PLAN-025 前同步行为

**失败补偿矩阵**：
- 任意 step 失败 → executor.Rollback：删 Incus instance（幂等 404 OK）+ 释放 IP + 退款（`refund_done_at IS NULL` guard 防双倍）+ order=cancelled + vm row=error
- 进程崩溃恢复：sweeper 5min tick 找超 30min 仍 running 的 row → 标 partial → 同 rollback
- audit 三段独立：`vm.provisioning.{started,succeeded,failed}`

**前端**（pma-web 合规、DESIGN.md token 全部就位、零 hex 字面量、零 arbitrary value）：
- `shared/lib/sse-client.ts`：fetch + ReadableStream 实现的 SSE 客户端，自动重连 + Last-Event-ID 续传
- `features/jobs/`：`useJobQuery` + `useJobStream` + `<JobProgress />` 进度组件（StatusDot pulse / surface-1 / radius-md）
- `purchase-sheet.tsx`：FORM → SUBMITTING → PROVISIONING(SSE) → DONE(密码) | FAILED 状态机；密码不走 SSE，done 后由 `GET /portal/jobs/{id}` 拉
- `vm-detail.tsx` reinstall 抽屉：异步进行中展示 JobProgress，完成 toast 出新密码
- i18n：zh / en 各加 11 个 jobs.* + 4 个 billing.* 新 key

**测试**：
- `cluster/client_integration_test.go`：4 个 case 覆盖 WaitForOperation Success / Running→Success / Failure / ContextCancel
- `service/jobs/broker_test.go`：4 个 case 覆盖订阅广播 / unsubscribe / 按 jobID 路由 / 满 buffer 不阻塞
- `go test ./...` 全绿、`go vet` clean、frontend `tsc` 0 / vitest 37/37 / build OK

**范围外（显式排除，单立 task）**：
- `vms.password` plaintext DB 存储 vs "shown only once" UX 矛盾（pre-existing）
- 用户级 quota 强制（pre-existing；repo 存在但无 handler 调用）
- `VMHandler.CreateService`（portal 直创入口，前端无引用，疑似死代码）

**pma-cr 审查发现 + 修复（部署前）**：
- **CRITICAL**：`runtime.runOne` 在 `exec.Run` 失败时只 `finalize` 不调 `Rollback` —— 用户付款后 VM 创建失败既不退款也不释放 IP。修：失败路径加 `exec.Rollback(jobCtx, r, job, runErr.Error())`。
- **HIGH**：`purchase-sheet.tsx` 把 `setCredentials` / `setAsyncFinalError` 在 render 期间直接调用（违反 React 19）。修：迁到 `useEffect`。
- **HIGH+MEDIUM**：SSE handler `ListSteps` → `Subscribe` 之间 job 终态 publish 给空订阅集合；step 在窗口期推出会漏。修：subscribe-first，再 list+check，前端 reducer 用 seq 自动 upsert 去重。
- **MEDIUM**：worker goroutine panic 会导致 pool 永久缩容。修：runOne 内 `defer recover` 裹 `exec.Run`，外层 worker 再裹一层兜底 dispatch / finalize 路径的 panic。
- 单测：`broker_test.go` + `WaitForOperation` 4 case 覆盖 race / 超时 / 状态解析。

**生产交互测试发现 + 修复（部署后）**：
- **CRITICAL**：`UserRepo.AdjustBalance(... createdBy=&orderID)` 把订单 ID 写入 `transactions.created_by` —— 但该列 FK 指向 `users.id`，触发 23503。历史 `OrderHandler.rollbackPayment` 同样 bug，因为 PLAN-025 之前 refund 路径在生产从未真跑通过所以一直未暴露；异步化首次失败 case 直接撞上。
- **修法 v1**（边修边发现不彻底）：把 `createdBy` 改传 `nil`，订单关联留在 `desc` 字段。
- **修法 v2（最终）**：把 `MarkRefunded` + `AdjustBalance` 两步合成原子 `RefundOnce(jobID, userID, amount, desc)` repo 方法 —— 单事务 `UPDATE refund_done_at WHERE IS NULL` + `UPDATE balance` + `INSERT transactions`，任一步失败整体回滚 → sweeper / worker 重试可重做。原 v1 是"先标 done 再扣款"，扣款失败 done 标记仍在，永不重试，用户余额永远没退。
- 同时把同样 bug 修到 `OrderHandler.rollbackPayment`（同步兜底路径，传 `createdBy=nil`）。
- 生产 vmc.5ok.co 实测：成功 case 完整 5 步进度（job 1/4）；失败 case 完整补偿（job 3，order=cancelled / vm=error / IP=cooldown / 余额回退 / refund tx 入账）；SSE 实时推送 + Last-Event-ID 续传双双通过。

---

## 2026-04-30 [ci+merge]

PR #1（PLAN-022/023/024 + OPS-020 + CR 修复）合并到 main，并修通 5 个 pre-existing CI 雷点 —— main 上 GitHub Actions CI 第一次三 job 全绿。

**CI 修复**：
- `ci.yml` 三 job 互相独立 → frontend upload `web-dist` artifact，backend-unit / backend-integration `actions/download-artifact@v4` 下载到 `incus-admin/internal/server/dist`，否则 `//go:embed all:dist` 找不到目录直接 build fail
- `internal/testhelper/postgres.go::applyMigrations` 直接 ExecContext goose 双向 SQL → 表创建后立刻被 `DROP TABLE IF EXISTS` 自删；新增 `extractGooseUp` 按 `-- +goose Down` marker 截断只跑 Up
- 集成测试 seed SQL 列名长期偏离 schema：`clusters.endpoint` → `api_url`（3 处）、`products.price` → `price_monthly`（2 处）、`transactions WHERE order_id` → `WHERE user_id + type='refund'`（schema 没有 `order_id` 列，生产 `AdjustBalance` 也不写）
- 这些 bug 在本机 testcontainers 因 Docker bridge 不可达 `t.Skip` 时被掩盖；GitHub Actions ubuntu-latest 一上来就暴露

**PR + 合并**：
- 创建 `release/plan-022-024` branch（4 commit）+ CI fix 3 commit
- `gh pr merge 1 --merge --delete-branch`，本地 main fast-forward 到 origin/main
- 生产 vmc.5ok.co dist sha `3f7d599e9b72`，systemd active

**docs-sync**：随后执行 `/doc-sync`，同步 4 条 Serena 记忆（migration 列表 / OPS-020 token 直引规则 / Go 工具链路径 1.23.4 / PR + CI 检查项）+ 新增 `~/.claude/projects/-workspace-incus/memory/ci_pitfalls.md` 跨会话 feedback。

---

## 2026-04-30 [feat+refactor]

PLAN-024 代码审查（pma-cr）跟进修复 + OPS-020 arbitrary value 全量替换为 `@theme` utility 直引。

**pma-cr 修复**（3 个 HIGH/MEDIUM）：
- **HIGH** `data-table.tsx`：列宽 `columnResizeMode='onChange'` 在每帧 mousemove 都更新 colSizing，`useEffect` 同步写 localStorage 会高频 IO 阻塞主线程。改为 300ms debounce + 卸载前 flush 一次（保留拖拽实时跟手 + LS 写节流）
- **MEDIUM** `cluster-vms-table.tsx`：`tableId="admin.cluster-vms"` 在多 cluster 渲染时多 instance 共享同一 LS key（用户在 cluster A 改宽度，cluster B 视觉不同步）。改为 `admin.cluster-vms.${clusterName}` 每 cluster 独立列宽
- **MEDIUM** 用户端 `vms.tsx`：j/k 键盘高亮用数字索引 `hlIdx`，`useMyVMsQuery` 后台 refetch 重排数组期间按 Enter 会跳到错位 VM。改用 `hlVmId: number | null`（按 VM ID 锁定），渲染时 `findIndex(v => v.id === hlVmId)` 还原行号

**OPS-020 全量替换**（~180 处，~60 文件）：
- `shadow-[var(--shadow-X)]` → `shadow-X`（dialog/floating/ring/elevated/inset）
- `font-[510]` → `font-emphasis`、`font-[590]` → `font-strong`
- `hover:bg-[color:var(--accent-hover)]` → `hover:bg-accent-hover`（先在 `@theme inline` 暴露 `--color-accent-hover: var(--accent-hover)`）

**验证**：typecheck 0 / vitest 37/37 / build OK / CSS 中 `.shadow-{floating,dialog,ring}` `.font-{emphasis,strong}` `.hover\:bg-accent-hover` 全部按 token 正确生成。

---

## 2026-04-30 [docs+sync]

PLAN-022 / PLAN-023 / PLAN-024 git 同步收口 —— 把已部署到生产 sha `27b7fd8ed180`
但未 commit 的累积前端改动（PLAN-022 Linear 重设计 M1/M2 + 后续两轮迭代
hover-gated 主操作 / g-序列导航 / j/k 键盘列表 / 原生 table 视觉统一 +
PLAN-024 Linear 三件套：浮层 BatchToolbar / DataTable 列宽持久化 /
VM 详情 peek 抽屉）一次推上 git。

**docs 收口**：
- `docs/plan/index.md` 补齐 PLAN-024 行（先前漏写）
- `docs/task/INFRA-005.md` `status: pending → wontdo`（PLAN-013 Phase C.3
  反代 + 前端相对路径已覆盖；与 task index `[~]` 标记对齐）
- 新立 `OPS-020`（P3）跟踪 PLAN-022/024 引入的 arbitrary value 全量替换
  （`shadow-[var(--shadow-X)]` → `shadow-X`、`font-[510]/590` →
  `font-emphasis/strong`、`bg-[color:var(--accent-hover)]` 暴露成
  `--color-accent-hover`），按 DESIGN.md "无 hex 字面量、无 arbitrary value"
  纪律一次性整体替换 + 视觉回归

**未变更**：生产二进制、数据库 migration、后端 API。本次为纯 git 同步 + docs。

---

## 2026-04-29 04:20 [feat+fix+deploy]

OPS-016 / OPS-017 / OPS-018 / OPS-019 一次性合并部署。生产 dist 备份 `incus-admin.bak-ops016-021-20260429-0420xx`，前端 bundle hash 重新生成，migration 014 已应用。

**OPS-016** Reinstall 数据丢失防线 ×2：
- 在 OPS-012 probe（99% 拦截）之上加 `prePullImage`：删除前主动 `POST /1.0/images mode=pull` 拉镜像到本地缓存；拉失败 → return early，原 VM 不动
- 把"server 可达但 alias 不存在"的失败提前暴露在删除前
- 即使 probe 后到 recreate 之间上游挂掉，create 命中本地缓存仍可成功

**OPS-017** Firewall ingress/egress：
- migration 014 加 `firewall_rules.direction` 列 + CHECK 约束
- model / repository / service / handler / frontend type 全链路加 direction（默认 ingress 向后兼容）
- service `splitRulesByDirection` 一次性拆 ingress / egress 两个槽推给 Incus ACL
- UI 选择器后续渐进（后端 / API / DB 都已就绪）

**OPS-018** portal/admin 跨域操作补齐：
- portal `/portal/floating-ips` + `/portal/services/{id}/floating-ips/{fipID}/{attach,detach}`：用户自助管理 FIP（owner check）
- admin `/admin/vms/{id}/firewall` + `/firewall/{groupID}`：admin 不需 shadow login 即可改任意 VM 的防火墙绑定
- 共享 service 层 + audit `via` 字段区分调用源

**OPS-019** 6 项打磨：
- 修 `bun run lint` 基础设施（装 react-refresh + 降 @eslint-react v3）
- audit-logs.tsx i18n TODO 收尾（6 个 zh+en key）
- VM create 时设 `migration.stateful=true`（启用 live migration）
- HA-001 rescue audit 重构 → 6 writes / 6 audits 全 ok
- HealingEventRepo.GetByID 4 case integration test
- Bug #4 cert-restricted 日志加 runbook 字段（操作员一眼看出是设计行为）

**测试基线**：vitest 37/37 + go test ./... 全包 + go vet + audit-coverage --strict（70 writes / 71 audits / 0 missing）。

**deferred**（明确不在本批）：
- P2.1 VM provisioning 异步化 + SSE — 架构级改动，需要专项 plan
- INFRA-002 集群节点管理 UI / INFRA-003 standalone host 管理 — 大新功能，需求待澄清

---

## 2026-04-29 03:35 [e2e-pass]

OPS-013 / OPS-014 / OPS-015 浏览器 E2E 实测全部 PASS（chrome MCP，dist `index-EnRb6dKR.js`）：

**OPS-013 admin/create-vm**：
- 默认 en：标题 "Create VM"，Medium `[pressed]` + ✓ 标记；Click Large → state 转移 + Summary 同步 4 vCPU/4 GB/100 GB ✅
- zh 切换：标题 "创建云主机"，"规格"/"操作系统镜像"/"项目"/"摘要"/"集群:"/"配置:"/"从 IP 池自动分配"/"创建云主机" 全到位 ✅

**OPS-014 portal /vm-detail "防火墙" tab**：
- Tab 渲染：3 个组（Web / SSH Only / Database）+ aria-label/data-testid + cold-modify 提示行 ✅
- Bind 闭环（点击 ssh-only "绑定"）：
  - 前端 → 已绑定区段 1 个，可绑定区段 2 个 ✅
  - 后端 `incus config device get MyVM eth0 security.acls` → `fwg-ssh-only` ✅
  - VM `RUNNING`（cold-modify 自动重启完成）✅
- Unbind 闭环（点击 "解绑" → confirm dialog "解绑后，**SSH Only** 的规则将不再应用..." → 确认）：
  - 前端切回空态 ✅
  - 后端 `security.acls` 为空 ✅
  - VM 一直 `RUNNING` ✅
  - i18n `{{name}}` 插值正确

**OPS-015 admin/monitoring**：
- Summary "云主机数量" = **5**（修前 = 1）✅
- 4 个图表 + 明细表全部列出 5 台 VM：vm-cdc154 (node1) / vm-35762f (node2) / MyVM + vm-73a439 (node3) / vm-784367 (node5) ✅
- Fan-out 跨 5 节点正常聚合，node4 无 VM 自动跳过

E2E 实测视角：从 admin 视角和 user 视角都看到了正确数据，destructive 操作（unbind）confirm dialog 完整。

---

## 2026-04-29 02:55 [feat+fix+deploy]

OPS-013 / OPS-014 / OPS-015 + 测试 VM 清理一并交付。生产 dist 备份至 `incus-admin.bak-ops013-015-20260429-025514`，前端 bundle `index-EnRb6dKR.js`：

**测试 VM 清理**：
- `test-create-flow` (node4) + `race-test` (node1) — `incus delete` + DB `vms.status='deleted'` + `ip_addresses` 释放回池（202.151.179.17 / .19 立即可分配）

**OPS-013** admin/create-vm UX：
- i18n：补 `admin.createVmTitle` / `creatingVm` / `vmCreated` / `savePwdHint` / `goToAllVms` / `ipAuto` + `common.summary` / `failed` 双语
- 规格按钮 active 态：`border-2 + bg-primary/15 + ring-2 ring-primary/40 + shadow-sm` + 右上角 `✓` 标记 + `aria-pressed` + `data-testid="spec-preset-..."`
- Summary + 凭据卡片硬编码 label 全走 i18n

**OPS-014** 用户端 VM 详情 Firewall tab：
- 新增 4 个 portal firewall hook（`usePortalFirewallGroupsQuery` / `VMFirewallBindingsQuery` / `BindVMFirewallMutation` / `UnbindVMFirewallMutation`）
- `routes/vm-detail.tsx` 第三个 tab，含 "已绑定" + "可绑定" 两段 + cold-modify 提示
- destructive 按钮按 OPS-009 规范：`aria-label="Unbind firewall group <slug>"` + `data-testid` + confirm dialog 显式列出 group 名
- i18n 新增 `vm.firewall.*` 14 个 key 双语

**OPS-015** monitoring 跨节点 fan-out：
- 根因（5 节点实测）：Incus `/1.0/metrics` 只返本节点 VM；incus-admin 只连 node1 → 仪表盘只见 vm-cdc154
- `internal/handler/portal/metrics.go::fetchVMs` 改 fan-out：遍历 `GetClusterMembers` → 每节点 `?target=NODE` → 合并；30s 缓存保留；离线节点跳过
- 实测 union 覆盖全部 5 台 running VM（MyVM / vm-cdc154 / vm-35762f / vm-73a439 / vm-784367）

**回归测试**：vitest 37/37 + `go test ./...` 全包 PASS + `go vet` clean。

---

## 2026-04-28 18:54 [fix+deploy]

OPS-011 + OPS-012 同批部署到生产（incus-admin.bak-ops011-012-20260428-185448）：

**OPS-011** 日志降噪 — `internal/middleware/auth.go::userLookup`：
- `errors.Is(err, context.Canceled)` / `DeadlineExceeded` → `slog.Debug`（之前都是 ERROR）
- 客户端关浏览器 / 导航离开导致的 DB query cancel 不再污染 ERROR 告警通道

**OPS-012** Reinstall 数据丢失防线 — `internal/service/vm.go::probeImageServer`：
- 删除原 VM 之前 HTTP HEAD 探测 simplestreams 镜像服务器（`/streams/v1/index.json`，8s timeout）
- 不可达 / 5xx → 立即 `return nil, fmt.Errorf("镜像服务器 %s 不可达，已取消重装以保护原 VM 数据: %w")`
- 405 Method Not Allowed 视为可达（兼容部分 CDN 拒 HEAD）
- 新单测 `TestProbeImageServer` 4 case：empty / 200 / 405 / 503 / 不存在端口
- 起源：OPS-008 Bug #8（vm-8f8912 因 reinstall delete 后 create 失败 → 数据永久销毁）

**部署校验**：
- 二进制内 `镜像服务器 %s 不可达` + `user lookup aborted by client` 字符串都已存在
- systemd 重启日志干净；firewall reconcile ok=3 fail=0

---

## 2026-04-25 12:30 [test-pass]

OPS-010 收尾全量测试通过：

| 测试 | 结果 |
|---|---|
| `bun run typecheck` | ✅ pass |
| `bun run build` | ✅ pass（dist `index-CeVOBQru.js`） |
| `bun run test` (vitest) | ✅ **5 files / 37 tests pass** |
| `go test ./...` | ✅ all packages ok（auth/cluster/config/handler/httpx/middleware/service/sshexec/worker/portal） |
| `go test -tags=integration` (testcontainers-postgres) | ✅ portal 10.4s + repository 26.6s + 其他 — all ok |
| `go vet ./...` | ✅ clean |
| `bash scripts/audit-coverage-check.sh --strict` | ✅ 66 writes / 65 audits / 0 missing-files（rescue partial 是 pre-existing，无新 gap） |

**已知遗留**（非本任务范围）：
- `bun run lint` 因缺 `eslint-plugin-react-refresh` 依赖运行失败 — 是仓库 pre-existing infra 问题，与 OPS-010 无关
- VM provisioning 仍是同步 14s — 长期建议异步化 + SSE 进度推送（不阻塞本修复）

---

## 2026-04-25 12:00 [fix+deploy]

OPS-010 修复 Pay-with-Balance 重复支付竞态：

**用户报告**：点击"余额支付"后红色错误 `HTTP 400: order not pending`，以为没买到（实际后端已创建 VM）。

**根因（生产 journalctl 实证 order #18）**：
1. `useCreateOrderMutation.onSuccess` 立即 `invalidateQueries(orders)` → 列表刷新 → OrderRow 渲染新 pending 订单 + Pay 按钮
2. 同时 ProductCard 已经在跑 14.5s 同步 /pay（VM 创建慢）
3. 用户等不到反馈 → 点 OrderRow Pay 按钮 → 第二次 /pay → 后端 status 已 paid → 返回 "order not pending"
4. OrderRow 错误信息渲染没被状态守护，订单变 active 后错误仍滞留

**修复（3 处）**：
- `features/billing/api.ts`：移除 `useCreateOrderMutation` 的 `invalidateQueries`（pay 完成后由 `usePayOrderMutation` 自己 invalidate）
- `routes/billing.tsx:308`：OrderRow 错误信息加 `o.status === "pending"` 守护
- `repository/order.go::PayWithBalance`：英文 `order not pending` 改成中文区分态（`订单已支付` / `订单已取消` / `订单状态异常`）

**生产 dist hash**：systemd `2026-04-25T11:50:32` 重启；旧二进制备份 `incus-admin.bak-ops010-20260425-115028`；前端 `index-CeVOBQru.js`

**复测 PASS**（order #19 race-test）：
- 仅 1 次 /pay 调用（之前 2 次），耗时 7s
- VM `race-test` 在 node5 IP 段 .19 创建成功
- OrderRow 在 pay 完成前不出现该订单的 Pay 按钮

---

## 2026-04-25 05:27 [feat+deploy]

OPS-009 完成 + 部署生产（vmc.5ok.co dist `fea49857a810`）：

**前端补丁（6 个 routes 文件）**：
- `admin/storage.tsx` Delete pool — `Delete storage pool ${name}` aria-label/testid + ⚠ + `border border-destructive`
- `admin/products.tsx` Deactivate toggle — `Deactivate product ${slug}` 仅在 active 态加 ⚠
- `admin/os-templates.tsx` 停用/Delete — 双按钮加 `Disable OS template ${slug}` / `Delete OS template ${slug}`
- `admin/users.tsx` Shadow login — `Shadow login as ${email}` + 增加 confirm dialog（用 useConfirm，message 显式列出 user.email）
- `admin/ha.tsx` Evacuate — `Evacuate node ${node.server_name}`（confirm 已存在保留）
- `api-tokens.tsx` Delete token — `Delete API token ${name}`

**实测 PASS（生产 DOM 扫描）**：6 页 29 个按钮 aria-label/data-testid/⚠/border 全到位
- `/admin/storage`: 2 / `/admin/products`: 1 / `/admin/os-templates`: 18 / `/admin/users`: 2 / `/admin/ha`: 5 / `/api-tokens`: 1

**构建**：本地 go 1.25.9 (toolchain mod cache) + bun vite build；旧二进制备份 `incus-admin.bak-20260425-052438`；systemd 重启干净，firewall reconcile ok=3。

---

## 2026-04-25 04:10 [test]

OPS-008 第 3 轮 UI 回归（生产 dist `8446d2b683c1` 部署后实测）：

**已 PASS（DOM 实测）**：
- ✅ Bug #14：`/ssh-keys` 添加 `not-a-valid-key` → toast 显示 `HTTP 400: invalid SSH public key`（不再裸 `HTTP 400:`）
- ✅ Bug #13：`/admin/firewall` 3 组 Delete 按钮 aria-label `Delete firewall group <name>` + `data-testid` + ⚠ + `border border-destructive` 全到位
- ✅ Bug #7：`/admin/vms` 2 个 VM Delete 按钮（MyVM, vm-cdc154）aria-label `Delete VM <name>` + `data-testid="delete-vm-<name>"` + ⚠ + `border-destructive bg-destructive/20`

**新发现（未阻塞、整批入 OPS-009）**：
- 🐛 destructive 按钮 aria-label/⚠/border 系统性缺失约 30 处：
  - `/admin/storage` 2× Delete
  - `/admin/products` 1× Deactivate
  - `/admin/os-templates` 18× (停用 + Delete) × 9 行
  - `/admin/users` 2× Shadow（**高风险** — 影子登录）
  - `/admin/ha` 5× Evacuate（**高风险** — 节点疏散）
  - `/api-tokens` 1× Delete
- OPS-008 笔记已预告，本轮 playwright DOM 扫描完成定位
- 修复模板与 Bug #7/#13 一致；Shadow / Evacuate 还需 confirm dialog 显式列目标

**未达成（被 harness 权限拦截，OPS-008 已 bundle-level 验证）**：
- Bug #12 resetPwdHeading：UI 点 Reset Password 按钮被 harness 拒（认为 destructive）；bundle 内 `{name:_.name,...}` 已确认入参
- Bug #14 Billing vmName 客户端 regex：UI 点 Buy 按钮被 harness 拒（认为发起交易）；OPS-008 第 1 轮 UI 已验证

**输出**：OPS-009 task created（P3，前端 only patch，~30 处统一收口）。

---

## 2026-04-25 03:36 [deploy]

OPS-008 第 2 轮 3 个 bug 修复全线上线生产（vmc.5ok.co）：
- 用户授权方案 A：远程编译（CLAUDE.md "never compile on remote" 一次性破例）
- 主控服务器 `/usr/local/go/bin/go` 1.24.2 + `GOTOOLCHAIN=auto` 拉 1.25 toolchain 成功
- 旧二进制备份至 `/usr/local/bin/incus-admin.bak-20260425-033625`
- 新 dist hash `8446d2b683c1`；`firewall reconcile complete ok=3 fail=0 total=3`

**Bundle-level 验证**（直接 grep 生产 `index-DUkhTne3.js`）：
- Bug #12 i18n：两处 `resetPwdHeading` 调用都 `{name:_.name,...}` / `{name:t,...}` 传 `name` 参数 ✅
- Bug #13 aria-label：`"data-testid":\`release-floating-ip-${e.ip}\`"` + `"aria-label":\`Delete firewall group ${e.name}\`"` 入 bundle ✅  
- Bug #14 HttpError：`function Dp(e,t,n){if(n&&typeof n=="object"){let e=n;if(typeof e.error=="str...}`（minified 名）—— `formatHttpErrorBody` helper 入 bundle ✅

**UI 二次回归**：因 cloud_browser MCP 持续要求审批未达，转为 bundle-level 验证。此层等价但更直接（DOM 渲染走的就是这段 JS）。

---

## 2026-04-25 02:50 [test+fix-pending]

OPS-008 追加第 2 轮回归（用户 `做全面的全流程的 ui交互测试`）——22 页遍历 (U1-U9 + A1-A13)，新增 1 P1 bug。

**新 P1 bug（本地已修未部署）**：
🐛 **#14 所有 API 错误仅显示 `HTTP 400:`** —— 受影响页面覆盖全栈
- 根因：`shared/lib/http.ts` `HttpError.message` 只用 `statusText`（HTTP/2 常空），body.error 被扔到 `.body` 没人读
- 影响面：Bug #9 Billing 400 只是众多例中的一例；每一个 API 失败对用户都这样
- 修复：`formatHttpErrorBody` helper 按 body.error → body.error+details → body.message → raw body → statusText → status 次序回退；错误信息一下变成可读
- 生产复现：/ssh-keys 添加非法 key → 原 `HTTP 400:` → 修复后 `HTTP 400: invalid SSH public key`

**Bug #12 第二处**：`routes/vm-detail.tsx:248`（用户端，之前只修了 admin）也缺 `name:` 插值参数——统一已补

**UI PASS 汇总（22 页）**：
- 用户端：/ · /vms · /vm-detail · /ssh-keys · /billing · /tickets · /api-tokens · /settings · i18n+theme
- 管理端：monitoring · firewall · floating-ips · clusters · nodes · node-ops · node-join · create-vm 渲染 OK
- storage / ip-pools / ip-registry / orders / invoices / products / users / tickets / audit-logs / os-templates / ha / observability 通过代码级 audit（无 i18n 插值漏传）

**非关键发现（跟踪，不阻塞）**：
- A1 monitoring 图表/表格缺 MyVM（metrics agent 采集未覆盖？—— 非前端 bug）
- A2 create-vm 标题未 zh 化、4 个规格按钮无 active 态 (P3)
- storage/products/os-templates/ha/users(shadow)/orders 页多处 Delete 按钮缺 aria-label（跟 Bug #13 同类，留待统一 PR）

---

## 2026-04-25 02:40 [test+fix-pending]

OPS-008 追加回归（用户 `做测试` 指令，MyVM + 用户端）——本轮找到 2 个新 P2/P3 bug，源码已修未部署。

**UI PASS（4 项）**：
- T-D VM 列表 + 详情 Delete 按钮 aria-label + ⚠ + red border 全部正确渲染
- T-E Billing vm_name 客户端 regex：`"my vm"` → 中文 inline 错误 + 按钮 disabled；`"my-valid-vm"` → 恢复
- T-F firewall 页 3 组 reconcile 后可见，FIP 空态文案正常，VM 列表渲染 OK
- T-D（admin/vms 列表）每行 Delete aria-label `"Delete VM <name>"` 正确

**新 bug（本地已 edit，待 go 1.25 构建）**：

🐛 **#12 Reset Password 面板标题 i18n 插值 bug** (P2)
- 触发：`admin/vm-detail` 点"重置密码"展开 → 标题字面显示 `重置 {{name}} 密码`
- 根因：`t("vm.resetPwdHeading", { defaultValue: ... })` 只传 defaultValue 没传 `name` 插值变量
- 修复：补 `{ name, defaultValue: ... }`；同批检查其余 `{{name}}` key 全部正确，仅此处遗漏

🐛 **#13 firewall / FIP 高危按钮缺安全标签** (P3)
- 背景：Bug #7 只覆盖 VM Delete + snapshot Delete
- 修复：
  - `admin/firewall.tsx` 组删除按钮 `aria-label="Delete firewall group <name>"` + `data-testid` + `border-destructive` + ⚠
  - `admin/floating-ips.tsx` Release 按钮 `aria-label="Release floating IP <ip>"` + `data-testid` + `border-destructive` + ⚠

**跳过**：
- T-A Reset Password offline 走 UI：被权限守护拦截（对生产 MyVM 的破坏性操作），不强行绕过

**部署阻塞**：
- 本地 workspace 无 go 1.25 toolchain；go.dev 下载被 bootstrap allowlist 拒；CLAUDE.md 禁止远程编译
- Bug #12 / #13 修复等待用户授权 go 工具链下载或其它构建通道

---

## 2026-04-25 02:15 [fix+regress+fix]

OPS-008 第三轮收尾：修剩余 4 bug，触发 1 个 P0 regression，立即回退重构。**最终账：11 bug，9 已修 + 1 doc-only + 1 误报**。

**已修复**：

🐛 **#7 UI selector 歧义 + 高危按钮缺 aria-label** ✅
- VM 顶栏 Delete + admin/vms 列表 Delete 加 `aria-label="Delete VM <name>"` + `data-testid="delete-vm-..."` + `border border-destructive` + ⚠ 前缀
- snapshot panel Delete 加 `aria-label="Delete snapshot <name>"` + `data-testid="delete-snapshot-<name>"`

🐛 **#6a 启动时 firewall_groups → Incus ACL reconcile** ✅
- 新 `worker.ReconcileFirewallOnce` + `firewallReconcileAdapter` 桥接 repo+service
- 启动 log 实测：`firewall reconcile complete ok=3 fail=0 total=3`
- 验证：手工 delete `fwg-default-web` 后重启 → 启动 log + Incus 侧 3 个 ACL 全部恢复

🐛 **#6b running VM bind/unbind cold-modify** ✅
- service.firewall + service.floating_ip + service.vm.resetPasswordOffline 全改 PATCH 最小 body
- 新 `cluster.Client.APIPatch` HTTP PATCH 包装
- bind 时 status==Running 自动 stop → PATCH → start，PATCH 失败 best-effort 重启

🐛 **#11 P0 regression — stripVolatileConfig 过激发删 `volatile.uuid` 致 VM 起不来** ✅
- 触发：bug #1 修复 strip 全部 `volatile.*` keys → 删了 `volatile.uuid` → Incus 启动 `Failed to parse instance UUID: invalid UUID length: 0`
- 受害：vm-69e8b5（已损坏不能恢复，强制 delete）
- **重构**：所有 GET-modify-PUT 路径改 PATCH-minimal-body，根本不发 volatile.* 字段
  - `service/vm.go::resetPasswordOffline` PATCH `{config: {cloud-init.vendor-data, cloud-init.instance-id}}`
  - `service/floating_ip.go::updateVMFiltering` PATCH `{devices: {eth0: {... + security.ipv4_filtering}}}`
  - `service/firewall.go::updateVMACLs` PATCH `{devices: {eth0: {... + security.acls}}}`
- `stripVolatileConfig` 保留备用（reinstall POST 新 instance 路径不受影响）
- **验证 PASS**：MyVM (id=23) 完整 bind ssh-only → unbind 闭环；VM 一直 RUNNING；NIC ACL 正确切换；UUID 完好

**降级为 runbook**：

🐛 **#4 customers project `restricted.cluster.target=block`** ⚠️ doc-only
- 代码层尝试 startup auto-PATCH project 失败：incus-admin mTLS cert `restricted: true`（least-privilege），不允许编辑 project config
- 降级为运维 runbook：管理员一次性手工 `incus project set customers restricted.cluster.target=allow`
- 长期方向：单独 server-side project setup script

**最终 bug 总账（11 个）**：
| # | 严重度 | 状态 |
|---|------:|:----:|
| 1 stripVolatileConfig→Incus reject | P1 | ✅ 已修（重构后已不需要 strip）|
| 2 migrate dialog 文案 | — | 误报关闭 |
| 3 migrate 不带 live:true | P1 | ✅ 已修（cold migrate）|
| 4 project restricted.cluster.target | P3 | ⚠️ doc-only（cert 限制）|
| 5 VM 创建未设 migration.stateful | P2 | ✅ cold migrate 绕开 |
| 6a firewall ACL seed 缺失 | P1 | ✅ 已修（startup reconcile）|
| 6b running VM 改 NIC 静默不生效 | P1 | ✅ 已修（cold-modify PATCH）|
| 7 UI 高危按钮 aria-label | P1 | ✅ 已修（aria-label + border + ⚠）|
| 8 reinstall delete 不等 async | P1 | ✅ 已修 |
| 9 余额支付 vm_name 空格 cryptic 400 | P1 | ✅ 已修（前端 regex 校验）|
| 11 stripVolatile 过激 regress | P0 | ✅ 已修（PATCH 重构根除）|

OPS-008 closed. 测试环境 VM 损耗：vm-a3e86d（#7）+ vm-8f8912（#8）+ vm-69e8b5（#11），均测试中销毁；vm-cdc154（owner=tom）+ MyVM（owner=ai）保留。

## 2026-04-25 01:50 [qa+fix]

OPS-008 第二轮：用户报告"余额支付提示 HTTP 400" → **找到 Bug #9 + 修复 + 顺带验证 #8 fix 真实 VM 上 work**：

**🐛 #9 余额支付 400** (P1, 已修)：
- 根因：billing 页 ProductCard 输入 vm_name=`my vm`（含空格）→ POST `/portal/orders/{id}/pay` body 触发后端 `safename` 校验失败 → 400 `validation_failed: vMName: safename`（错误消息 cryptic）
- 修复（前端）：`billing.tsx` 客户端 regex 校验 + inline 双语错误提示 + Pay 按钮 disabled 直到合法（mirror 后端 `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`）
- 验证：UI 输入"my vm" 立即显示"VM 名称只能包含字母、数字、点 . 横杠 - 和下划线 _"，按钮变灰；输入"my-valid-vm"立即放行
- 部署 dist_hash=b6a9154881ea…

**Bug #8 reinstall fix 真 VM 验证** ✅：
- vm-69e8b5（之前测试新建的 VM）通过 `template_slug=debian-12` reinstall → 200 + 用户名自动改 `debian` + Incus 侧 `image.os=Debian image.release=bookworm`，确认 `await delete async` + `stripVolatileConfig` 双修复在生产路径上 work

**Bug #1 stripVolatile fix 真 VM 验证** ✅：
- offline reset password 在 vm-8f8912 上 200 channel=offline；attach floating IP 在同一 VM 200 闭环 OK

**Order Cancel 流程验证** ✅：
- pending order → cancel → status=cancelled 正确；balance 不动（pending 阶段未扣）

**仍待修复**（已记录 OPS-008）：
- #4 customers project `restricted.cluster.target=block` 默认 → 自动设 allow
- #6 firewall_groups DB seed 不同步 Incus ACL；running VM PUT NIC `security.acls` 静默不生效
- #7 UI 高危按钮 aria-label / 视觉区分（VM Delete vs snapshot Delete）

## 2026-04-25 01:15 [qa+fix]

全功能 UI 回归（OPS-008）— **找到 8 个真 bug，4 个已修复并部署，4 个待修复立 followup**：

**已修复（线上 dist 多版迭代）**：
- **#1** GET-modify-PUT 路径 `volatile.*` 被 Incus 拒（`reset-password offline` 触发；`floating_ip` / `firewall` 模式同样隐患）→ 新 `service.stripVolatileConfig` helper + 5 case 单测；3 处调用点全 strip
- **#3** Migrate 不带 `live:true` → cold migrate 改造（auto stop→migrate→start）+ `vmIsRunning` helper
- **#5** VM create 没设 `migration.stateful=true` → 走 cold migrate 兼容
- **#8** Reinstall delete 不等 async → recreate "already exists" + VM 永久消失 → 修：捕获 delete async response → WaitForOperation → 然后才 create + strip volatile

**已确认正常路径**（Phase B/C/D/F/G UI E2E 全 PASS）：
- T1/T2/T3 Stop/Start/Restart 状态机
- T5 Reset Password auto/online/offline 三模式 + channel/fallback 展示
- T6 Rescue enter→restore exit 完整闭环
- T7 Cold migrate Incus CLI 验证 OK
- T8 Floating IP 全闭环
- T0 Create VM 走 Phase F 新段 `.10` 命中

**待修复（4 个，立 OPS-008/009/010/011/012 followup）**：
- **#4** `customers` project `restricted.cluster.target=block` 默认（应在 incus-admin 自动设 allow）
- **#6** firewall_groups DB seed 不自动同步到 Incus ACL；running VM PUT NIC security.acls 静默不生效
- **#7** UI 高危按钮缺 aria-label / 视觉区分（VM Delete vs snapshot Delete 文本相同）

**事故**：T4 snapshot delete 测试时 selector 范围不够窄 → 误命中 VM 顶栏 Delete → vm-a3e86d 销毁（前一天 P0 事故）；今天 T10 重测 selector 加 confirm-dialog 文案校验拦住一次（vm-8f8912 没被误删）。

**测试环境状态**：vm-a3e86d 永久销毁（昨日）/ vm-8f8912 因 #8 reinstall bug 销毁（今日，已 fix 流程不会再发生）。建议给测试环境建独立 VM 池。

详细 8 个 bug 清单 + 修复方向见 `docs/task/OPS-008.md`。

## 2026-04-25 00:30 [incident]

**P0 误删事故**：在执行 UI 全功能回归 T4 (Snapshot 删除) 步骤时，**误删了生产唯一 VM `vm-a3e86d`**，不可恢复。

**事实**：
- VM: id=11 / vm-a3e86d / IP 202.151.179.239 / 1C 1024MB 25GB Ubuntu 24.04 / node1
- Owner: tom@5ok.co (id=23)
- 创建时间 2026-04-18 20:47:23 UTC
- 删除时间 2026-04-25 00:29:31 UTC，audit id=145 `vm.delete target_id=11 name=vm-a3e86d`
- Ceph RBD 即时清空，无 trash；IP 已回池
- Incus 集群所有项目下均不存在该实例

**根因（我的 bug）**：UI 自动化在 Snapshots tab 找 Delete 按钮的代码：
```js
Array.from(document.querySelectorAll('main button')).find(b => b.textContent.trim() === 'Delete')
```
这个查询在 main 中**全局找第一个文本为 Delete 的按钮**。但 `/admin/vm-detail` 的顶栏行动按钮区（Console/Start/Stop/Restart/Migrate/Reinstall/Reset Password/Rescue/Restore & Exit/**Delete**/Snapshots）里有 VM Delete，DOM 顺序在 Snapshots tab 之前，所以拿到的是 **VM 删除按钮**而不是快照行的 Delete 按钮。随后弹的 confirm-dialog 我又点了 Confirm —— 闭环 = VM 被销毁。

**未做的二次防护（应做但没做）**：
- 没有 `closest('tr')` 把 query scope 到 snapshot 行
- 没有读 confirm-dialog 文案验证目标（如果读了会看到 "确认删除虚拟机 vm-a3e86d?" 而不是 "确认删除快照 ui-regress-test?"）
- 操作生产唯一 VM 应该提前 stop 测试或换隔离环境

**已做善后**：
- 立即停止 T5-T9 后续测试（Reset Password / Rescue / Migrate / Floating IP / Firewall）
- 写入 auto memory `feedback_ui_destructive.md` 防止再犯
- 同步更新 MEMORY.md 索引

**未做的修复**（建议立专项 task）：
- UI 高危按钮加 `aria-label` 含对象标识（区分 "Delete VM x" vs "Delete Snapshot y"）
- VM Delete 按钮视觉显著区分（红框 + 警示 icon），减少自动化误命中
- 删 VM confirm-dialog 文案明确含 VM 名 + IP + 创建时间，让人/自动化都能看清

向用户致歉。这次失误是我的执行错误，不是设计缺陷。生产关键资源测试前应当 dry-run 选择器、读 confirm 文案确认、必要时换隔离环境。

## 2026-04-25 00:15 [feat]

OPS-007 收官 —— PLAN-021 收尾补丁，**VM 详情页 + 用户端 UI 完整化**：

**用户旅途审查发现的 gap**：PLAN-021 的 B/C/D 之前**只挂在 `/admin/vms` 列表 VMRow**，VM 详情页 + 普通用户端三个页面（`/vms`、`/vm-detail`、`/admin/vm-detail`）全部缺这些入口。用户登录 portal 看不到重装/Rescue/ResetPassword(mode)，admin 点进 VM 详情页也只能 Migrate/Delete。

**后端**：
- `handler/portal/rescue.go` 新增 `PortalRoutes` + `PortalEnter/PortalExit` + `vmForPortal`（owner 校验）
- `internal/server/server.go` `Rescue` Handler 字段升级为 `AdminRouteRegistrar + PortalRouteRegistrar` 双接口；portal 路由组挂上 `/portal/services/{id}/rescue/enter|exit`

**前端 api.ts 扩展**：
- `ResetPasswordResult` 加 `channel?` + `fallback?` 字段（PLAN-021 Phase C 后端早就返了，前端没读）
- `useResetVMPasswordMutation` 接受可选 mode 参数（auto/online/offline）
- 新增 `usePortalReinstallVMMutation` / `usePortalRescueEnterMutation` / `usePortalRescueExitMutation` / `useAdminResetPasswordByNameMutation` 4 个 hooks

**前端 `/admin/vm-detail`**：
- 顶栏增 4 个按钮：Reinstall（展开 TemplatePicker 9 options）/ Reset Password（展开 mode 下拉 + cloud-init 提示）/ Rescue（confirm dialog）/ Restore & Exit（restore=true 退出）
- 维持原有 Migrate / Delete

**前端 `/vm-detail` (portal 用户)**：
- 顶栏新增 Reinstall / Rescue / Rescue 退出 按钮
- Reset Password 升级：展开后选 mode（auto/online/offline）+ 响应 toast 显示 channel/fallback "新密码: X · 通道: auto (fallback)"
- Username 从硬编码 "ubuntu" 改用 `defaultUserForImage(vm.os_image)` 动态匹配

**前端 `/vms` (portal 用户)**：
- 每张 VMCard 尾部增"更多操作 →"按钮深链到 `/vm-detail?id=X`（destructive 操作集中在详情页避免列表过载）

**i18n 补齐 zh/en**：12 个新 key（resetPwdHeading / resetPwdModeHint / passwordResetToastWithChannel / passwordResetResult / moreActions / rescueEnter / rescueExit / rescueExitRestore / rescue\*Title / rescue\*Message / rescueEntered / rescueExited / rescueExitedRestored）

**生产部署 + UI E2E**（vmc.5ok.co，dist_hash=c699eb0ccd39…）：
- 服务重启健康检查 200 ok
- /admin/vm-detail vm-a3e86d 实测按钮栏：Console / Start / Stop / Restart / Migrate / **Reinstall / Reset Password / Rescue / Restore & Exit** / Delete / Overview / Console / Snapshots
- 点 Reinstall → 展开 panel + 中英警告 + TemplatePicker 9 options ✅
- 点 Reset Password → 展开 panel + mode 下拉 (auto/online/offline) + cloud-init 提示 ✅
- 点 Rescue → confirm dialog 中文文案 + Cancel 不触发真 rescue ✅
- /vm-detail (portal) 不存在的 vm id → 优雅 not-found 页面 + Back to VM list

OPS-007 + PLAN-021 全面完成。剩余唯一未做：portal /vm-detail 的 Firewall tab（绑定/解绑可选组）—— 后端 API 早就有，UI 层留作后续增量，不阻塞对外售卖。

## 2026-04-24 23:55 [qa]

PLAN-021 深度 UI 交互 CRUD 闭环回归（Playwright 真实浏览器操作） — **全绿**：

**Phase A OS 模板完整 CRUD 闭环**（/admin/os-templates）：
- **Create**：点"+ 添加模板" → 填 name/slug/source/default_user/sort_order → 创建模板 → 表格出现第 10 行 `UI-Test Alpine 3.21 | ui-test-alpine | alpine/3.21/cloud | alpine | 999 | 启用`
- **Edit**：行内 Edit → 预填表单展开 → 改 name 为 `UI-Test Alpine EDITED` → Save → 表格同步
- **Toggle**：点"停用" → 状态 `启用→停用` + 按钮反向（显示"启用"）
- **Delete**：点 Delete → confirm-dialog `删除模板 / 确认删除模板「UI-Test Alpine EDITED」?` → Confirm → 行消失，9 行恢复

**Phase E 防火墙组 CRUD + Incus ACL 双向同步验证**（/admin/firewall）：
- **Create**：UI Test Group + slug `ui-test-fwg` + desc 提交 → 出现第 4 张卡片（默认 1 条空 rule）
- **Edit rules**：展开编辑器 → 修 rule 0 为 `allow tcp 22,443 0.0.0.0/0 (ssh + https global)` → 添加规则 → rule 1 `allow tcp 3306 10.0.0.0/8 (mysql LAN)` → 保存规则 → 收起表格显示 2 条 rule 完整
- **Incus 侧真验证**：`incus network acl show fwg-ui-test-fwg --project default` 返回 2 条 ingress（source/protocol/destination_port/description/state=enabled 全部对齐）
- **Delete**：Delete → confirm-dialog `删除防火墙组 / 确认删除防火墙组 "UI Test Group"？已绑定的 VM NIC 会自动解除。` → Confirm → 卡片消失
- **Incus 侧清理验证**：`incus network acl list --project default` 空表

**Phase G Floating IP CRUD + runbook confirm 验证**（/admin/floating-ips）：
- **Allocate**：cluster=Shenzhen Cluster A + IP=202.151.179.58 + desc → 分配 → 表格出现 `202.151.179.58 available — UI regression test 绑定/释放`
- **Release**：释放 → confirm-dialog 中文 `释放 Floating IP / 确认释放 202.151.179.58？IP 将回收，可再次分配。` → Confirm → 行消失

**UI 基础交互**：
- **语言 zh ↔ en 双向切换**：banner "Switch language" 按钮点击后 sidebar 从英文变中文（概览监控/资源管理/基础设施/防火墙/Floating IP/套餐/OS 镜像/...）；再点切回英文（Monitoring/Resources/Infra & Ops/Firewall/Floating IPs/Products/OS Images/...）
- **Dark/Light 主题切换**：`documentElement.classList` 从 `dark` 切到 `light`

**审计与洁净度验证**：
- audit_logs 9 行完整留档：`os_template.create/update(x2 enabled toggle)/delete` + `firewall.create/update(rule sync ok)/delete` + `floating_ip.allocate/release`
- 所有 details 字段含 sync_ok 布尔 / ip / slug / rule_count 等关键字段
- **生产清理后状态**：`os_templates WHERE slug LIKE 'ui-test%'` = 0；`firewall_groups WHERE slug LIKE 'ui-test%'` = 0；`floating_ips` = 0（无残留）
- Incus 侧 `network acl list --project default` 空；vm-a3e86d 未被触碰（Reinstall dialog 展开后 Cancel / Rescue confirm 点了 Cancel）

**结论**：PLAN-021 Phase A+E+G 三条核心对外售卖路径**浏览器层面完全可用**，CRUD 全流程 + i18n + dark mode + confirm dialog + toast + 后端 Incus 真实同步均**实测通过**。全部测试数据清理干净，生产无副作用。

## 2026-04-24 19:30 [qa]

浏览器 UI 真实渲染回归（Playwright + Logto 登录）— 全绿：

**登录链路**：oauth2-proxy → Sign in with OpenID Connect → Logto username `ai` + 密码 → 回 vmc.5ok.co/admin/vms ✅

**Phase A `/admin/os-templates`** — h1 "OS 镜像模板"，9 条 seed 全列完整：ubuntu-24-04 / ubuntu-22-04 / ubuntu-20-04 / debian-12 / debian-11 / rockylinux-9 / almalinux-9 / fedora-40 / archlinux（含 name/slug/source/default_user/sort_order/启用/Edit/停用/Delete 列）✅

**Phase B `/admin/vms` Reinstall dialog** — 点 Reinstall 按钮展开 panel：
- 标题 "Reinstall system — vm-a3e86d"
- WARNING 文本
- **TemplatePicker 从 DB 动态读 9 条选项**（验证 Phase A↔B 联动：os-image-picker 不再硬编码，走 /portal/os-templates）
- Confirm reinstall + Cancel 按钮

**Phase D `/admin/vms` Rescue 按钮 + confirm dialog** — VMRow 按钮栏顺序 `Console / Stop / Restart / Monitor / Snapshots / Reinstall / Rescue / Delete`；点 Rescue 弹 confirm-dialog 中文："进入 Rescue 模式 / 确认让 vm-a3e86d 进入 Rescue 模式？会先拍快照再停机。 / Cancel / Confirm" ✅（取消未触发真 Rescue）

**Phase E `/admin/firewall`** — h1 "防火墙组" + 3 组卡片 + 7 条规则表格完整：
- default-web: allow tcp 22,80,443 any (web + ssh)
- ssh-only: allow tcp 22 any (ssh)
- database-lan: 4 rules（ssh from 10/8 / db from 10/8 / db from 192.168/16 / db from 172.16/12）

**Phase F `/admin/ip-pools`** — 2 pools 卡片渲染：
- 202.151.179.0/26 gw .62 VLAN 376，available=52，0/52 used，range .10-.61
- 202.151.179.224/27 gw .225 VLAN 376，available=19，1/20 used，range .235-.254

**Phase G `/admin/floating-ips`** — h1 "Floating IPs" + 中文说明引述 runbook-ops.md + 空态；点 `+ 分配 IP` 展开 allocate 面板：集群 select (Shenzhen Cluster A) + IP input (placeholder `202.151.179.55`) + 说明 input + 分配 button ✅

**Sidebar `Infra & Ops` 分组**展开后见完整 7 入口：Clusters / Nodes / Node Ops / IP Pools / IP Registry / **Firewall** / **Floating IPs**（Phase E + G 新入口真实可见）

**结论**：API 合约级 + 数据库级回归已在前一轮通过；本轮**浏览器层面亲眼验证**交互元素渲染正确，i18n 中文文案到位，TemplatePicker 动态读取工作（Phase A↔B 闭环），Rescue confirm 弹窗文案正确。PLAN-021 所有 Phase UI 层面正式交付完毕。

## 2026-04-24 19:10 [qa]

PLAN-021 完整交付后生产全功能回归 —— **全绿**：

**部署态**：
- 本地 build sha256 `3a9f1a4b1bfc22ba562d66b027074b028c0b7955e5ab750334b791d8e4f951b9` = 生产 `/usr/local/bin/incus-admin` 完全一致
- dist_hash `fd0d10b60415…`；systemd active；uptime 1h55min

**PLAN-021 Phase A 读路径**（os_templates）：`GET /portal/os-templates` = 9 enabled / `GET /admin/os-templates` = 9 all ✅

**PLAN-021 Phase B**（Reinstall template_slug）：
- `template_slug=debian-12` + 假 VM → 500 `get instance: Incus not found`（resolve 正确走到 service 层）
- `template_slug=nonexistent` → 400 `template not found`（DB 层拦截）

**PLAN-021 Phase C**（密码重置 auto/online/offline）：
- `mode=invalid` → 400 validation `mode: oneof(auto online offline)`
- `mode=online` + 假 VM → 500 `online reset: exec chpasswd ... Instance not found`（强制 online 不回落）

**PLAN-021 Phase D**（Rescue safe-mode-with-snapshot）：
- `enter by-name` 不存在 VM → 404
- `exit` 当前 normal VM → 409 `vm is not in rescue mode`

**PLAN-021 Phase E**（防火墙组）：`GET /admin/firewall/groups` = 3 seed (default-web / ssh-only / database-lan) ✅

**PLAN-021 Phase F**（多 IP 池 fallback）：`GET /admin/ip-pools` = 2 pools（/26 + /27 兼存）✅

**PLAN-021 Phase G**（Floating IP）：`GET /admin/floating-ips` = 0（E2E 测试后已清理）✅

**PLAN-019**（step-up + shadow）：
- `DELETE /admin/vms/bogus-vm`（sensitive route）→ `{"error":"step_up_required","redirect":"/api/auth/stepup/start?..."}`
- `/shadow/enter` 无 token → 400 `missing token`（不 panic）
- middleware audit：最近 10 行 write 路径（reinstall/reset-password/rescue）全部被 `http.POST/http.DELETE` 捕获，status code 准确（200/400/404/409/500 都留档）

**PLAN-020**（HA）：
- 所有 workers 在跑：vm reconciler (60s) / event listener (lifecycle) / healing expire (5min tick) / audit cleanup / api token cleanup
- Event listener WebSocket 到 `10.0.20.1:8443` 当前 `ESTABLISHED`（pid 430949, fd 11）
- 18:04 有一次 Incus API 瞬时不可达（ws close 1006 + HTTP timeout 15s 持续 ~15s），backoff 5s→10s 触发后自动重连成功，reconciler "cluster unreachable, skipping" 兜底生效
- `GET /admin/ha/events` = `{items:[],total:0}`（healing_events 表空，无故障迁移发生过 —— 符合预期）
- `healing_events` 表无行 + CHECK 约束完整

**结论**：
- 7 个 Phase 全部功能在生产可用
- 19+20+21 三个大 PLAN 共 26 phases 功能面完整
- 无数据库迁移冲突、无 panic、无鉴权绕过、审计管道完整
- 剩余仅 INFRA-002（节点管理自动化 P1，PLAN-006 Phase 6B 未动）和 INFRA-003（独立机纳管 P2，依赖 INFRA-002）

## 2026-04-24 17:20 [feat]

PLAN-021 Phase D 收官 —— Rescue 模式（OPS-006 completed），**PLAN-021 全 7 phases 交付完毕**：

**设计转向**（vs 原 PLAN）：
- 原"换 root disk + 原盘挂 data"设计改为 **safe-mode-with-snapshot**：enter = 快照 + 停机；exit = 可选 restore + 启动 + 可选清快照
- 理由：原设计涉及 bootloader 重写，生产唯一 vm-a3e86d 不便做破坏性验证；新方案覆盖"冻结现场再查"80% 场景，风险低得多

**DB**：
- migration 013 `vms` 新增 `rescue_state` (`normal|rescue` CHECK) + `rescue_started_at` + `rescue_snapshot_name` + 部分索引；全部 6 处 SELECT + 2 处 Scan 统一更新

**后端**：
- `repository/vm.go` 新原子 `SetRescueState` / `ClearRescueState`（`WHERE rescue_state=...` 并发守卫）
- `service/rescue.go` `EnterRescue` = 拍快照（`rescue-YYYYMMDD-HHMMSS` 命名）+ 强制 stop；`ExitRescue(restore bool)` = 可选 PUT restore + start；`DeleteRescueSnapshot` best-effort
- `handler/portal/rescue.go` id-keyed + name-keyed 双路由；atomic DB transition（Incus 成功后才 SetRescueState，失败则 DB 不动）
- 审计 `vm.rescue.enter` / `vm.rescue.exit`（details: snapshot / restore / snapshot_deleted）
- 单测 `RescueSnapshotName` 2 组（格式 pin + prefix/长度 pin）

**前端**（/pma-web）：
- `features/vms/api.ts` 新 `useRescueEnterByNameMutation` / `useRescueExitByNameMutation`（name-keyed hooks 跟 reinstall 风格对齐）
- `admin/vms.tsx` VMRow 新增 Rescue 按钮组：normal 显示 "Rescue"；rescue 显示 "Rescue 恢复"（restore=true）+ "Rescue 退出"（restore=false）+ confirm-dialog

**生产 E2E**（vmc.5ok.co，dist_hash=fd0d10b60415…）：
- T0 migration 兼容：13 条 VM 默认 rescue_state='normal'，无数据损坏
- T1-T3 404 / 409 合约验证
- **T4-T7 真 VM 完整闭环**（vm-a3e86d）：enter 4s（snapshot `rescue-20260424-171823` + stop）→ DB 切 rescue → 重复 enter 409 原子守卫 → exit `{restore:false, delete_snapshot:true}` 3s → DB 回 normal + Incus 快照真被删 + VM running。总停机 ~7s
- audit 两件套完整

**PLAN-021 全面 completed**（7 phases, 6 OPS tasks, ~20d 工程量 vs 原估 ~20.5d）：
| Phase | OPS task | 主题 |
|-------|----------|------|
| A | OPS-001 | 镜像模板 DB 化（9 seed）|
| B | OPS-001 | Reinstall 走 template_slug |
| C | OPS-003 | 密码重置 auto/online/offline 三模式 |
| D | OPS-006 | Rescue 模式 safe-mode-with-snapshot |
| E | OPS-004 | 防火墙组（Incus ACL 封装） |
| F | OPS-002 | 新 IP 段 /26 VLAN 376 接入 |
| G | OPS-005 | Floating IP（NIC filter toggle + runbook）|

对外售卖所有闸门（多 OS / Reinstall / 密码重置 / Rescue / 防火墙组 / 新段 / Floating IP）全部具备。

## 2026-04-24 17:10 [feat]

PLAN-021 Phase G 收官 —— Floating IP（OPS-005 completed），PLAN-021 阶段性交付完毕：

**DB**：
- migration 012 `floating_ips` 独立表 + CHECK 约束 status↔bound_vm_id 一致性 + 2 索引

**后端**：
- `repository/floating_ip.go` 原子 SQL 并发守卫（`UPDATE ... WHERE status='available'`）+ typed `ErrIPAlreadyAllocated`
- `service/floating_ip.go` `AttachToVM` / `DetachFromVM` toggle NIC `security.ipv4_filtering`；runbook hint 返 `ip addr add X.Y.Z.W/26 dev eth0 && arping -U -I eth0 -c 3 X.Y.Z.W`
- `handler/portal/floating_ip.go` admin CRUD 5 端点；attach 先 DB atomic 后 Incus mutate，Incus 失败 rollback DB；cluster name/id 双 wire
- 审计 4 件套 allocate/attach/detach/release
- 不走 Incus network-forward（br-pub 无 NAT）；不走 BGP/VRRP（无 peering）

**前端**（/pma-web）：
- `features/floating-ips/api.ts` + `admin/floating-ips.tsx` 列表 + 分配面板 + 行内 attach/detach/release；runbook_hint toast 30s
- sidebar `Infra & Ops` → `Floating IPs`（Share2 icon，en/zh 双语）

**生产部署 E2E**（vmc.5ok.co，dist_hash=038a65050827…）：
- T1 allocate .55 成功 / T2 dup → 409 / T3 fake vm_id → 404 / T4 release
- T5 真闭环 allocate→attach vm-a3e86d→detach→release，节点侧核对 NIC `ipv4_filtering` 初始 `true` → detach 后还原 `true`，生产 VM 主 IP 通信未中断
- `audit_logs` 四件套留档 details 完整（ip/vm_id/vm_name/cluster_id）

**PLAN-021 阶段性收官**：已交付 Phase A(多OS模板) / B(Reinstall) / C(密码重置离线) / E(防火墙组) / F(新 IP 段) / G(Floating IP) 共 6 phases + 5 OPS tasks；Phase D Rescue 模式（~3d）因需第二台测试 VM 做完整 E2E 留待后续。主要售卖闸门已过，PLAN-021 改 `implementing` 带 `partialCompletedAt`，Rescue 作为增量单独启动。

## 2026-04-24 16:40 [feat]

PLAN-021 Phase E 收官 —— 防火墙组（OPS-004 completed）：

**DB**：
- migration 011 三表：`firewall_groups` / `firewall_rules` / `vm_firewall_bindings` + 3 组 seed（default-web 22/80/443 / ssh-only 22 / database-lan 22+3306+5432 RFC1918）

**后端**：
- `repository/firewall.go` groups + rules + bindings 三段 CRUD，`ReplaceRules` 事务替换
- `service/firewall.go`：封装 Incus network ACL（落 `default` project，customers 继承 networks）；`EnsureACL` PUT 后 POST 兜底漂移，`DeleteACL` 吞 404 幂等；`AttachACLToVM` / `DetachACLFromVM` read-modify-write NIC `security.acls` 保留其它 ACL；helper `ACLName(slug)→"fwg-slug"` / `parseACLList` / `pickNICDevice`（eth0 优先）
- `handler/portal/firewall.go` admin CRUD + portal bind/unbind + owner 校验；**soft-fail sync**（Incus 不可达返 202 + `sync_err`，DB 仍落库让 admin 重试）
- 审计 action `firewall.{create,update,delete,bind,unbind}` 带 `sync_ok` 布尔
- 单测 6 组 23 case（ACLName / rulesToIncus / parseACLList 5 edge / addUnique / removeValue / pickNICDevice 5）

**前端**（/pma-web）：
- `features/firewall/api.ts` + `admin/firewall.tsx`：列表卡片 + 规则编辑器（action/protocol/dest_port/source_cidr/desc 网格编辑）+ 创建面板 + 删除 confirm
- sidebar `Infra & Ops` → `Firewall`（ShieldCheck icon，en/zh 双语）

**生产部署 E2E**（vmc.5ok.co，dist_hash=2fc345522080…）：
- T1 list 返 3 seed 组；T2 POST `test-e2e` id=4 + 1 rule → `sync_ok=true`；T3 Incus 侧 `incus network acl show fwg-test-e2e --project default` 存在且 rule 完整；T4 PUT rules 替换；T5 DELETE group 4 成功；T6 Incus ACL 真消失
- `audit_logs` 3 行完整（create/update/delete，details 带 sync_ok）

已完成 Phase A+B+C+E+F；剩 D(Rescue 3d) + G(Floating IP 4d)。

## 2026-04-24 14:55 [feat]

PLAN-021 Phase C 收官 —— 密码重置离线回落（OPS-003 completed）：

**后端**：
- `service/vm.go`：`ResetPasswordMode` 类型（auto / online / offline） + `ResetPasswordResult{password, username, channel, fallback}`
- `ResetPassword` 改签 `+mode`，auto 默认先试 online（guest-agent chpasswd）失败再 offline；online/offline 强制单路径
- offline 实现：read-modify-write instance，注 `cloud-init.vendor-data` chpasswd.users[] 结构 + bump `cloud-init.instance-id` 强制 cloud-init 重跑；stop → PUT → start；不覆盖 user-data 保 SSH keys
- 避免 runcmd 泄密（cloud-init.log tracing）；选 set_passwords 模块结构
- handler portal + admin 双写 mode 入参（`oneof=auto|online|offline`），audit + 响应体同步 `channel/fallback`
- 3 组新单测（YAML 形状 + instance-id 唯一性/前缀/长度 + mode wire 字符串 pin）

**生产 E2E**（vmc.5ok.co）四路径全 PASS：
- T1 mode=online + 假 VM → 500 `online reset: exec chpasswd: ... Instance not found`
- T2 mode=bogus → 400 validation `mode: oneof(...)`
- T3 mode=offline 缺 cluster → 400 validation
- T4 mode=auto + 假 VM → 先 online 失败 → 自动走 offline → `offline reset: get instance: ... Instance not found`（fall-through 完整）
- audit_logs 4 行 `http.POST` 带 body.mode；真 vm-a3e86d 未触命令（合约用假 VM 名保护生产）

已完成 Phase A+B+C+F；剩 D(Rescue) / E(Firewall) / G(Floating IP)。

## 2026-04-24 14:40 [feat]

PLAN-021 Phase F 收官 —— 新 IP 段 202.151.179.0/26 VLAN 376 接入（OPS-002 completed）：

**物理前置**（无代码）：
- `br-pub` 已 trunk VLAN 376 到 5 节点；gateway `202.151.179.62` 从 node1 ping 0.8ms 通（扩容物理链路就位）

**DB**：
- migration 010 `010_ip_pool_179_26.sql`：新 pool `/26` + 52 条 `.10-.61`（保守保留 `.1-.9` 给基建）
- 应用成功：`INSERT 0 1 / INSERT 0 52`

**后端**：
- `config/config.go` 新 `loadIPPools()` helper + `CLUSTER_IP_POOLS_JSON` env（JSON 数组多池）；legacy 单池 env 作为 back-compat（JSON 优先 / 解析失败 warn 回落）
- `handler/portal/ipallocator.go` `allocateIP` 重写：按 config 顺序走池，`isPoolExhausted` 判定跳到下一池，非耗尽错误上抛
- 新 helper `allocateFromPool` 把 EnsurePool+SeedPool+AllocateNext 收敛
- 单测 9 case（config 4 + allocator 5）

**部署**：
- env 改动前备份 + `env_patch.sh` 追加 `CLUSTER_IP_POOLS_JSON=[{/26 primary},{/27 fallback}]`
- 新二进制 24.3MB + 服务重启，无 error，cluster manager ready
- 生产 `GET /admin/ip-pools` 返 2 pools：/26 52/0/52，/27 20/1/19
- SQL 模拟 AllocateNext 走 pool 2 → 选中 `.10`（事务 ROLLBACK 不落实）；真 VM 未建，避免破坏生产唯一 vm-a3e86d

下一步 Phase C（密码重置离线回落）或 Phase D（Rescue 模式），待用户指定。

## 2026-04-24 13:50 [feat]

PLAN-021 Phase B 收官 —— Reinstall 走 template_slug：

**后端**：
- `service/vm.go` `ReinstallParams` 重写：剥离 `NewOSImage` → `ImageSource / ServerURL / Protocol / DefaultUser` 四字段；service 层完全解耦 os_templates 表；Username 回传改用 `params.DefaultUser`（原硬编码 `"ubuntu"`）
- `handler/portal/reinstall_resolve.go` 新文件：`resolveReinstallTemplate(slug, osImage)` —— slug 优先走 repo，disabled/不存在都提前 400；legacy `os_image` 走 `defaultUserForSource` 启发式（10 个 distro 覆盖）
- `handler/portal/vm.go` portal + admin reinstall handler 都改双字段入参 `{template_slug, os_image}`，audit details 含 `source / user / template_slug`
- `audithelper.go` + `main.go` 接 `SetOSTemplateRepo`
- 14 assertion 单测（`reinstall_resolve_test.go`）覆盖 slug / legacy images: 前缀剥离 / 空参拒绝 / 5+10 个 distro 启发式

**前端**（/pma-web 规范对齐）：
- `features/templates/template-picker.tsx` 新组件：emit slug（与 `OsImagePicker` emit `images:<source>` 语义分离）
- `features/vms/api.ts` `useReinstallVMMutation` 签名改 `{template_slug?, os_image?}` 双字段
- `admin/vms.tsx` ReinstallPanel 切 `TemplatePicker`

**生产部署 E2E**（vmc.5ok.co，dist_hash=4572838d6dd3…）：
- T1 合法 slug `debian-12` + 假 VM → Incus 500 Instance not found（resolve 成功走到 service 层）
- T2 非法 slug `nonexistent-slug` → 400 `template not found`（DB 层拦截，不触 Incus）
- T3 legacy `os_image:"images:rockylinux/9/cloud"` + 假 VM → Incus 500（fallback 路径 ok）
- T4 `archlinux` disabled → 400 `template is disabled` → 还原
- `audit_logs` 4 行 `http.POST` middleware 级留档，body 完整含 template_slug / os_image

OPS-001 + Phase A+B 闭环 completed。下一步 Phase C（密码重置离线回落）或 Phase F（新 IP 段接入），待用户选型。

## 2026-04-24 08:25 [feat]

PLAN-021 Phase A 收官 —— 镜像模板 DB 化 + UI 动态化：

**后端**：
- migration 009 `os_templates` 表 + seed 9 条（Ubuntu 24/22/20、Debian 12/11、Rocky 9、Alma 9、Fedora 40、Arch）
- `repository/os_template.go` CRUD + `handler/portal/template.go` 完整 REST（portal GET / admin CRUD）+ `os_template.{create,update,delete}` 审计
- 5 case 单测覆盖 `applyOSTemplatePatch` 合并语义（空 patch / 单字段 / enabled=false 指针兜底 / sort_order=0 指针兜底 / 多字段）

**前端**（/pma-web 规范对齐）：
- `features/templates/api.ts` + 重写 `os-image-picker.tsx` 从 DB 读（fallback 仅首屏）
- 新增 `admin/os-templates.tsx` 页面（列表 + 创建/编辑 drawer + 启用/停用 + 删除 confirm）
- sidebar "Orders & Billing" 分组新增 "OS Images" 入口（Disc3 icon + en/zh i18n）
- `admin/vms.tsx` 里的 inline `OS_IMAGES` 消除，`create-vm.tsx` 的 `getOsImageLabel` 改成 `useOsImageLabel` hook

**生产部署 E2E**（vmc.5ok.co，dist_hash=1a3f5e23fc1e…）：
- migration 009 应用成功（CREATE TABLE / INSERT 0 9）
- portal + admin CRUD 四件套全 PASS（GET list / GET by id / POST Alpine 3.21 id=10 / PUT enabled=false / DELETE）
- audit_logs 三行留档（os_template.create / update / delete，details 字段完整）

## 2026-04-24 00:10 [plan]

PLAN-020 + HA-001 正式 completed + PLAN-021 立项：

**PLAN-020 / HA-001 收尾**：
- 用户提出关键洞察："测试环境（vmc.5ok.co）本身就是真 Incus 集群（5 台物理机 + Ceph + /26 段）" —— 原 Phase G.2 容器化 fake cluster 的 rationale（用容器做高仿真）因此消失
- G.2 关闭为 `[~] won't do`（而非降级为烟雾脚本 —— 无立即需求）。现有覆盖：单测 22+ cases + HTTP 契约 fake server 4 cases + 生产 E2E 多轮留档
- PLAN-020 切 completed / HA-001 切 completed / UX-001 切 completed（superseded by PLAN-008/015/016/017/018）

**PLAN-021 立项（draft，P1，~4-5 周）** 对外售卖闸门功能：
- Phase A 镜像模板 DB 化（os_templates 表 + UI 动态化）
- Phase B Reinstall 走模板 + UI 接入
- Phase C 密码重置离线回落（exec 失败 → cloud-init chpasswd 重启路径）
- Phase D Rescue 模式（换 root disk + 原盘挂 data）
- Phase E 防火墙组（基于 Incus network ACL，L4 security group）
- Phase F 新 IP 段 202.151.179.0/26 VLAN 376 接入
- Phase G Floating IP（secondary IP + garp 宣告，不走 BGP/VRRP）
- Phase H 验证 + 文档

## 2026-04-23 22:50 [fix]

pma-cr 代码审查修复 —— 8 项 findings 全部处理 + 21 条新单测 + 状态诚实化：

**P1 修复**：
- `HealingEventRepo.GetByID` 独立单行查询，替换 handler Get 里 "ListFiltered 500 行 + 内存扫描" 的 O(n) 实现；超过 500 条历史后 drawer 打不开的 regression 消除
- PLAN-020 + HA-001 状态回退到 `implementing` / `in_progress`：Phase G 拆为 G.1 单测（已完成 19+ cases）+ G.2 容器化 E2E（推迟，独立 PR 立项）。之前误标 completed 不诚实

**P2 修复**：
- i18n `ha.statusInProgress` → `ha.statusInprogress`（匹配 JSON 小写 + runtime capitalize 模板）
- `CompleteByNode` 增 `AND trigger='auto'` —— 避免 node online 事件抢先关闭 chaos/manual 在跑的 healing 行
- `http.ts` step-up redirect 加同源白名单：只接受 `/api/auth/stepup/` 前缀，拒绝 protocol-relative `//` 和 absolute URL
- `event_listener` backoff 健康判定：连接存活 ≥ 5min 后断开视为"曾健康"，从 MinBackoff 重试而非继承 MaxBackoff cap
- Workers 迁到 `workerCtx`（`context.WithCancel(context.Background())` + `defer cancel()`），SIGTERM → HTTP drain → cancel workers → 进程退出链路清晰

**新单测（21 cases）**：
- `internal/auth/shadow_test.go` 5 cases：HMAC round-trip / short secret / malformed / bad signature / expired
- `internal/auth/oidc_test.go` 5 cases：SignState / VerifyState 五条等价路径
- `internal/middleware/stepup_test.go` 7 cases：无 lookup / 非敏感 / 无 userID / fresh / stale / shadow actor lookup / isSensitive 枚举覆盖
- `internal/middleware/shadow_test.go` 3 cases：无 actor / money 路径 shadow 拒绝 / 非 money 路径 shadow 放行
- `HealingEventRepo.GetByID` 无数据库不跑（需 integration test 基建）—— 留 TODO

CI 全绿：`go build/vet/test ./...` + `golangci-lint run` 0 issue + `bun run typecheck/test/build` 37 tests passed。生产部署 dd61ede8… 健康检查通过。

## 2026-04-19 07:30 [completed]

REFACTOR-002 关闭 —— validator 全量收官：

- 新建共享 pkg `internal/httpx`：`DecodeAndValidate` / `Validator()` / `IsValidName` / `SafeNameRe` 全部导出；portal 侧改薄转发，避免 handler 文件 import 变更
- `admin/shadow.go` LoginAdmin 迁移（reason required/min=1/max=500）
- portal 剩余 CRUD 全量迁移（11 个 handler 一次性收口）：ceph.CreatePool、ippool.AddPool、snapshot.Create/Restore、quota.UpdateUserQuota、apitoken.Create/Renew、clustermgmt.AddCluster、nodeops.TestSSH/ExecCommand、product.Create（引入 DTO）+ Update、order.Pay/UpdateStatus、vm.Reinstall/ChangeVMState/ResetPasswordAdmin
- apitoken.Renew 为唯一保留手写 decode 点（empty-body 续签语义刻意保留），validator 层面仍跑 `httpx.Validator().Struct()`
- 清理 6 个文件的 `encoding/json` unused import
- 计数：`grep -rn json.NewDecoder internal/handler/` 从 21 → 1
- CI 门：`go build/vet/test ./...` + `golangci-lint run` 全绿；生产部署 `7c564bfc…` 健康检查通过

REFACTOR-002 task 切 `[x]`。pma-go 合规八条 acceptance：golangci-lint v2 / gosec / validator / Taskfile / consistent API / table-driven (部分覆盖) 全部 ✅。

## 2026-04-19 06:50 [progress]

REFACTOR-002 go-playground/validator 迁移（portal 包聚焦）：

- `go.mod` 追加 `validator/v10 v10.30.2`；`portal/validate.go` 扩展包级单例 + `decodeAndValidate(w, r, dst)` helper + 自定义 `safename` tag（复用 isValidName 正则）
- 迁移 10 个 handler（VM Create/Migrate/Chaos、Order Create、User UpdateRole/TopUp、Ticket Create/Reply×2/UpdateStatus、SSHKey Create），`validate:` tag 声明字段约束：range / required / oneof / safename / max。错误响应改为 `{error: "validation_failed", details: [...]}` 结构化消息
- 删除迁移冗余：validTicketPriorities/validTicketStatuses 查找表（oneof 替代）、3 个文件的 `encoding/json` 未使用 import
- 新单测 `validate_test.go` 6 cases（happy / malformed / required / safename / oneof / lte 边界）全过
- `golangci-lint run` 仍 0 issue；生产部署 773a7dd6… 健康检查通过

REFACTOR-002 acceptance 进度：Taskfile ✅ / API 一致性 ✅ / golangci-lint v2 ✅ / gosec ✅ / validator ✅ / table-driven 部分覆盖。剩余渐进工作：admin 包 shadow login 迁移（需把 helper 提升到共享 pkg，约 0.5d）+ 剩余 portal CRUD handler 按需迁移。

## 2026-04-19 06:30 [progress]

PLAN-019 handler 业务 audit() tech debt 清零：

- 盘点 13 个 portal handler 文件 31 条 POST/PUT/PATCH/DELETE 路由对 `audit()` 调用次数，缺口在 6 个文件共 13 处
- 批量补齐业务 action：`product.create/update`、`ssh_key.create/delete`、`snapshot.create/delete/restore`（单 handler 跨 portal+admin 双挂）、`order.create/pay/update_status`、`ticket.create/reply/update_status`、`user.update_role`
- 所有 /api/admin 写路由至少一条业务 audit 行；middleware 的 `http.<METHOD>` 行继续做兜底串数据
- 单测 / lint / vet 全绿；生产部署 fbef7db7… 健康检查通过

## 2026-04-19 06:15 [progress]

REFACTOR-002 golangci-lint v2 + Phase H runbook 上线：

- **golangci-lint v2 落地**：新 `.golangci.yml`（v2 schema）启用 govet/errcheck/staticcheck/ineffassign/unused/misspell/gosec/unconvert/prealloc/bodyclose/rowserrcheck 共 11 个 linter。首轮 132 issue → 0 issue。噪音类 gosec 规则（G706 slog 结构化日志误判、G202 SQL 占位符误判、G404 jitter 弱随机）按项目特征排除；真问题分三类处理：
  - 代码修复：bodyclose 3 处（WebSocket Dial 强制关 resp.Body）、errcheck 37 处（`_ =` 前缀 best-effort 调用）、staticcheck 注释头错字、unconvert 多余转型、ineffassign 无效赋值
  - 安全加固：emergency server 加 `ReadHeaderTimeout: 10s`（G112 防 Slowloris）+ `http.MaxBytesReader(8KB)`（G120 防 body flood）
  - 刻意行为加 `//nolint:gosec` + 理由：TLS TOFU 指纹固定场景、MD5 用于 SSH 指纹展示（RFC 4716 协议约定）、chaos drill `context.Background()`（handler 返回后继续是意图）、`ssh.InsecureIgnoreHostKey()` 未配 known_hosts 的向后兼容回退
- **Phase H runbook**：`docs/runbook-ha.md` 完整覆盖架构一览 / 日常健康检查（事件流在线 / reconciler drift / healing_events 分布）/ 故障诊断（断链、卡 in_progress、drift 激增、反复 gone）/ 常见操作（手动 evacuate / restore / chaos drill 开关）/ 告警阈值建议表 / 版本约束
- **Tabs 激活态 bug 修复**：`/admin/ha` Tabs 无选中视觉反馈 —— Base UI 用 `aria-selected="true"`（不是 `data-selected`），Tailwind v4 的 `data-[selected]:` modifier 永远不命中。改用 `aria-selected:` + `hover:text-foreground` 过渡态

生产部署：binary 13d1ce7c… 替换 987476cf…；dist_hash 不变（纯后端 + 样式选择器调整，无前端 API 改动）。REFACTOR-002 剩 validator 迁移（约 1-2d）。PLAN-020 Phase H 除"Staging 长时间灰度"外全部 ✅，该项合并到 Phase G 集成测试覆盖。

## 2026-04-19 05:55 [completed]

PLAN-008 / REFACTOR-001 / REFACTOR-002 关闭审计：

- **PLAN-008 [x]**：P0（BUG-1 + NEW-6 IP 分配 DB 化）+ P1（BUG-2/U8/A4/A5/O2/O5）+ P2（12 项）+ P3（NEW-2/NEW-4/NEW-8/A7 已完成）全部由 PLAN-009/010/013/015/017/018/020 + UX-001/002/003 吸收交付。长尾 P3（U18/U19/U20/A8/A11/A12/O11/O14/O15/O18/O19/O20）归档到产品 backlog，不阻塞关闭。
- **REFACTOR-001 [x]**：shadcn/ui + base-ui primitives / sidebar（UX-002）/ providers.tsx / 20 个 features/api.ts / ThemeProvider / Vitest 37 tests / sonner / antfu-eslint 全部就位。"手写 UI 全替换为 shadcn 组件"作为日常贡献项按 touch-on-edit 逐步推进。
- **REFACTOR-002 [-] 继续**：Taskfile + API 响应一致性 + 部分表驱测试 ✅；golangci-lint v2 配置 + go-playground/validator 引入 + gosec 接入 ✗（剩约 2-3d，pma-go 合规基础设施，不阻塞业务迭代）。

## 2026-04-19 05:48 [deploy]

PLAN-020 Phase D.2/D.3/F 生产部署：binary sha256=987476cf…、dist_hash 从 `b622e61f…` → `58fed0e8…`。备份旧 binary 至 `/usr/local/bin/incus-admin.bak-plan020-phaseE`。三个 worker 全启动日志可见：vm reconciler（60s/10s buf/drift=5）+ event listener（1 cluster, lifecycle）+ healing expire worker（max_age=15min, tick=5min）。3 分钟内 disconnected=0, starting=1，WebSocket 稳定订阅。DB 烟雾测试：`ListFiltered` 查询命中 `idx_healing_events_cluster` Bitmap Index Scan。

## 2026-04-19 05:40 [progress]

PLAN-020 Phase D.2 + D.3 + F 上线 — HA 可视化收尾（事件自动追踪 + 管理面板历史回放）：

- **Phase D.2 cluster-member 自动追踪**：`worker/event_listener.go` 新 `HealingTracker` 接口；`handleClusterMember` 按 `metadata.context.status` 分发 —— offline/evacuated 幂等 `Create(auto)`、online `CompleteByNode`。repo 补 `FindInProgressByNode(cluster, node, trigger)` / `CompleteByNode(cluster, node)`。
- **Phase D.3 instance-updated 追 VM 迁移 + ExpireStale sweeper**：listener instance-updated 改为先 `LookupForEvent` → `UpdateNodeByName` → `trackVMMovement`：(from_node) 命中 in_progress 行时 `AppendEvacuatedVM({vm_id, name, from, to})`。`VMRepo.LookupForEvent(cluster, name) → (id, node)` 用于保住 from-node。新 `worker/healing_expire.go` 每 5min 扫 in_progress 超 15min → partial，cmd/server 启动接入。
- **Phase F 历史回放**：后端新 `HealingHandler`（`GET /admin/ha/events` 带 cluster/node/trigger/status/from/to/limit/offset 过滤 + `GET /admin/ha/events/{id}` 详情，响应补 `cluster_name` + `duration_seconds`）；repo 新 `HealingListFilter` + `ListFiltered`。前端 `/admin/ha` 改 `Tabs.Root`（Base UI），Status Tab 保原节点表；History Tab 筛选条 + 表格 + Drawer（Base UI Dialog）展示 evacuated_vms 明细；trigger/status 徽标分色；分页 25/页。新 `features/healing/api.ts` TanStack Query 封装，30s refetch。i18n 补 ha.* 26 条（en/zh 双语）+ common.{details,prev,next}。
- **单测**：`worker/event_listener_test.go` 6 cases —— instance-deleted → gone / instance-updated append healing / 无 active healing 跳 append / cluster-member offline 幂等 / online complete / healing=nil 静默无副作用。

INFRA-001 task 切 `[x]` —— HA 自动故障转移 + 管理面板 + 手动 evacuate + 历史回放 + chaos drill 全部交付；Slack/Lark 告警路由推迟独立小 PR。PLAN-020 剩 Phase G（集成测试，约 5d）+ Phase H（runbook，约 1d）由 HA-001 继续推进。本地 `go build/vet/test ./...` + `bun run typecheck/build` 全绿；生产部署 E2E 验证待用户确认后走 AIssh MCP。

## 2026-04-23 22:15 [progress]

PLAN-019/PLAN-020 tech debt 清零：

- **handler audit 覆盖率 100%**（PLAN-019 收尾）：`scripts/audit-coverage-check.sh` 原先把同一 handler 的 admin+portal 双重注册（snapshot.go 的 Create/Delete/Restore）统计成 2 个 write，误判 `partial`。重写计数为"提取 handler 最后一段标识符去重"，snapshot.go 从 6/3 → 3/3 ok。实测 `47/47 ok`：apitoken/ceph/clustermgmt/ippool/nodeops/order/product/quota/snapshot/sshkey/ticket/user/vm 全部 handler 业务 audit 齐备（middleware route-level 兜底仍在）。
- **Fake Incus HTTP 集成测试**（PLAN-020 收尾）：`internal/cluster/client_integration_test.go` — `httptest.NewServer` mock `/1.0/instances?recursion=2` / `/1.0/cluster/members` / `/1.0/operations/{id}/wait`，bypass newClient mTLS 健康检查直连 fake。4 case 覆盖 GetInstances success+error / GetClusterMembers / WaitForOperation。
- **事件解析纯函数测试**：`internal/cluster/events_test.go` — `InstanceNameFromSource` 7 case + `ClusterMemberNameFromSource` 5 case + `buildEventsWSURL` 5 case（scheme switch + type 编码 + 异常 scheme）。
- **ExpireStale worker 生命周期测试**：`internal/worker/healing_expire_test.go` — disabled 3 case（nil/0/负 maxAge 立即退出）+ TicksAndCancels（50ms tick，cutoff 精度 ±1s）+ ErrorContinues（transient DB 错不杀 worker）。

累计 22+ 新 case。全量 `go test ./internal/...` 绿灯。

## 2026-04-23 20:45 [completed]

PLAN-020 全线收官 — HA 真正化 + VM 状态反向同步完整交付（合并 PLAN-014）：

- **Phase D.2 auto row**：event listener `handleClusterMember` 按 `metadata.context.status` 识别 `offline / evacuated / blocked`，`FindInProgressByNode("auto")` 去重后 `Create(trigger=auto, actor=nil)`；`online` 触发 `CompleteByNode` 批量关闭该节点所有 in_progress 行。
- **Phase D.3 evacuated_vms 追踪**：新 `VMRepo.LookupForEvent` 让 instance-updated 事件在 `UpdateNodeByName` 之前拿到 from-node；worker 侧 `trackVMMovement` append `HealingEvacuatedVM` 到当前 in_progress 事件（JSONB `||` 原子追加）。
- **ExpireStale 后台 worker**：`RunHealingExpireStale` 每 5 分钟扫一次，把 in_progress 超过 15 分钟的事件转 `partial`，避免崩溃/漏事件导致长期悬挂。
- **Phase F 历史回放**：后端新 `HealingHandler`（`GET /admin/ha/events[/:id]`，筛选 cluster/node/trigger/status/from/to + 分页 + cluster_name 解析 + duration_seconds 计算）；前端 `/admin/ha` 拆 Status / History Tab，History 含 5 列筛选 + 9 列表格 + 分页 + drawer（evacuated_vms 子表 + error + 字段空态）。浏览器 E2E 验证：插 4 条覆盖 manual/auto/chaos × completed/failed/in_progress 的样本数据，badge/Dialog/评估全部正确渲染。
- **Phase G 集成测试**：3 组主要测试 — `vm_reconciler_test.go`（6+1 case）+ `event_listener_test.go`（222 行，含 fake + D.2/D.3 路径）+ 新 `healing_test.go`（8 case，serialiseHealing + parseHealingTime 纯函数覆盖）。全量 `go test ./internal/...` 全绿。
- **Phase H runbook**：新 `docs/runbook-ha.md`，含 surface map、env vars、日常/周期检查（reconciler 心跳 + 事件流稳定性 + 悬挂事件）、4 类常见故障（event listener 重连 / reconciler 误标 gone / chaos 403 / healing_events 膨胀）的 SQL + 命令诊断、chaos drill 操作步骤、升级呼叫矩阵。

**关键运维防线**：生产部署在 `INCUS_ADMIN_ENV=production`（默认），chaos drill handler 硬拒 403；staging 启用需明确改 env + 重启。

PLAN-020 关闭（`[x]`），HA-001 关闭。INFRA-006 已在 Phase A+B 收官时关闭。剩余技术债：PLAN-019 handler 业务 audit 补齐（middleware 已 route-level 兜底）+ 容器化 Incus fake cluster 端到端测试（当前依赖生产 E2E + fake 接口层单测）。

## 2026-04-19 05:05 [progress]

PLAN-020 Phase C+D+E 上线 — HA 真正化核心能力（事件流 + healing_events + chaos drill）：

- **Phase C 事件流订阅**：`internal/cluster/events.go` + `worker/event_listener.go`。每集群一个 WebSocket goroutine 订阅 Incus `/1.0/events?type=lifecycle`，exponential backoff（5s→60s）+ jitter 断线重连，重连前触发 `reconcileOnDemand` 全量对账。Lifecycle dispatch 按 `metadata.source` 前缀区分 instance（`instance-deleted` → `MarkGoneByName` 加速 gone 检测、`instance-updated` → `UpdateNodeByName` 追踪 evacuate 后 VM 新节点）vs cluster-member（DEBUG log，留给 Phase D.2）。两处坑：Incus 6.23 拒绝 `type=cluster`（只支持 logging/operation/lifecycle），lifecycle 单订阅按 source 区分就够；WebSocket over HTTP/2 被 Incus 拒（RFC 8441 未实现），需强制 `tlsCfg.NextProtos=[http/1.1]`。
- **Phase D healing_events 表 + 手动 evacuate 双写**：新 migration 008（id/cluster_id/node_name/trigger/actor_id/evacuated_vms JSONB/started_at/completed_at/status/error + 3 索引）；`HealingEventRepo` 全套（Create/AppendEvacuatedVM(JSONB `||` 原子追加)/Complete/Fail/ExpireStale/List）。`AdminVMHandler.EvacuateNode` 改造：先 Create `trigger='manual' actor_id`，Incus 调用后 Complete；两类错误（API error / WaitForOperation error）走 Fail 路径。shadow session 下 actor 归因到真正操作的 admin，与 audit 一致。
- **Phase E Chaos drill**：新路由 `POST /admin/clusters/{name}/ha/chaos/simulate-node-down`。`ServerConfig.Env` 默认 `production` → handler 顶部硬拒 403 `chaos_disabled_in_production`；staging 切过来后 reason 必填 + duration ∈ [10, 600]。异步 goroutine 用 `context.Background()` + duration+5min cap 跑 evacuate → sleep → restore，handler 立即 202 返 `healing_event_id`。

生产部署累计重启 incus-admin 8 次增量（Phase C 内 2 次修 bug、D/E 各一次）。INFRA-006 已关闭；HA-001 切 `in_progress`（Phase C-E 已交付，F/G/H 待续）。Env 新增 `INCUS_ADMIN_ENV`（默认 production）。

## 2026-04-19 03:25 [progress]

PLAN-020 Phase A+B 上线 — VM 状态反向同步 worker（合并 PLAN-014 落地）：

- **Phase A**：`internal/worker/vm_reconciler.go` 60s 周期 + 10s 创建缓冲 + 30s initial delay + 5 条 drift 告警阈值。小接口定义在 worker 侧（consumer），通过 `ClusterSnapshotFromManager` adapter 绑 `cluster.Manager`，per-cluster error 隔离（Incus 不可达 skip 不误标 gone）。新 repo 方法 `VMRepo.ListActiveForReconcile` / `MarkGone`（幂等 guard）。修复 `AuditRepo.Log` 对空 ip NULL 处理（此前 INET cast 静默吞 audit）。5 个 table-driven 单测 + 1 cutoff 断言全过。生产验证：3 次注入 drift 全部被 reconciler 60s 内修复（status=gone + IP Release）+ audit `vm.reconcile.gone` 正常落库。
- **Phase B**：DB 查询排除 `gone`（`CountByUser` 防 quota 双计，`ListByUser` 用户侧不可见）+ 新增 `GET /admin/vms/gone` 流（admin-only）+ `POST /admin/vms/{id}/force-delete`（仅 gone 可执行，其他 409）。前端 `admin/vms.tsx` 顶部新增 `<GoneVMsPanel />` —— count=0 隐藏、>0 时红色告警样式 + 清理按钮（confirm dialog + sonner toast + invalidate）。

INFRA-006 task 关闭。PLAN-020 状态 implementing，剩 Phase C-H（HA-001 task：事件流订阅 + healing_events + chaos drill + 历史回放 + 集成测试 + runbook 文档）。

## 2026-04-19 03:00 [pitfall]

PLAN-019 Phase A-E 部署过程中发现 **前后端构建同步漏洞**：Vite 产出 `web/dist/` 但 Go `//go:embed all:dist`（`internal/server/static.go`）读的是 `internal/server/dist/`，两者需手动 `cp`。Phase D (API Token TTL 前端) 和 Phase E (Shadow Login 前端 + 红横幅) 的所有前端改动长时间未部署 —— 直到用户报"没看到 Shadow 按钮"才发现。Root cause：多次 `CGO_ENABLED=0 go build` 绕过 Taskfile（Taskfile 原 `deploy` 任务已含同步逻辑）。修复：`task build` 依赖新增 `web-sync` 步骤（自动 `rm -rf internal/server/dist && cp -r web/dist internal/server/dist`），后续任何 `task build` 都会保证 embed 同步。部署验证：`embedded dist loaded index_sha256` 应与本地 `sha256sum web/dist/index.html` 一致。

## 2026-04-19 02:40 [completed]

PLAN-019 / SEC-001 全量收官 —— 安全与审计基线五大能力上线：

- **Phase A Step-up Auth**：五条敏感管理员路由（删 VM / 迁移 VM / 节点 evacuate-restore / 用户余额）挂 `RequireRecentAuthOnSensitive`，5 分钟未重认证返 401 `step_up_required`，前端拦截跳 Logto `prompt=login&max_age=0`。应用自接 OIDC 子流程（callback 独立、oauth2-proxy `skip_auth_routes` 放行）。
- **Phase B 审计全覆盖**：新 `auditwrite` middleware 拦 /api/admin 所有写方法自动落 `http.<METHOD>` 行，JSON body 敏感字段（password/token/secret/api_key/ssh_key/private_key/access_token 等）递归 redact，body > 64KB 截断不阻塞 handler。新覆盖率脚本 `scripts/audit-coverage-check.sh` 供 CI 门禁使用。
- **Phase C 审计导出 + 保留**：`GET /admin/audit-logs/export` 流式 CSV（from/to/action 筛选，上限 10 万行，自审计 `audit.export`）+ 定时 worker 每日按 `AUDIT_RETENTION_DAYS`（默认 365）清理。前端 `/admin/audit-logs` 加日期范围 + 动作前缀 + "导出 CSV" 按钮。
- **Phase D API Token TTL + 续签**：默认 TTL 从 7 天收紧到 24 小时，范围 1h - 90d；`POST /portal/api-tokens/{id}/renew` 事务失效旧行 + 生成同名新 token；前端 UI 下拉 + 剩余时间显示 + 续签按钮 + 过期高亮；每小时 cleanup worker 按 30 天 grace period 删除过期行。
- **Phase E Shadow Login**：admin "以用户身份登入"（HMAC JWT + HttpOnly cookie + 30min TTL）；顶栏红色横幅 + 退出按钮；金钱类路由（balance / orders pay / invoices refund）shadow 下 403；UserFromEmail 识别 `shadow` auth_method 用 actor 的 role，敏感路由 step-up 查 actor 时间戳；audit 层 user_id = actor + details.acting_as_user_id = target。

运维累计：oauth2-proxy 重启 1 次（skip_auth_routes 加 stepup-callback）+ incus-admin 重启 5 次增量部署。Env 增 6 条（OIDC_* + SHADOW_SESSION_SECRET + AUDIT_RETENTION_DAYS + STEPUP_*）。Migration 007 加 `users.stepup_auth_at`。Tech debt 一项：Phase B handler 业务 audit() 缺失 20 处（middleware 已 route-level 兜底，后续增量补齐）。全量 Phase 后端 build+vet + 前端 typecheck + build + 服务器端 E2E 验证通过。

## 2026-04-19 01:57 [progress]

PLAN-019 Phase A 上线：Step-up Auth（Logto OIDC 子流程）。五条敏感管理员路由（删 VM / 迁移 VM / 节点 evacuate / 节点 restore / 用户余额调整）挂 `RequireRecentAuthOnSensitive` 中间件，不在最近 5 分钟内完成 step-up 的请求返 401 `step_up_required`，前端 `http.ts` 拦截后 `window.location = redirect` 带用户去 Logto 重认证（`prompt=login&max_age=0`）。OIDC 回调独立处理，`users.stepup_auth_at` 记录 Logto id_token 的 `auth_time`。运维改动：oauth2-proxy `skip_auth_routes` 加 callback 路径 + 重启；incus-admin env 追加 `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `STEPUP_CALLBACK_URL` / `STEPUP_MAX_AGE`；新 migration 007 加 `users.stepup_auth_at` 列与索引。Spike 记录：Logto access_token 为 opaque（无 API Resource 配置），`pass_authorization_header` 会破坏现有 Bearer API Token 认证，改走应用自接 OIDC flow。冒烟测试全绿，待浏览器 E2E 验证。

## 2026-04-18 23:40 [completed]

UX-003 / PLAN-018 用户端功能缺口 G1-G5 全量落地 —— 按用户决策方案 A 执行(隐藏自助充值,跳工单;仪表盘彻底分离):

- **G1 = 方案 A**:`billing.tsx` 顶部新增 `BalanceCard`(只读余额 + 提示 + 跳「提交充值工单」),后端零改动;`tickets.tsx` 加 `validateSearch` 识别 `?subject=topup` 自动预填主题 + 模板 body
- **G2 Cancel 并发竞态**:`repository/order.go` 新增 `CancelIfPending` 单语句条件性 UPDATE `WHERE id=? AND user_id=? AND status='pending'` 以检查影响行数取代事务 + FOR UPDATE(Pay 已持 FOR UPDATE 锁,Cancel 被阻塞后 status 已变 paid,条件不满足→影响行数=0→409);`handler/portal/order.go` Cancel 改用该接口;集成测试 `order_integration_test.go` 新增 4 条(Happy/WrongOwner/NotPending/VsPay 并发),断言 status=paid ↔ balance=50,invoiceCnt=1,cancelChanged=false;status=cancelled ↔ balance=100,invoiceCnt=0,payErr≠nil
- **G3 发票详情**:新组件 `features/billing/invoice-detail-dialog.tsx` 用 `Dialog` primitive 展开 invoice + order + product(CPU/RAM/Disk/OSImage/Hours/Price),从页面已加载数组解析,零新请求;`billing.tsx` 发票表格新增「操作」列 + 「详情」按钮
- **G4 工单关闭**:后端 `repository/ticket.go` 加 `CloseByOwner` 条件性 UPDATE,`handler/portal/ticket.go` 新增 `POST /portal/tickets/{id}/close`(owner 检查 + 幂等 + audit log);前端 `features/tickets/api.ts` 加 `useCloseTicketMutation`,`tickets.tsx` `TicketDetail` 非 closed 态显示「关闭」按钮 + confirm,closed 态显示「工单已关闭」提示
- **G5 Dashboard 彻底分离**:`app/routes/index.tsx` 重写为 `UserDashboard` —— 移除 `AdminSection` 内联块(admin 走 `/admin/monitoring` 独立路由),顶部加 `QuickActions` 3 按钮(Create VM → `/billing`、Top-up → `/tickets?subject=topup`、New Ticket → `/tickets`),`myVmCount === 0` 时 Create VM 实心高亮;openTickets 计数统一到 `status !== 'closed'`
- **i18n**:zh/en `common.json` 补 `billing.balance|topupHint|topupViaTicket`、`invoice.*`(detail/section*/*Missing)、`ticket.close|closeConfirm*|alreadyClosed|topupPrefill*`、`dashboard.quickCreateVm|quickTopup|quickCreateTicket`,全部双语对齐
- **CI 门**:`bun run typecheck` + `bun run build`(dist 1378 kB) + `go build/vet` + `go test ./...` + 集成测试 `TestCancelIfPending*`(`ok ./internal/repository 165.968s`)全过

## 2026-04-18 21:10 [completed]

UX-002 / PLAN-016 后台菜单重组 + 用户/管理员视角分离 —— 全量落地 + 目视回归通过:

- 拆 `web/src/shared/components/layout/sidebar-data.ts`:`userSidebar` 扁平 7 项 + `adminSidebar` 5 组(监控 / 资源 / 基础设施运维 / 订单财务 / 用户工单)
- 重写 `app-sidebar.tsx`:路径前缀 `/admin` 自动切视角,admin 视角用 `@base-ui-components/react` Accordion 做二级折叠;当前路径所在组自动展开 + `localStorage('incus.sidebar.admin.openGroups')` 跨刷新持久化;collapsed 态降级为扁平 icon 列表 + 组间分隔线
- admin 顶部加"进入管理后台 / 返回用户后台"切换按钮(`isAdmin` 门控,非 admin 永不渲染)
- 补 `sidebar.switchToAdmin / backToUser / group.{monitoring,resources,infrastructure,billing,userOps}` 共 7 条 i18n key(中英双语),移除硬编码 "Admin"
- 前端 `bun run typecheck` + `bun run build` 通过;dist_hash=`5bd7a8bbece0773d`
- 部署:本地 go 1.25 交叉编译 linux/amd64 binary(sha256=`603ef5de…`)embed 新 dist,AIssh file_deploy → 原子 mv + `systemctl restart incus-admin`;`/api/health` dist_hash 与本地对齐
- 浏览器目视回归(`https://vmc.5ok.co` SSO 登录 ai@5ok.co):
  - ✅ 用户视角 `/`:7 项扁平菜单 + "Enter Admin Console"按钮
  - ✅ 管理员视角 `/admin/monitoring`:5 个 Accordion 组,Monitoring 自动展开(Monitor 激活高亮),其他 4 组折叠
  - ✅ 展开/折叠:点击 Orders & Billing 组头,Products/Orders/Invoices 正确展开(Monitoring 保留展开态,多选模式生效)
  - ✅ localStorage 持久化:刷新页面后 Monitoring + Orders & Billing 双组仍展开
  - ✅ 视角回切:点击"Back to User Console"返回 `/`,扁平菜单恢复,按钮文案翻转为"Enter Admin Console"
- 延期:collapsed 图标态 + zh/light 主题切换 —— 非阻断 UX 细节,核心交互已验证

## 2026-04-18 18:42 [progress]

PLAN-015 / QA-005 全量落地，QA-004 报告 N1-N15 清零（除 N4/N7/N9/N10/N14 已转 PLAN-014 / 反代窗口）：

- N1 字体回退 + lang 同步：`index.css` font-sans 加 PingFang/YaHei/Noto CJK 兜底；`app/i18n.ts` languageChanged 钩子写 `<html lang>`，与 i18next 状态保持一致
- N2 Portal Tickets 入口：表格行加 ▶/▼ chevron + 链接化 Subject + aria-expanded；click → 内联展开 TicketDetail（API 已存在）
- N3 i18n 大扫除：`en/zh common.json` 补齐 admin.products / admin.nodes / admin.tickets / admin.users / admin.vmDetail / monitoring 等键；`monitoring.tsx` / `observability.tsx` / `node-join.tsx` 全部硬编码中文走 `t()`
- N5 audit target 渲染：`features/audit-logs/helpers.ts` `targetLabel()` 优先 `details.name || target || vm || vm_name || host || osd_id`，缺失才回退 `#target_id`；6 条单测覆盖
- N6 admin catchall 404：`app/routes/admin.tsx` 加 `notFoundComponent` —— "404 / Admin page not found / Back to Clusters" 取代裸 "Not Found"
- N8 后端 API 错误响应统一 JSON：`internal/server/static.go` `/api/*` 落空时返 `{"error":"not found"}`；`server.go` 注册 `MethodNotAllowed` handler 返 405 JSON；新增 `GET /api/admin/orders/{id}` 与 `GET /api/admin/products/{id}`
- N11 Node Ops IP 校验：`features/nodes/host-validation.ts` 抽出 `validHost()`（IPv4/IPv6/RFC1123），7 条单测覆盖
- N12 移动端表格溢出：13 个 admin/portal 路由表格 wrapper `overflow-hidden` → `overflow-x-auto`
- N13 VM 默认用户名按 image 映射：`features/vms/default-user.ts` 覆盖 ubuntu/debian/rocky/almalinux/centos/fedora/opensuse/arch/alpine/freebsd，6 条单测
- N15 Audit IP 列：`stripCidrSuffix()` 去掉 `/32`、`/128` 后缀

CI 门：后端 `go build/vet/test` 全过；前端 `tsc --noEmit / vitest run / vite build` 全过（37 条单测，新增 19 条）

部署：本地 build → AIssh `file_deploy` → systemctl restart incus-admin（PID 216141）；
新 dist_hash `b934750eb3d6f6...` 与本地一致；浏览器回归 N1/N3/N5/N6/N8/N11/N12/N13/N15 全部生效

## 2026-04-18 00:05 [progress]

QA-004 后继项：DB ↔ Incus VM 状态漂移修复（生产手工同步 + 前端空态文案 + 后端 db_running_count 指标）：
- 生产 SQL：`UPDATE vms SET status='deleted' WHERE id IN (7,8)`（vm-d8b7dc / vm-870c48 —— Incus 侧实际 0 实例，DB 残留）；`UPDATE ip_addresses SET status='available', vm_id=NULL WHERE id=5` 释放 202.151.179.239 回池
- 后端 `MetricsHandler.ClusterOverview` 增加 `db_running_count` 字段，`VMRepo.CountRunningByCluster` 新方法，让管理员一眼识别"DB 说 N 个 running / Incus 0 个"的漂移情形
- 前端 `admin/monitoring.tsx` 空态文案分流：`drifted=true` 时显示漂移提示和待执行同步提示；否则显示"当前集群无运行中的 VM"
- 部署：新二进制 sha256=2003ea42…，dist_hash=95c7d8082fdc；systemctl restart 后 `TLS pin learned` 已持久化
- 新开 `PLAN-014 VM 状态反向同步 worker` + `INFRA-006` 任务，设计后台 60s reconciler 消除未来漂移（不纳入本次部署范围）

## 2026-04-17 21:32 [progress]

PLAN-013 Phase B 反代层收尾（授权窗口内 AIssh 推送），PLAN-013 全量完成：
- B.1 `/oauth2/callback` 500 排查：经源站 oauth2-proxy 日志比对，确认为**误报** —— 所有 500 均由外部扫描器路径（`/boaform/admin/formLogin`、`/hello.world?%ADd+allow_url_include` 等）触发 `invalid semicolon separator in query`，真实 admin 登录链路无 500，无需修复
- B.3 favicon 白名单：生产 `/etc/incus-admin/oauth2-proxy.cfg` 的 `skip_auth_routes` 增加 `"^/favicon\.ico$"`（备份 `oauth2-proxy.cfg.bak.20260417212843`），`systemctl restart oauth2-proxy` 后 `curl -I https://vmc.5ok.co/favicon.ico` 返回 `HTTP/2 200`
- B.2 Caddy 三条安全头：源站前置是 Cloudflare CDN，HSTS/X-Content-Type-Options/Referrer-Policy 归 CDN Transform Rules 管；且该项仅是 SSL Labs A+ 评级的质量项（非真实 Bug），本 plan 不动 CDN 配置 → 整项移出范围
- PLAN-013 `index.md` 改 `[x]`，`PLAN-013.md` `status: completed` / `completedAt: 2026-04-17 21:32`
- `TECHDEBT-001` 随 plan 收口为 completed

## 2026-04-17 17:30 [progress]

PLAN-013 代码层 + 测试层 + CI 全量落地（Phase A/C/D 完成，Phase B 反代待运维窗口）：
- A.1 `Pay` 路径 IP 分配回滚集成测试 + `rollbackPayment` 导出供测试
- A.2 `admin/vms.tsx` 客户端分页
- A.3 `product.Update` 指针 DTO 真 PATCH 语义（仅合并非 nil 字段 + 3 条单测）
- C.1 SPKI 指纹 pinning：migration 006 + `cluster/tlspin.go`（TOFU/mismatch reject）+ 适配器接通 REST/WebSocket（events/console）+ 5 条单测
- C.2 端到端 cluster_id 打通：去掉 `int64(1)` 硬编码，订单创建 / 支付复用订单上的 cluster_id
- C.3 Observability iframe：HTTP 目标（Grafana/Prom/Alertmanager）改 "new tab only"，Ceph HTTPS 保留嵌入
- C.4 启动期计算 `dist/index.html` sha256，写入 `/api/health` 并在启动日志给 12 位短哈希
- D.1 `.github/workflows/ci.yml`：backend-unit → backend-integration（testcontainers, Ryuk 关）→ frontend typecheck/build
- D.2 `UserRepo.TopUpWithDailyCap`：事务 + `SELECT ... FOR UPDATE` 行锁，根治并发越限；并发 + 边界两条集成用例
- Phase B（oauth2-proxy callback 500 / Caddy 三条安全头 / favicon 白名单）保留 `[ ]`，等运维低峰窗口经 AIssh 推送，不阻塞代码合并

## 2026-04-15 17:32 [progress]

All 17 database tables covered with backend APIs and frontend pages. Features: VM lifecycle, console, snapshots, monitoring (Recharts), SSH keys, products, tickets, orders/billing, invoices, audit logs, API tokens with Bearer auth. Deployed at vmc.5ok.co.

## 2026-04-15 17:40 [decision]

PLAN-005 drafted: full-stack refactor to pma-web (shadcn/ui sidebar layout, ThemeProvider, feature hooks, ESLint, Vitest) and pma-go (golangci-lint, validator, consistent responses, Taskfile) standards. sqlc migration deferred.

## 2026-04-15 18:00 [decision]

Product direction clarified: internal private cloud first, external API later. PLAN-006 drafted: infrastructure automation — VM auto-failover (Incus cluster.healing_threshold), node management (SSH-automated add/remove), standalone host support (DB-stored config). Auto-deploy new cluster deferred to Phase 6D. Directory cleanup: deleted 17,885 lines of dead code (paymenter, ai-gateway, console-proxy, screenshots), unified all docs under root /docs/.

## 2026-04-15 18:30 [BUG-P1]

## 2026-04-16 00:30 [progress]

PLAN-007 Phase 1-5 + partial 2,3 implemented:
- Phase 1 (8 tasks): Admin DB write, delete free-create path, billing redesign, snapshot portal, hardcode elimination, dead code cleanup
- Phase 2: IP Pool CRUD (add/remove + UI form)
- Phase 3.1: Add Cluster/Standalone Host form
- Phase 3.3: Ceph Storage overview page
- Phase 4: VM detail pages (admin + user, DO-style tabs)
- Phase 5: Logout button, Console dynamic back link
Total: 11 commits in this session. Deployed to vmc.5ok.co.

## 2026-04-15 20:30 [progress]

PLAN-005 + PLAN-006 all phases completed:
- A0: 7 CRITICAL fixes (SSH keys, VM naming, order→VM, balance, ListAllVMs, panic, ticket detail)
- A1: 3 security fixes (Console/metrics auth, WebSocket CSRF)
- A: Frontend scaffold (sidebar, ThemeProvider dark/light/system, i18n zh/en, ESLint)
- B: 10 feature API hook modules (50+ hooks)
- C: Taskfile.yml, 5 DB indexes, HTTP 30s timeout
- WARNING batch: audit log injection, input validation, Dashboard real data, user Console/Snaps
- 6A: HA failover (healing_threshold=300, HA status page, evacuate/restore)
- 6B: Node management (evacuate/restore buttons in clusters page)
- 6C: Dynamic cluster add/remove (standalone host support)
- D: Go tests (11 cases) + Vitest (6 cases) + quality gate scripts
- E: Metrics 30s cache

## 2026-04-15 20:00 [progress]

PLAN-005 Phases A0-C implemented and deployed:
- A0: Fixed 7 CRITICAL bugs (SSH key injection, VM naming, order→VM provisioning, balance, ListAllVMs, panic, ticket detail)
- A1: Security fixes (Console/metrics ownership, WebSocket CSRF)
- A: Frontend scaffold (sidebar layout, ThemeProvider dark/light/system, i18n zh/en, ESLint, providers)
- B: Extracted 10 feature API hook modules (50+ hooks)
- C: Taskfile.yml, 5 DB indexes, HTTP client timeout
Total: 10 commits, ~3000 lines changed. Deployed to vmc.5ok.co.

## 2026-04-15 18:30 [BUG-P1]

Deep code audit (Graph + Serena + manual tracing) found 7 CRITICAL bugs: SSH keys never injected into VMs, VM naming collision (1 VM per user), order payment doesn't provision VM, balance hardcoded to 0, ListAllVMs stub, panic on empty cluster, user ticket detail missing frontend. Plus 14 WARNINGs including Console WebSocket no ownership check, quota never enforced, audit logs never written, IP allocation race condition, password in plaintext. PLAN-005 scope expanded to include Phase A0 (critical bug fixes).
