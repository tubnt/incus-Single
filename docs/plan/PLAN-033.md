# PLAN-033 添加节点自动化 —— 凭据多形态 + 自动探测向导

- **status**: completed
- **createdAt**: 2026-05-03 13:50
- **approvedAt**: 2026-05-03 15:30
- **completedAt**: 2026-05-03 17:55
- **priority**: P1
- **owner**: claude
- **task**: [OPS-039](../task/OPS-039.md)
- **referenceDoc**: PLAN-026（集群节点 UI）/ PLAN-028（bonded NIC + skip-network）/ OPS-022（凭据加密）

## 现状

### 用户当前必填项（`web/src/app/routes/admin/node-join.tsx:45-370`）

| 字段 | 说明 | 痛点 |
|---|---|---|
| `node_name`、`role` | 节点名 + controller/worker | 合理 |
| `public_ip` | 公网入口 IP | 运维要现查 |
| `ssh_user` + `ssh_key_file` | **私钥必须预先放在 admin 服务器固定路径** | 不支持密码、不支持上传/粘贴；门槛极高 |
| `nic_primary` / `nic_cluster` / `bridge_name` | NIC 名 | 运维要登机查 `ip link` |
| `mgmt_ip` / `ceph_pub_ip` / `ceph_cluster_ip` | 内网 IP | 全靠人脑记忆 / 表格 |
| `skip_network` | 跳过网络配置 | 反过来要求"运维已经自己配好" |

### 后端（`internal/handler/portal/clustermgmt.go:398-497`）

`POST /clusters/{name}/nodes` → 同步创建 `cluster.node.add` job → 9 步流水线执行，已经异步化、SSE 推进度（`internal/service/jobs/cluster_node_add.go:75-210`），失败可重试。

### SSH 链路（`internal/sshexec/runner.go`）

`Runner` 仅支持 `keyFile`，**不支持密码认证、不支持内存中的私钥内容**（runner.go:38-83，强制 `os.ReadFile(r.keyFile)` + `ssh.ParsePrivateKey`）。已有 `WriteFile`/`Run`/`StreamRun`/known_hosts 严格校验。

### 业界基线（详见上一轮 investigate 输出）

| 方案 | 凭据形态 | 自动化深度 |
|---|---|---|
| Proxmox VE | Join Information 串 + 集群密码 | 网络/证书/quorum 全自动 |
| Rancher | 一行 `docker run` token | 反向 agent 注册 |
| MAAS | IPMI 用户名密码 | 自动 PXE 探测 enlistment |
| Incus 原生 | 一次性 join token | `incus admin init` 自动应答 |

> 共性：**凭据收口为可吊销/可一次性的形态；网络拓扑靠探测/模板而非键盘输入**。

## 方案

总体方向：**保留现有 9 步执行链，新增"凭据 + 探测"前置层**，UI 由"12 字段输入"改为"3 字段输入 + 1 字段确认"。不做反向 agent（架构改动太大，留 P2）。

### Phase A — 后端凭据多形态（`internal/sshexec` + 加密 + DB）

A1. **`Runner` 支持三种 auth**（实际影响 6 处调用：`cluster_node_add` ×2 / `cluster_node_remove` ×1 / `nodeops.go` ×2 / `ceph.go` ×1）
- 保留 `New(host, user, keyFile)` 兼容老调用点；`ceph.go` 把 Runner 当 struct field 长期持有，本期不动。
- 新增 `NewWithCredential(host, user, cred Credential)`，`Credential` 是 sum type：
  ```go
  type Credential struct {
      Kind       CredKind // CredKindPassword | CredKindPrivateKey | CredKindKeyFile
      Password   string   // Kind=password
      KeyData    []byte   // Kind=privateKey（内存私钥 PEM）
      KeyFile    string   // Kind=keyFile（向后兼容）
      Passphrase string   // 私钥加密时
  }
  ```
- `Run` / `RunStream` / `WriteFile` / `RunArgs` 内部把 `Credential` 转成 `[]ssh.AuthMethod`：
  - password → `ssh.Password(...)`
  - privateKey → `ssh.ParsePrivateKey(KeyData)` 或 `ssh.ParsePrivateKeyWithPassphrase`
  - keyFile → 现行逻辑
