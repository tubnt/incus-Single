# PLAN-038 节点加入 + 集群部署 AI 辅助（探测增强 + 角色推荐 + 失败诊断）

- **status**: completed
- **createdAt**: 2026-05-06 13:00
- **approvedAt**: 2026-05-06 12:30（Phase A 单独推进，Tier 2/3 等 D1-D4 决策）
- **completedAt**: 2026-05-06 17:50（Phase A + B + C 全部上线；用户决策 D1=a/D2=a/D3=a/D4=a）
- **priority**: P2
- **owner**: claude
- **relatedTask**: [OPS-041](../task/OPS-041.md)
- **referenceDoc**: PLAN-033（OPS-039 探测向导）/ PLAN-026（cluster.node.add 9 步流水线）/ PLAN-028（join-node.sh bonded NIC）

## 现状

### 探测层（PLAN-033 已落地）

- `cluster/scripts/probe-node.sh`：嵌入脚本，输出 hostname/os/cpu/mem/ip-link/ip-addr/ip-route/disks/incus-version/ceph-version 共 10 个 section
- `internal/service/nodeprobe/probe.go::Probe`：解析为 `NodeInfo`（含 Interfaces[]，每个含 Name/Kind/MAC/Slaves/Master/Addresses/IsDefaultRoute；Disks[] 含 Rotational/SizeBytes/Model；OS 含 ID/Version/Kernel）
- 缺：**NIC 速率（speed_mbps）虽在 schema 但未被脚本填充**；无 PCI bus / driver 信息；无 carrier/link 状态；无 `lspci -mm` 输出；无 NUMA 信息。

### 推荐层（PLAN-033 前端 `computeHeuristics`）

- 仅按硬编码 CIDR 模式匹配：`10.0.10.x` → mgmt；`10.0.20.x` → ceph-pub；`10.0.30.x` → ceph-cluster；默认路由网卡 → bridge。
- **致命局限**：新节点未预配 IP 时全部为空 → 用户必须手填 12 字段，回到 PLAN-033 之前的痛点。
- 未提供 ranked 候选（仅给一个最佳值）；未给置信度 / 理由。

### 执行层

- `cluster/scripts/join-node.sh` 7 步流水线（preflight / 装包 / 网络 / Incus join / Ceph OSD / 防火墙 / 验证），失败仅打 `[ERROR]` 行 + stderr 直返。
- `clusterNodeAdd` job runtime 解析 `====== 步骤 N/7` marker 推进 SSE step。
- 无失败诊断；运维必须自行读 stderr 推断原因（apt 锁、netplan 超时、IP 冲突、key 指纹错配、内核模块缺失、OSD prepare 失败 等）。

### AI 集成

- 项目无 LLM SDK 依赖（grep 0 命中 openai/anthropic/llm）。
- 无 `internal/aiassist/` 包。
- pma 全局 `claude-api` skill 提供过 SDK + caching 范式参考，但本项目未集成。

## 业界最佳实践（2026-05 web research）

| 来源 | 共识 |
|---|---|
| **Proxmox Ceph 社区**（多帖共识） | 3 NIC 物理分离最佳：1G corosync / 10G+ Ceph private / WAN VM 出口；公网/集群网二者**默认同子网**但建议拆分；纯人工配置，**无自动方案** |
| **Proxmox + DRS / Cluster API / Talos** | 全部声明式；声明 = 真理；不引入 AI |
| **MAAS / OpenStack Ironic** | 硬件自检 + 人工角色映射；类似我们 PLAN-033 探测路径，**未做 LLM 决策** |
| **Cephadm / Rook** | spec 文件显式声明 `cluster_network`；运营手填 |
| **TerraShark 2026**（Medium） | "tell LLM how to think"：7 步 diagnostic prompt，先识别上下文再生成。**禁止自由文本**，输出走 schema |
| **TerraFormer 2026**（arxiv） | multi-turn repair loop + verifier-generated error certificates；LLM 提议 → 校验器拒收 → 反馈再修 |
| **AIOps / Cast AI / KubeAI 2026** | 侧重 debug / optimize / scale，**未覆盖 NIC 角色映射**——本任务在该空白区 |
| **常见 LLM 失败模式**（多源汇总） | silent assumptions / overcomplexity / blast radius / secret exposure / identity churn |

**关键启示**：

1. NIC 角色自动决策**不是已解决问题**——主流方案要么纯人工，要么纯启发式
2. AI 在 IaC 的安全模式：**结构化推理 prompt + JSON schema + verifier-feedback + 不直接执行**
3. 失败诊断比角色推荐更适合 LLM：parse stderr → 已知模式匹配是 LLM 强项

