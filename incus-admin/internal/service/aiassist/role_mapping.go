package aiassist

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/incuscloud/incus-admin/internal/service/nodeprobe"
)

// PLAN-038 / OPS-041 Phase B Tier 2 — LLM 角色推荐。
//
// **触发条件**（不是默认）：Phase A Tier 1 算出的 OverallConfidence < 0.3
// 时由前端冒出"AI 解释"按钮，运维点了才调一次。低置信度场景：
//
//   - 节点没预配 IP（启发式无线索）
//   - 网卡命名不规则（bond / SR-IOV VF / LAG）
//   - top1 与 top2 score 差距很小
//
// **不替代** Tier 1：返回 ranked 候选 + 理由，运维仍需点"采纳"才覆盖表单字段。

// RoleMappingInput Tier 2 prompt 的用户输入（脱敏后送 LLM）。
type RoleMappingInput struct {
	Node            redactedNodeInfo `json:"node"`
	ExistingCluster ClusterContext   `json:"existing_cluster"`
	ExpectedRole    string           `json:"expected_role"` // "osd" | "mon-mgr-osd"
	Tier1Hint       []RoleCandidates `json:"tier1_hint"`    // Phase A ranker 已算的 top-3，给 LLM 参考
}

// ClusterContext 给 LLM 看现有集群的拓扑摘要。
type ClusterContext struct {
	NodeCount      int    `json:"node_count"`
	CephClusterCIDR string `json:"ceph_cluster_cidr,omitempty"`
	CephPublicCIDR  string `json:"ceph_public_cidr,omitempty"`
	MgmtCIDR        string `json:"mgmt_cidr,omitempty"`
}

// redactedNodeInfo 是 NodeInfo 的脱敏版（送 LLM 用）。MAC/IP/hostname 都被
// 处理过；speed/driver/PCI 这些原始数据保留（不敏感）。
type redactedNodeInfo struct {
	Hostname    string                  `json:"hostname"`
	OS          nodeprobe.OSInfo        `json:"os"`
	CPU         nodeprobe.CPUInfo       `json:"cpu"`
	MemoryGB    int64                   `json:"memory_gb"` // 取整 GB，避免精确字节作泄漏面
	Interfaces  []redactedInterface     `json:"interfaces"`
	DefaultRoute *redactedRoute         `json:"default_route,omitempty"`
	NUMA        *nodeprobe.NUMAInfo     `json:"numa,omitempty"`
}

type redactedInterface struct {
	Name           string   `json:"name"`
	Kind           string   `json:"kind"`
	MACHash        string   `json:"mac_hash,omitempty"`
	SpeedMbps      int      `json:"speed_mbps,omitempty"`
	Driver         string   `json:"driver,omitempty"`
	Slaves         []string `json:"slaves,omitempty"`
	Master         string   `json:"master,omitempty"`
	Subnets        []string `json:"subnets,omitempty"` // /24 截断
	IsDefaultRoute bool     `json:"is_default_route,omitempty"`
	LinkUp         bool     `json:"link_up,omitempty"`
}

type redactedRoute struct {
	Interface string `json:"interface"`
	Gateway   string `json:"gateway,omitempty"`
}

// redactNodeInfo 把 NodeInfo 转成脱敏版。
func redactNodeInfo(info *nodeprobe.NodeInfo) redactedNodeInfo {
	if info == nil {
		return redactedNodeInfo{}
	}
	out := redactedNodeInfo{
		Hostname: RedactHostname(info.Hostname),
		OS:       info.OS,
		CPU:      info.CPU,
		MemoryGB: info.MemoryKB / (1024 * 1024),
		NUMA:     info.NUMA,
	}
	for _, n := range info.Interfaces {
		ri := redactedInterface{
			Name:           n.Name,
			Kind:           n.Kind,
			SpeedMbps:      n.SpeedMbps,
			Driver:         n.Driver,
			Slaves:         n.Slaves,
			Master:         n.Master,
			IsDefaultRoute: n.IsDefaultRoute,
			LinkUp:         n.LinkUp,
		}
		if n.MAC != "" {
			ri.MACHash = HashMAC(n.MAC)
		}
		for _, a := range n.Addresses {
			ri.Subnets = append(ri.Subnets, RedactIP(a))
		}
		out.Interfaces = append(out.Interfaces, ri)
	}
	if info.DefaultRoute != nil {
		out.DefaultRoute = &redactedRoute{
			Interface: info.DefaultRoute.Interface,
			Gateway:   RedactIP(info.DefaultRoute.Gateway),
		}
	}
	return out
}