- **内存清零**：`Runner.Close()` 调用 `crypto/subtle` 风格手动 zero out `Password` 字符串底层 bytes 与 `KeyData` slice（防 process 内存 dump 泄露）。
- **TOFU host key 采集（BLOCKER）**：新增 `Runner.FetchHostKey(ctx)`，先用 `ssh.InsecureIgnoreHostKey()` + 一次性 banner 抓 server host key 指纹。前端 wizard step 1.5 展示指纹让用户确认，确认后 `Runner` 切到严格 known_hosts。**否则首次添加节点必撞 `knownhosts.New` 拒连**（`runner.go:296-310`）。

A2. **凭据 DB 模型**（复用 OPS-022 加密栈 `internal/auth/password_crypto.go`）
- 新 migration `db/migrations/018_node_credentials.sql` 建表 `node_credentials`：
  ```sql
  CREATE TABLE node_credentials (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('password','private_key')),
    ciphertext  TEXT NOT NULL,         -- v1:<base64> 由 auth.EncryptPassword 产出
    fingerprint TEXT,                  -- 私钥 SHA-256 指纹（密码模式留空）
    created_by  BIGINT NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    UNIQUE (created_by, name)
  );
  ```
- 新 repository `internal/repository/node_credential.go`：`Create / List(byUser?) / GetForUse / Delete / TouchUsed`。
- 新增 endpoint，全部要求 step-up（`internal/middleware/stepup.go` 已有装饰器）+ admin role：
  - `POST   /admin/node-credentials`（保存；body 含明文 password 或 PEM，server 端立即加密）
  - `GET    /admin/node-credentials`（列表；只返 `id/name/kind/fingerprint/last_used_at`，**不返 ciphertext**；可选过滤 `?owner=me`）
  - `DELETE /admin/node-credentials/{id}`（仅 owner 或 super-admin）
- **审计**：create / use / delete 三段都写 `node.credential.*` audit。
- **一次性凭据**：UI 选"本次不保存" → 后端不入 `node_credentials`，直接 marshal 到 `Params.InlineCredential`（仅本次 job 生命周期持有）。

A3. **`jobs.Params` 凭据扩展 + in-memory 风险缓解**
- `executor.go::Params` 加字段：`CredentialID *int64`（已存）+ `InlineCredential *sshexec.Credential`（一次性）。**`SSHKeyFile` 字段保留**，与新字段二选一（兼容 RemoveNode 用全局 default 的现状）。
- **风险**：`Runtime.params` 是 in-memory map（`runtime.go:46`），进程崩溃 → sweeper recoverStale 把 job 翻 `partial` → 触发 `Rollback`。Rollback 仅 force-remove cluster member，远端 apt/netplan 已写入不回滚 → **节点处于残留状态**。
- **缓解**：
  1. 文档 + UI 显式提示「密码模式下 30min 内 admin 重启会失败,需手工清节点重试」。
  2. 推荐用户首选「凭据入库」+ 复用，避免 inline-only 路径。
  3. `takeParams` 时对 inline credential 做 zero out（防内存常驻）。
  4. **不引入 params 持久化**（DB 漂移、加密、迁移成本远超收益）。

A4. **node-remove 不变**（避免误解）
- `cluster.node.remove` SSH 进 leader（已存在的成员），凭据用全局 `CEPH_SSH_KEY` 默认即可，**与本期改造无关**。Phase A1/A2 只升级 add 路径与 nodeops；remove 路径维持原签名。

### Phase B — 后端节点探测（`internal/service/nodeprobe/`）