## 方案

总体方向：**三层架构**——确定性规则覆盖 80% / AI 增强解决 ranked 候选不明确的边界情况 / AI 失败诊断给运维提示。**所有 AI 输出走 JSON schema，永不直接执行命令**。

### Phase A — 探测增强 + Tier 1 ranked 候选（不引入 AI）

A1. **probe-node.sh 增强**（`cluster/scripts/probe-node.sh`）
- 加 section `lspci-eth`：`lspci -mm 2>/dev/null | grep -iE 'ethernet|network'`
- 加 section `ethtool`：对每个非 lo 网卡 `ethtool $nic 2>/dev/null` + `ethtool -i $nic 2>/dev/null`（输出 raw text）
- 加 section `numa`：`lscpu | grep -E 'NUMA|^Socket'`
- 兼容性：`lspci` / `ethtool` 大多 distro 默认有；`|| true` 防失败（已脱敏处理：MAC/serial 不在 prompt 中传 LLM，仅 admin 端用）

A2. **NodeInfo 扩展**（`internal/service/nodeprobe/probe.go`）
- `Interface` 加：`Driver string`、`PCIBusID string`、`SpeedMbps int`、`Carrier bool`、`LinkUp bool`
- 新解析函数 `parseEthtool(raw string) map[nic]Interface`：从 `Speed: 10000Mb/s` / `Link detected: yes` / `driver: ixgbe` / `bus-info:` 提取
- 解析失败 → 字段保持零值，不 panic

A3. **Tier 1 ranked 候选**（新包 `internal/service/aiassist/ranker.go`，纯函数）
- `RankNICRoles(info *NodeInfo) RoleCandidates`
- 每个角色（`bridge_source` / `mgmt` / `ceph_public` / `ceph_cluster`）输出 ≤ 3 个候选，每个含 `{nic, score 0-1, rationale[]}`
- 评分规则（每条规则 +/- 加权）：

```
bridge_source:
  + 0.9 if iface.IsDefaultRoute
  + 0.5 if iface has public-routable address
  - 0.3 if speed < 1000

mgmt:
  + 0.8 if address in 10.0.10.0/24 (cluster-env mgmt CIDR)
  + 0.4 if speed in [1000, 2500] (typical mgmt link)
  - 0.5 if iface.IsDefaultRoute
  - 0.5 if no carrier

ceph_cluster:
  + 0.9 if speed >= 10000 and !IsDefaultRoute
  + 0.7 if speed >= 25000
  + 0.3 if address in 10.0.30.0/24
  - 0.4 if IsDefaultRoute
  - 1.0 if !LinkUp

ceph_public:
  similar to ceph_cluster but prefers 10.0.20.0/24 / fallback to ceph_cluster nic
```

- bond 处理：bond 本体作为候选 nic，slave 不出现在角色候选中（避免脏数据）；bond 速率 = sum(slaves.speed)（active-active）/ max(slaves.speed)（active-backup，由 `ip -d link` 输出 `mode` 字段判断）

A4. **`computeHeuristics`（前端）改对接 Tier 1 输出**
- backend `POST /clusters/{name}/nodes/probe` response 增加 `ranked: { bridge_source: [...], mgmt: [...], ceph_public: [...], ceph_cluster: [...] }`
- 前端 `node-join.tsx` step 2 网卡表：
  - 默认显示 top-1 候选作为预选
  - 旁边小字标 confidence + 主理由（如 `10G link not in default route → strong cluster network candidate`）
  - "其他候选" 折叠展开（top-2 / top-3）
  - 用户切换候选时实时更新表单值

A5. **置信度判断**：`overallConfidence = avg(top1.score - top2.score for each role)`
- 如果 ≥ 0.3 → "高置信度"，wizard 直接折叠专家字段（沿用 PLAN-034 P2-A `heuristicConfident` 模式）
- 如果 < 0.3 → 显示橙色 banner：「自动识别置信度低，建议核对网卡角色（或启用 AI 解释）」

### Phase B — Tier 2 AI 角色推荐（可选 / 受门控）

B1. **AI provider 抽象**（`internal/aiassist/provider.go`，新）
- 接口：