// roleMappingSystemPrompt — Tier 2 的固定指令（参考 TerraShark 2026 模式：先告
// 诉 LLM 怎么思考，再让它输出）。中文以避免英文 prompt 在中文 stderr 里造误匹配。
const roleMappingSystemPrompt = `你是 Linux 服务器网卡角色规划助手。给定一台候选节点的硬件探测 JSON 与现有集群拓扑摘要，
推荐 4 个角色（bridge_source / mgmt / ceph_public / ceph_cluster）的最优网卡。

推理步骤（必须严格遵守）：
1. 列出所有可用 NIC（含速率、状态、子网、bond 关系）
2. 排除：down 链路 / 已是 bond slave 的子接口（仅推荐 bond 本体）
3. 按角色逐一选：
   - bridge_source = 默认路由所在 NIC（VM 出口桥源）
   - mgmt = 在 mgmt CIDR 段且速率 1G 或 2.5G；如全空，挑非默认路由的 1G
   - ceph_cluster = 速率 ≥ 10G + 非默认路由（OSD 内部高 IO）
   - ceph_public = 速率 ≥ 10G，可与 ceph_cluster 同或不同
4. 给每个推荐打置信度 0..1（< 0.5 表示需要人工核对）
5. 列出 warnings：硬件 / 拓扑 / 配置层面的风险点

输出严格符合提供的 JSON schema。不要写任何额外文本。`

// roleMappingSchema — 强制 LLM 用 tool_use 输出此 schema。
const roleMappingSchema = `{
  "type": "object",
  "required": ["recommendations", "warnings"],
  "properties": {
    "recommendations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["role", "nic", "confidence", "rationale"],
        "properties": {
          "role": {"type": "string", "enum": ["bridge_source", "mgmt", "ceph_public", "ceph_cluster"]},
          "nic":  {"type": "string", "maxLength": 32},
          "confidence": {"type": "number", "minimum": 0, "maximum": 1},
          "rationale": {"type": "string", "maxLength": 200}
        }
      }
    },
    "warnings": {"type": "array", "items": {"type": "string", "maxLength": 200}}
  }
}`

// RoleMappingResponse 解析 LLM JSON。
type RoleMappingResponse struct {
	Recommendations []RoleMappingRecommendation `json:"recommendations"`
	Warnings        []string                    `json:"warnings"`
}

type RoleMappingRecommendation struct {
	Role       string  `json:"role"`
	NIC        string  `json:"nic"`
	Confidence float64 `json:"confidence"`
	Rationale  string  `json:"rationale"`
}

// SuggestRoleMapping 调 provider 拿 LLM 推荐 + 校验。
//
// 校验项：
//   1. JSON schema (Anthropic tool_use 已经在 server 端做了 schema validate)
//   2. 推荐的 NIC 必须在 NodeInfo.Interfaces 里（防 hallucination）
//   3. role enum 必在 4 角色集合内
//
// 任一校验失败 → ErrAISchemaInvalid，调用方走 fallback。
func SuggestRoleMapping(ctx context.Context, p Provider, info *nodeprobe.NodeInfo, cluster ClusterContext, expectedRole string, tier1 []RoleCandidates) (*RoleMappingResponse, *Suggestion, error) {
	if p == nil {
		return nil, nil, ErrAIDisabled
	}
	input := RoleMappingInput{
		Node:            redactNodeInfo(info),
		ExistingCluster: cluster,
		ExpectedRole:    expectedRole,
		Tier1Hint:       tier1,
	}
	userJSON, err := json.Marshal(input)
	if err != nil {
		return nil, nil, fmt.Errorf("marshal input: %w", err)
	}
	sug, err := p.Suggest(ctx, roleMappingSystemPrompt, userJSON, []byte(roleMappingSchema))
	if err != nil {
		return nil, nil, err
	}
	var resp RoleMappingResponse
	if err := json.Unmarshal(sug.JSON, &resp); err != nil {
		return nil, sug, fmt.Errorf("%w: %v", ErrAISchemaInvalid, err)
	}
	// 防 hallucination：推荐的 nic 必须存在
	known := make(map[string]bool, len(info.Interfaces))
	for _, n := range info.Interfaces {
		known[n.Name] = true
	}
	for _, r := range resp.Recommendations {
		if !known[r.NIC] {
			return nil, sug, fmt.Errorf("%w: recommended nic %q not in interfaces", ErrAISchemaInvalid, r.NIC)
		}
		switch r.Role {
		case "bridge_source", "mgmt", "ceph_public", "ceph_cluster":
		default:
			return nil, sug, fmt.Errorf("%w: invalid role %q", ErrAISchemaInvalid, r.Role)
		}
	}
	return &resp, sug, nil
}