B1. **探测脚本**（`cluster/scripts/probe-node.sh`，`go:embed` 嵌入；幂等只读、无 apt 写操作）
- **关键决策**：探测脚本**不依赖 `jq`**。`ip -j addr show` / `ip -j link show` 等 JSON 输出由脚本原样回传 stdout，**JSON 解析全部在 admin 进程内 (`encoding/json`) 做**。这样规避 jq 缺失 + apt-install 不幂等 + 无网络节点的三重坑。
- **关键决策**：`ip route` JSON 输出在 iproute2 < 5.0（Debian 10 / Ubuntu 18.04）不可用。脚本对 `ip route` 用文本输出 + admin 端正则解析 default route；其余 `ip -j addr/link` 在 iproute2 ≥ 4.13 全部可用，覆盖项目所有目标平台（Ubuntu 22.04/24.04 = iproute2 5.x/6.x）。
- 脚本输出格式：`---<section>---` 分隔多个 raw 段，admin 端按 section 拆解：
  ```
  ---hostname---
  node6
  ---os-release---
  <raw /etc/os-release>
  ---kernel---
  <uname -r>
  ---cpuinfo---
  <lscpu -J>
  ---meminfo---
  <head /proc/meminfo>
  ---ip-link---
  <ip -j link show>
  ---ip-addr---
  <ip -j addr show>
  ---ip-route---
  <ip route show default>
  ---disks---
  <lsblk -J -o NAME,SIZE,ROTA,MODEL>
  ---incus-version---
  <incus --version 2>/dev/null || echo MISSING>
  ---ceph-version---
  <ceph --version 2>/dev/null || echo MISSING>
  ```
- 全脚本 < 60 行 bash，`set -eu`，运行时不创建持久文件。

B2. **探测服务**（`internal/service/nodeprobe/probe.go`）
- 公开类型 `NodeInfo`（schema 与原 PLAN-033 一致：hostname / os / cpu / memory_kb / interfaces[] / default_route / public_ip_observed / disks / incus_installed / ceph_installed）。
- `func Probe(ctx, runner *sshexec.Runner) (NodeInfo, error)`：
  1. `runner.WriteFile(/tmp/probe-XXXX.sh, embeddedScript, 0o755)`
  2. `runner.Run("bash /tmp/probe-XXXX.sh && rm -f /tmp/probe-XXXX.sh")` —— 超时 15s（context 控制）。
  3. 按 section marker 切片，分别 `json.Unmarshal` 到对应中间结构。
  4. 启发式后处理：合并 `ip-link` 的 bond/master 信息 + `ip-addr` 的 IPv4 → 每条 interface 的 `addresses` / `slaves` / `is_default_route`。
- **bond 检测**：`ip -j link show` 返回的元素含 `linkinfo.info_kind == "bond"` 与 slaves 的 `master` 字段；解析逻辑参考 `iproute2/json_print.c` 输出格式。
- **错误分类**：分别返回 `ErrConnRefused / ErrAuthFailed / ErrNoIPRoute / ErrParse`，让前端给出对应文案而非笼统报错。

B3. **探测 endpoint**（`internal/handler/portal/clustermgmt.go`）
- `POST /clusters/{name}/nodes/probe-host-key`：返 `{fingerprint_sha256, key_type}`，**用 `InsecureIgnoreHostKey()` 一次性抓取**，不入 known_hosts；用户在 UI 确认后才进入 probe 步骤。
- `POST /clusters/{name}/nodes/probe`：
  - 入参：`{host, port?, ssh_user?, credential_id? | credential_inline?, accepted_host_key_sha256: required}`
  - server 端：① 校验 `accepted_host_key_sha256` 与实时 host key 一致（防 TOCTOU）② 走 probe service ③ audit `node.probe.*`
  - 出参：`NodeInfo` JSON + `probe_id`（10min TTL 缓存到 in-memory，给 step 3 提交时复用）
- **限流**：每用户 6 req/min（`golang.org/x/time/rate`），防狂点。
- **TOFU 写入**：当 add-node job 启动时,把 `accepted_host_key_sha256` 追加到运行时 `known_hosts` 文件（写入路径由 env `INCUS_ADMIN_KNOWN_HOSTS_FILE` 决定，文件锁 `flock` 防并发）。

### Phase C — 前端向导（`web/src/app/routes/admin/node-join.tsx` 重构）

C0. **状态机**（`useReducer` 替代当前 `jobId` 二态切换）
```ts
type Stage = 'cred' | 'fingerprint' | 'probing' | 'confirm' | 'job';
type State = { stage: Stage; cred?, hostKey?, probe?: NodeInfo, jobId?: number };
```
- `Stage='job'` 时挂 `JobProgress`，沿用 SSE / `useJobStream`（`web/src/features/jobs/use-job-stream.ts`）。
- 持久化：`probe` + `cred.id`（不持久化 inline 密码 / PEM）写 `sessionStorage`，关页重开自动跳到 `confirm`。