```go
type Provider interface {
    Name() string
    Suggest(ctx context.Context, prompt StructuredPrompt, schema json.RawMessage) (*Suggestion, error)
}
type StructuredPrompt struct {
    System string
    User   string  // marshalled inputs
    MaxTokens int
}
type Suggestion struct {
    JSON       json.RawMessage  // 已 schema 校验
    Reasoning  string           // 简短理由（< 200 字）
    Confidence float64
    UsageInputTokens int
    UsageOutputTokens int
}
```

- 实现：`anthropic.go`（Claude SDK，参考 pma 的 `claude-api` skill）+ `openai.go`（兼容 OpenAI / 自托管 OpenAI 协议如 vllm/ollama）+ `disabled.go`（短路返回 `ErrAIDisabled`）
- env：`AI_PROVIDER=anthropic|openai|disabled`（默认 disabled）/ `AI_API_KEY`（dotenv，不入 DB） / `AI_MODEL`（默认 `claude-haiku-4-5`，便宜）/ `AI_BASE_URL`（自托管 OpenAI 兼容用）
- prompt caching：长 system prompt 走 cache（参考 `claude-api` skill 模式），降低成本

B2. **角色推荐 prompt + schema**（`internal/aiassist/role_mapping.go`）
- system prompt（< 600 字）：
  > 你是一个 Linux 服务器网卡角色规划助手。给定一台候选节点的硬件探测 JSON + 现有集群拓扑摘要，推荐 4 个角色（bridge_source / mgmt / ceph_public / ceph_cluster）的最优网卡。
  > 推理步骤（必须显式）：
  > 1. 列出所有可用 NIC（含速率、状态、IP）
  > 2. 排除：down / no-carrier / 已是 bond slave 的子接口
  > 3. 按角色逐一选：bridge=默认路由；mgmt=mgmt 网段或低速专用；ceph_cluster=最高速 + 非默认路由；ceph_public=次高速 / 同 ceph_cluster
  > 4. 给每个推荐打置信度 0-1（< 0.5 表示需要人工核对）
  > 5. 列出 warnings（如 ceph_cluster 仅 1G、节点已有 incus 安装等）
  > 输出严格符合给定 JSON schema，不写任何额外文本。

- input：`{node_info: <NodeInfo 脱敏>, existing_cluster: <topology summary>, expected_role: "osd"|"mon-mgr-osd"}`
  - 脱敏：MAC SHA-256(8) 截断 / Address 仅保留 /24 网段 / hostname 单向哈希（除非用户已明确）
- 强制 JSON schema：

```json
{
  "type": "object",
  "required": ["recommendations", "warnings"],
  "properties": {
    "recommendations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["role", "nic", "confidence", "rationale"],
        "properties": {
          "role": {"enum": ["bridge_source", "mgmt", "ceph_public", "ceph_cluster"]},
          "nic": {"type": "string", "maxLength": 32},
          "confidence": {"type": "number", "minimum": 0, "maximum": 1},
          "rationale": {"type": "string", "maxLength": 200}
        }
      }
    },
    "warnings": {"type": "array", "items": {"type": "string", "maxLength": 200}}
  }
}
```

- schema 校验失败 → 回退 Tier 1 + 打 warn 日志 + audit `ai.suggest.invalid_schema`
- LLM 推荐的 nic 不在 NodeInfo.Interfaces[] 中 → 视为 hallucination，回退 + audit `ai.suggest.hallucination`

B3. **endpoint**：`POST /clusters/{name}/nodes/ai-suggest`
- input：`{probe_id: existing}`（复用已缓存 probe 结果，避免重传）
- 限流：每用户 10 req/h（rate limiter）+ 同 probe_id 5min 缓存
- step-up gated（admin role）+ audit
- 默认行为：用户在 wizard step 2 看到"AI 解释"按钮（仅 `AI_PROVIDER != disabled` 时出现）；点击调用此 endpoint

B4. **前端 wizard 集成**（`web/src/app/routes/admin/node-join.tsx`）
- step 2 顶部加 "AI 解释" 按钮（disabled 状态显示 tooltip "AI 未启用 / 联系管理员"）
- 调用后展示卡片：每角色 LLM 推荐 + Tier 1 推荐的 diff（Tier 1 vs AI），运维按需采纳
- 不强制采纳 AI；用户选哪个就填哪个

### Phase C — Tier 3 AI 失败诊断

C1. **诊断 prompt + schema**（`internal/aiassist/diagnose.go`）
- 触发：`cluster.node.add` job 终态 `failed` 时，自动入队 `cluster.node.add.diagnose` 子 job
- input：`{step_failed, last_200_lines_stderr, node_info_summary, distro, kernel}`
  - 脱敏：去掉 IP / hostname / token
- system prompt（参考 TerraShark 7-step）：
  > 给定一段 join-node.sh 失败日志，输出 JSON：
  > 1. category: "auth" / "network" / "apt_lock" / "netplan_revert" / "ceph_osd_prepare" / "fingerprint_mismatch" / "disk_busy" / "kernel_module" / "unknown"
  > 2. likely_root_cause: < 200 字
  > 3. suggested_fix_steps: [{step: 描述, command_template: 模板字符串(可选)}]，最多 5 步
  > 4. safe_to_auto_retry: bool（仅 apt_lock / 临时网络抖动可设 true）
  > 5. requires_manual: 描述需要运维登机做什么

- schema 校验失败 → 显示 raw stderr（保底）

C2. **endpoint + UI**：`GET /admin/jobs/{id}/ai-diagnose`
- 仅 failed job 可调；缓存 5min；限流 10 req/h
- 前端 `JobProgress` failed 状态展开 collapsible "AI 诊断"（按需点开，不自动调用，避免计费）
- 不允许 LLM 输出的 command 自动执行；模板字符串只是给运维参考

### Phase D — 安全 / 计费 / 可观测

D1. **脱敏层**（`internal/aiassist/redact.go`，全 AI 输入必经）
- IP → /24 截断（10.0.10.5 → 10.0.10.0/24）
- hostname → 仅保留前缀（`node6.dc1.example.com` → `node6.*`）
- MAC → SHA-256 前 8 位
- token / API key 正则模糊（如 `eyJ\w+` → `<JWT>`）
- 单测覆盖每条规则

D2. **审计 + metrics**（`internal/aiassist/audit.go`）
- 每次 AI 调用打 audit `ai.{role_mapping|diagnose}.{success|fallback|hallucination|schema_invalid}`
- expvar / prom counter：tokens 用量 / 调用次数 / 平均延迟 / 失败率
- 每天/每月预算 alarm（env `AI_MONTHLY_TOKEN_BUDGET`）

D3. **失败回退**：每个 AI 调用都有非 AI 兜底路径
- B 失败 → 用 Tier 1 推荐
- C 失败 → 显示 raw stderr
- AI provider 5xx / timeout 5s → toast "AI 不可用" + 不阻塞流程

D4. **Provider 选择文档**（`docs/architecture.md` 加节）
- 默认推荐：`anthropic` + `claude-haiku-4-5`（快、便宜、reasoning OK）
- 自托管选项：vllm / ollama 兼容 OpenAI 协议；本期接口预留但不做完整调试

### Phase E — 联调 + 测试 + 文档

- 真机：node1 标准（单 NIC）+ node6 bond + 一台**故意未配 IP 的新机** 跑探测 → Tier 1 给出候选 → 启用 AI（haiku）跑 Tier 2 看推荐质量
- 注入失败：apt-lock + netplan 超时 + 假指纹错配 → 跑 Tier 3 诊断
- 单测：`ranker_test.go`（rank 算法）/ `redact_test.go`（脱敏规则）/ `provider_anthropic_test.go`（mock SDK 响应 + schema 校验失败 case）
- 前端：vitest 覆盖 `node-join.tsx` 的 AI 按钮 disabled / Tier 1 vs AI diff 渲染
- changelog 加条目；docs/architecture.md 加 `## AI Assist` 节描述层级架构 + 安全约束

## 风险

| 风险 | 缓解 |
|---|---|
| **LLM hallucination**（推荐不存在的 nic） | B2 schema 校验 + nic 必须在 NodeInfo.Interfaces[]；失败回退 Tier 1；audit |
| **数据外泄到 LLM provider** | D1 脱敏层强制；hostname/MAC/IP 全脱敏；可切自托管 LLM (vllm/ollama) |
| **AI 成本失控** | 限流（10/h/user）+ probe_id 缓存 5min + 默认 haiku 模型 + 月度 token 预算告警 |
| **AI 不可用导致 wizard 卡死** | 全链路 graceful fallback：disabled / timeout 5s / schema_invalid 都回 Tier 1，不阻塞 |
| **AI 输出被恶意利用执行命令** | LLM 只输出 schema 化建议；执行体永远是 join-node.sh 模板；schema 不含 raw command field（只有 `command_template` 给运维看，不传给 ssh） |
| **Tier 1 ranker 算法分数权重错** | 单测覆盖 8+ 节点配置（单 NIC / bond / 多 10G / 全无 link / 默认路由错配）；初始权重保守、可调 |
| **probe-node.sh `lspci/ethtool` 在某些 distro 缺失** | `\|\| true` + 字段零值兼容；Tier 1 在零值情况下退化为现有逻辑（PLAN-033 同等水平） |
| **bond mode 解析错** | `ip -d link show` 已在 PLAN-033 范围；本期复用，单测覆盖 active-backup vs LACP |
| **AI provider abstraction 过早** | 仅做 1 个 anthropic 实现 + 1 个 disabled，OpenAI 实现保留接口空实现，待真有需求再补 |
| **schema 字段过严，LLM 拒绝输出** | 适度宽松 + maxLength 字段防 prompt 注入扩张；retry 1 次 reformat |