C1. **四步 wizard**（用现有 shadcn/ui base-nova，无新依赖）
- **Step 1 — 凭据**
  - 字段：`host` / `port`(默认 22) / `ssh_user`(默认 root) / 凭据三选一：
    - 密码（`<input type="password" autocomplete="off">`）
    - 私钥粘贴（`<Textarea autocomplete="off" spellcheck="false">`，PEM 头校验：`-----BEGIN .* PRIVATE KEY-----`）
    - 选择已存凭据（下拉，列表来自 `GET /admin/node-credentials`，按 owner 过滤）
  - 复选框「保存为命名凭据」→ 出现 `name` + 高亮警示「密码会以 AES-256-GCM 加密入库」
  - **client debounce**：「连接并探测」按钮 1s 节流。
  - 主按钮：「连接」→ 调 `POST /clusters/{}/nodes/probe-host-key`
- **Step 1.5 — 主机指纹确认**（**BLOCKER 修复**）
  - 显示 `SHA256:...` 指纹 + key type，**用户必须勾「我确认这是预期主机」才能 next**。
  - 文案：「首次添加节点必须确认指纹（防 MITM）。后续 admin 会把此指纹写入 known_hosts。」
- **Step 2 — 探测结果确认**
  - 顶部展示探测结果摘要（hostname/OS/CPU/内存）
  - 网卡表（含 bond/IP/默认路由），运维勾选 mgmt 网卡 / cluster 网卡 / bridge 源网卡（默认按启发式预选：mgmt = 含 `10.0.10.0/24` 的网卡，pub = 默认路由网卡）
  - 节点角色（osd / mon-mgr-osd）
  - 节点名（默认探测 hostname，可改）
  - 「跳过网络配置」toggle（默认按启发式：若 mgmt/pub 都已配 IP 则默认开）
  - 探测警告：若 `incus_installed=true` → 红框「节点已安装 Incus，加入会重置配置」；若 OS 不在白名单 → 黄框
- **Step 3 — 提交**
  - 折叠卡片显示即将提交的字段汇总（含指纹）
  - 「确认加入」→ 调既有 `POST /clusters/{}/nodes`，body 多带 `probe_id` + `accepted_host_key_sha256`
  - 提交后切到 `Stage='job'`，挂现有 `JobProgress`

C2. **DESIGN.md 严格合规**（Linear 风 token-driven）
- 所有间距/圆角/字号/颜色走 Tailwind v4 `@theme` token（`size-*`/`text-*`/`bg-*`/`border-*`/`rounded-md`），**禁止任何 hex 字面量与 arbitrary value**（沿用 PLAN-032 / OPS-035 基线）。
- 警示框沿用 `bg-status-warning/8 text-status-warning border-status-warning/30`（参考 `node-join.tsx:303` 既有用法）。
- 表单组件强制 shadcn/ui base-nova：`Select` / `Input` / `Textarea` / `Switch` / `Card` / `Label`；Stepper 用项目内既有抽屉/分段组件，无新外部依赖（pma-web 硬约束）。
- `<details>` 折叠用 `@base-ui/react` Collapsible 替代原生（无障碍 + 一致动画）。

C3. **i18n**
- 新增 zh/en 翻译键于 `web/src/i18n/{zh,en}/admin.json` 命名空间 `admin.nodes.add.wizard.*`，沿用 PLAN-031 后建立的命名规范。
- 旧 `admin.nodes.add.*` 文案保留（向后兼容路由 query），新键在 wizard 渲染。

C4. **凭据管理子页**（最小子集）
- 新页面 `/admin/node-credentials`：列表 + 新增 + 删除。
- 列表只显示 `name / kind / fingerprint / last_used_at`（不显示明文）。
- 新增/删除按钮触发既有 step-up 流程（`useStepUpFlow`），未通过时跳 OIDC（参考 `downloadClusterEnvScript` 的 401 拦截模式，`api.ts:206-236`）。

### Phase D — 联调 + 真机验证

- 在 vmc.5ok.co 跑两类节点：
  1. node1（非 bond，标准 NIC）→ 自动探测正确识别 mgmt/pub
  2. node6（bond-mgmt + bond-pub）→ 自动探测识别 bond、默认路由网卡，skip-network 自动 ON