## 工作量

| Phase | 估时 | 主要文件 |
|---|---|---|
| A. probe 增强 + Tier 1 ranker + 前端 ranked 候选 | 2d | `cluster/scripts/probe-node.sh`, `internal/service/nodeprobe/probe.go`, `internal/service/aiassist/ranker.go`(新) + 单测, `node-join.tsx` 候选展示改造 |
| B. AI provider 抽象 + 角色推荐 prompt + endpoint + UI | 2d | `internal/aiassist/{provider,anthropic,openai,disabled,role_mapping,redact}.go`(全新), `clustermgmt.go::AISuggestNodeRoles` endpoint, `node-join.tsx` AI 按钮 |
| C. Tier 3 失败诊断 prompt + endpoint + UI | 1d | `internal/aiassist/diagnose.go`, `jobs.go::AIDiagnose` endpoint, `JobProgress` 失败折叠 |
| D. 脱敏单测 + audit/metrics + provider 切换文档 | 0.5d | `redact_test.go`, `audit.go`, `docs/architecture.md` |
| E. 真机联调 + 失败注入 + changelog | 0.5d | vmc.5ok.co + node1/node6 + AI on/off 切换 |
| **合计** | **~6d** | |

## 备选方案

| 方案 | 与本方案差异 | 否决理由 |
|---|---|---|
| **纯 AI（无 Tier 1）** | 直接把 NodeInfo 喂 LLM 决策 | blast radius 高 / hallucination 无兜底 / 离线环境失效 / 违反 IaC LLM best practice |
| **纯启发式扩展（无 AI）** | 仅做 Phase A | 解决标准案例，无法处理"陌生硬件 + 多 NIC + 不规则命名" + 失败诊断；与用户原始诉求差距大 |
| **反向 agent + agent 内嵌 LLM** | 节点上跑 agent 做本地推理 | 改架构 + 新二进制 + LLM 模型部署成本；PLAN-033 已否决 |
| **基于规则引擎（无 LLM，YAML 规则）** | 用 cue/rego 做规则 DSL | 写规则成本接近写 Go；维护比 LLM prompt 更脆 |
| **MAAS / Cluster API 对接** | 接入开源声明式系统 | 与现有 join-node.sh 生态冲突；改造范围远超本期 |

## 不在范围

- 反向 agent / 心跳通道（PLAN-033 留 P2）
- IPMI / Redfish 自动启动（PLAN-033 留 P3）
- LLM agentic 自动重试 / 自动修复执行（违反安全约束）
- 自定义 LLM 微调（用 generic Claude/GPT 即可）
- 自托管 LLM 完整调试（接口预留，等需求）
- **静态规则引擎补全 Tier 1**（如果 Tier 1 ranker 不够，再单立 plan）

## 批注

- 2026-05-06 用户提案："AI + 模板"分层架构；用户已意识到 NIC/Ceph 角色无法纯模板化
- 2026-05-06 web research 验证：业界方案 (Proxmox/Cephadm/Cluster API/MAAS) 全部纯人工或纯启发式；NIC 角色映射自动化是空白区；TerraShark / TerraFormer 2026 给出"structured reasoning + JSON schema + verifier-feedback"的安全 LLM 模式
- 2026-05-06 等用户决策：
  - **D1**：是否采用三层架构（Tier 1 默认 + Tier 2 可选 + Tier 3 诊断）？或先只做 Tier 1 看效果？
  - **D2**：默认 provider 选 anthropic（haiku）还是先做 OpenAI 兼容（覆盖 vllm 自托管）？
  - **D3**：失败诊断（Tier 3）是否优先级最高（运维痛点最直接）？可拆分先做
  - **D4**：是否限定本期"vmc.5ok.co 已购 LLM API"，还是做完整 disabled 路径让没买 API 的部署也能跑？