- 通过 SSE 9 步进度走完，cluster list 显示 Online。
- 重跑：用"已存凭据"加第二台节点（验证 DB 凭据复用）。

### Phase E — 文档 + 测试

- `docs/changelog.md` 加条目。
- `internal/sshexec/runner_test.go` 加密码 / inline key 单元测试。
- `internal/service/nodeprobe/probe_test.go` 用 mock Runner 验证 JSON 解析。
- 前端 vitest 覆盖 wizard 三步状态机。

## 风险

| 风险 | 缓解 |
|---|---|
| **首次添加节点撞 known_hosts 严格校验**（BLOCKER） | Phase B3 加 `probe-host-key` endpoint + Step 1.5 指纹确认 + 提交时写 known_hosts；不要走 `InsecureIgnoreHostKey` 默认 |
| **inline 凭据在 in-memory params 30min 持有，进程崩溃丢失**（BLOCKER） | UI 警告 + 默认推荐入库；`takeParams` zero out；不引入 params 持久化 |
| 密码模式落 DB 比私钥更敏感 | UI 强警示 + step-up 后才允许保存 / 删除；audit `node.credential.*` 三段；推荐 deploy-key 升级路径（备选） |
| 私钥粘贴剪贴板泄露 | UI 提示 + `autocomplete=off`；列表只显示 fingerprint，不返 ciphertext |
| 探测脚本依赖 `jq` / `apt install` | **方案 B1 已弃用 jq + apt 路线**：脚本只输出 raw `ip -j` JSON，admin 端 `encoding/json` 解析 |
| `ip -j route` 老 iproute2 不支持 | 脚本对 route 用文本输出 + admin 正则；目标平台 Ubuntu 22.04+ 是 iproute2 5.x+ |
| 探测启发式选错 mgmt/pub 网卡 | Step 2 是"确认页"不是"自动提交"，运维必须显式勾选 |
| `sshexec.Runner` 改造影响 6 处调用 | 保留旧 `New(...)` 签名 + 新增 `NewWithCredential`；ceph.go 长期持有的 Runner 不动 |
| `node-remove` 凭据预期错位 | Phase A4 显式声明 remove 走 leader 全局 key，与 add credential 解耦 |
| 探测/提交两次 SSH 中间 race | Probe 结果 10min 缓存 + `accepted_host_key_sha256` 服务端二次校验；窗口内拓扑变更概率忽略 |
| 用户狂点"探测"导致 SSH 连接堆积 | client 1s debounce + server 6 req/min/user rate limit |
| `node_credentials` 表 schema 错难迁移 | 第一版字段保守（name/kind/ciphertext/fingerprint/owner/timestamps）；version prefix 沿用 OPS-022 `v1:` 给 rotation 留口 |

## 工作量

| Phase | 估时 | 主要文件 |
|---|---|---|
| A. 凭据多形态 + DB + TOFU + zero-out | 1.5d | `sshexec/runner.go` + `Credential` 类型, `internal/repository/node_credential.go`(新), `db/migrations/018_node_credentials.sql`(新), `internal/handler/portal/node_credentials.go`(新) |
| B. 探测脚本 + 服务 + endpoint + 限流 | 1.5d | `cluster/scripts/probe-node.sh`(新), `internal/service/nodeprobe/`(新), `clustermgmt.go::ProbeHostKey + Probe` 两个 endpoint |
| C. 前端 wizard + 凭据子页 | 2d | `web/src/app/routes/admin/node-join.tsx`(reducer 重构), `web/src/app/routes/admin/node-credentials.tsx`(新), `web/src/features/nodes/api.ts`(扩展), `web/src/i18n/{zh,en}/admin.json` |
| D. 真机联调 | 0.5d | vmc.5ok.co + node1（非 bond）/ node6（bond）e2e；指纹确认 + 凭据复用 |
| E. 测试 + 文档 | 0.5d | `runner_test.go`(三种 cred), `nodeprobe/probe_test.go`(mock Runner + bond 解析), `node-join.test.tsx`(reducer 状态机), changelog |
| **合计** | **~6d** | |

## 备选方案

| 方案 | 与本方案差异 | 否决理由 |
|---|---|---|
| **反向 agent（Rancher 模型）** | 在 admin 端生成 token,目标机 `curl ... \| bash` 跑 agent 主动连回 | 改动面太大(新 agent 二进制 + 心跳通道 + 反向证书),P2 演进 |
| **Incus 原生 join token** | 完全走 `incus cluster add` API + `incus admin init --preseed` | 失去 Ceph / 防火墙 / Linux 包安装的自动化能力,9 步链路全废 |
| **MAAS 风 PXE 自动 enlist** | 网络发现 + 自动 commission | 依赖物理机网络段配 DHCP/PXE 服务器,改基础设施;留作 P3 长期演进 |
| **维持现状,只补私钥粘贴** | 最小改动,用户少跑一步 scp | 没解决"用户要填 12 个字段"的核心痛点,跟用户诉求差距大 |

## 不在范围

- 集群创建向导(PLAN-027 留下的纯 SQL upsert)→ 后续独立任务
- 反向 agent / 心跳通道 → P2
- IPMI / Redfish 自动启动 → P3
- 自动创建 `br-pub` bridge / 自动配 bonded NIC(PLAN-028 已划出范围)
- LACP / active-backup bond 模式自动检测

## 深度审查发现（2026-05-03）

> 用 Serena（仅 bash 索引可用）+ code-review-graph + Grep/Read 追溯 6 处 SSH 调用 + jobs runtime + 现有 testSSH endpoint + frontend node-join 路径，对照 Proxmox/Incus 原生/Rancher/MAAS/Talos 社区实践，两轮自查后定稿。

### 已合并修复（已写入正文 Phase A/B/C/风险表）

| # | 等级 | 发现 | 已合并到 |
|---|---|---|---|
| 1 | BLOCKER | 首次添加节点必撞 known_hosts 严格校验（`runner.go:296-310`），原方案没设计 TOFU | A1 `FetchHostKey` + B3 `probe-host-key` endpoint + C1.5 指纹确认页 |
| 2 | BLOCKER | `Runtime.params` 是 in-memory map（`runtime.go:46`），inline 凭据进程崩溃丢失 → sweeper 翻 partial → Rollback 残留节点 | A3 显式风险声明 + UI 警告 + 推荐入库优先 |
| 3 | BLOCKER | `jq` 远端可能缺失 + `apt install jq` 不幂等 + 无网节点装不上；`ip -j route` 老 iproute2 不可用 | B1 改为 admin 端 `encoding/json` 解析；route 用文本 + 正则 |
| 4 | CRITICAL | 凭据列表 endpoint 缺 step-up + ACL（密码列表是高敏元数据） | A2 三段全 step-up + 仅返 fingerprint/last_used + audit `node.credential.*` |
| 5 | CRITICAL | inline 密码在 Runtime.params 持有 30min,内存 dump 暴露面 | A1 `Runner.Close()` zero out + A3 `takeParams` zero out |
| 6 | CRITICAL | `node-remove` 凭据来自全局 `CEPH_SSH_KEY` 而非 add 时填的 password,容易让用户误以为"删节点也要那把密码" | A4 显式声明 remove 路径不变 |
| 7 | MEDIUM | Probe → 用户停留 → Add 两次 SSH 之间 race（拓扑变化） | B3 `probe_id` 10min 缓存 + 服务端二次校验 host key |
| 8 | MEDIUM | Probe 结果未持久化,关页重开要重探 | C0 sessionStorage 持久化（不含密码/PEM） |
| 9 | MEDIUM | 用户狂点"探测"导致 SSH 连接堆积 | C1 client 1s debounce + B3 server 6 req/min/user |
| 10 | MEDIUM | 原 wizard 状态机和 jobId 二态切换冲突 | C0 useReducer 状态机 |
| 11 | LOW | "50+ 调用点"虚报,实际 6 处 + ceph.go 长期持有 Runner | A1 修正 + 显式说明 ceph.go 不动 |
| 12 | LOW | UI 文案易把 `node_credentials`（admin 进节点凭据）和 `ssh_keys` 表（用户公钥进 VM）混淆 | C4 凭据子页明确标题 + 文案区分 |
| 13 | LOW | 探测脚本未来可能给 cluster.create 复用,设计应独立 | B1 脚本独立可跑,无 cluster 上下文耦合 |
| 14 | LOW | DESIGN.md 强约束未在 PLAN 显性 | C2 列出具体 token + 警示 hex 字面量禁用 |

### 验证过的调用链

- **后端**：`POST /admin/clusters/{name}/nodes`（`clustermgmt.go:398`）→ `jobs.Runtime.Enqueue`（`runtime.go:108`，setParams in-memory）→ worker（`runtime.go:120`，pool 4 goroutine）→ `clusterNodeAddExecutor.Run`（`cluster_node_add.go:75`）→ 9 step pipeline。SSH 在 step 1 `uploadEmbeddedScripts` + step 2..8 `runner.RunStream` 用同一把 keyFile。
- **测试 SSH**：`POST /admin/nodes/test-ssh`（`nodeops.go:54`）跑 `hostname && uname -r && uptime`,可被本期 Probe 替代/吸收。
- **前端**：`useTestSSHMutation` / `useAddNodeMutation`（`web/src/features/nodes/api.ts:126-176`）→ form view ↔ JobProgress view 二态切换（由 `jobId` 控制）。
- **加密栈**：`internal/auth/password_crypto.go::EncryptPassword`（OPS-022 v1: 前缀 + AES-256-GCM）可直接复用,**无需新建加密包**。
- **migrations**：最新 `017_clusters_full_config.sql` → 本期用 `018_node_credentials.sql`。
- **凭据被 4 个 worker 共享**:单进程内安全;多副本部署时若并发 add 同一节点,probe_id 缓存会失败,但本期单 admin 部署无此问题。

### 第二轮自查（2026-05-03）

- [x] node-remove 凭据是否依赖 add 时填的 password? → 不依赖,走 leader 全局 key（A4 已澄清）
- [x] testSSH endpoint 是否被前端其他页面复用? → 仅 node-join.tsx 一处（grep useTestSSHMutation），可吸收为 wizard 内部调用
- [x] CephHandler.runner 长期持有的密钥是否影响本期? → 不影响（Phase A1 保留 `New(...)` 签名）
- [x] 凭据 `created_by` 与 `owner` 是否一致? → 用 `created_by` 单字段,super-admin 通过 role 检查跨人删除
- [x] 探测脚本对 RHEL/CentOS 的 `lscpu -J` 兼容? → util-linux 2.32+ 支持（CentOS 8+/Ubuntu 20.04+ 全 OK）
- [x] PEM 私钥粘贴的换行符问题? → 前端 `Textarea` value 直传后端,Go `ssh.ParsePrivateKey` 接 LF/CRLF 都行
- [x] `accepted_host_key_sha256` 在 add-node job 重启时如何复用? → Phase B3 写 known_hosts 是 add-node 启动时,job 在 worker 内已经 read 过 known_hosts;sweeper recovery 路径不会用到（已 partial）
- [x] 加 step-up 后,凭据保存是否会打断 wizard? → C4 凭据子页与 wizard 解耦;wizard 内"勾选保存" → 提交 add-node 一并入库（同事务），无独立 step-up 弹窗

### 残留疑问（待用户决策）

- **Q1**：是否要"密码自动升级 deploy key"路径（首次 password ssh ok 后,自动注入 admin pubkey,后续切 key 认证）? Rancher/Ansible 模式。**未纳入本期范围**,默认走 password+加密入库。回 `Q1: yes` 即追加到 Phase A。
- **Q2**：凭据是否支持 SSH agent / SSH certificate（OpenSSH CA 签）? **未纳入本期**,默认仅 password + raw private key。回 `Q2: yes` 即追加。
- **Q3**：探测脚本是否要做"残留检测"（节点已是某集群成员就拒绝 add）? 当前由 `incus-version` MISSING/non-MISSING 给前端警告,但不阻塞;回 `Q3: hard-block` 即升级为 422 拒绝。

## 批注

- 2026-05-03 用户决策：先做"添加节点自动化",集群创建延后。
- 2026-05-03 深度审查发现 + 修订已合并到正文。等用户对残留疑问 Q1/Q2/Q3 决策与整体 `proceed`。
