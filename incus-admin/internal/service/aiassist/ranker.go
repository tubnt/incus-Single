// Package aiassist 节点加入向导的"AI 辅助"层。
//
// PLAN-038 / OPS-041 三层架构：
//
//   - Tier 1（本文件）—— 确定性 ranked 候选：纯函数评分，不引入 LLM 依赖
//   - Tier 2（待用户决策 D1-D4）—— LLM 角色推荐：低置信度时调外部 provider
//   - Tier 3（待用户决策 D1-D4）—— LLM 失败诊断：join 失败时解析 stderr
//
// 本文件只做 Tier 1。
package aiassist

import (
	"sort"
	"strings"

	"github.com/incuscloud/incus-admin/internal/service/nodeprobe"
)

// Role 节点加入流程关心的 4 个网卡角色。
type Role string

const (
	RoleBridge      Role = "bridge_source"  // VM 出口桥接源
	RoleMgmt        Role = "mgmt"           // 管理网（10.0.10.0/24）
	RoleCephPublic  Role = "ceph_public"    // Ceph 客户端 / mon 通信
	RoleCephCluster Role = "ceph_cluster"   // Ceph OSD 内部复制
)

// AllRoles 返回所有需要排序候选的角色列表（顺序固定，便于前端展示）。
func AllRoles() []Role {
	return []Role{RoleBridge, RoleMgmt, RoleCephPublic, RoleCephCluster}
}

// Candidate 单个网卡对某角色的评分结果。
type Candidate struct {
	NIC        string   `json:"nic"`
	Score      float64  `json:"score"`     // 0..1，越大越合适
	Confidence float64  `json:"confidence"` // 0..1，相对其他候选的领先幅度
	Reasons    []string `json:"reasons"`   // 一句话理由列表（前端 hover 提示）
}

// RoleCandidates 单角色的 ranked 列表。Top 在前。
type RoleCandidates struct {
	Role       Role        `json:"role"`
	Candidates []Candidate `json:"candidates"`
}

// RankResult RankNICRoles 的返回。前端 wizard step 2 拿来渲染 top-3。
type RankResult struct {
	Roles            []RoleCandidates `json:"roles"`
	OverallConfidence float64         `json:"overall_confidence"` // 4 角色平均（top1-top2 的差值均值）
}

// RankNICRoles 把 NIC 列表按 4 个角色各自评分。每角色返回 top-3 候选。
//
// 评分启发式（PLAN-038 Phase A 设计）：
//
//   - bridge_source: + 默认路由 + 公网 IP；- 速率 < 1G
//   - mgmt:          + 在 10.0.10.0/24 + 速率 1G/2.5G + link up；- 默认路由
//   - ceph_cluster:  + 速率 ≥ 10G + 非默认路由 + link up；- 速率 < 10G
//   - ceph_public:   类似 ceph_cluster 但优先 10.0.20.0/24
//
// 仅排除：bond slave（Master != ""）/ Kind="bridge" 自身（不能作为 source）/
// 名字含 lo/docker/cni/veth 等容器虚拟网卡。
//
// 完全无候选 → 返回空 RoleCandidates；前端用空状态。
func RankNICRoles(info *nodeprobe.NodeInfo) RankResult {
	if info == nil || len(info.Interfaces) == 0 {
		return RankResult{}
	}
	usable := filterUsable(info.Interfaces)

	roles := make([]RoleCandidates, 0, 4)
	for _, role := range AllRoles() {
		cands := scoreForRole(role, usable)
		// 取 top-3
		if len(cands) > 3 {
			cands = cands[:3]
		}
		roles = append(roles, RoleCandidates{Role: role, Candidates: cands})
	}

	// overall confidence = 4 角色的"top1 - top2 score 差"平均
	confSum := 0.0
	confN := 0
	for _, r := range roles {
		if len(r.Candidates) >= 2 {
			confSum += r.Candidates[0].Score - r.Candidates[1].Score
			confN++
		} else if len(r.Candidates) == 1 {
			confSum += r.Candidates[0].Score
			confN++
		}
	}
	overall := 0.0
	if confN > 0 {
		overall = confSum / float64(confN)
	}
	return RankResult{Roles: roles, OverallConfidence: overall}
}

// filterUsable 排除不能作为 PickNode 候选的 interface：
//
//   - bond slave（带 Master）：score 用 bond 本体而非 slave
//   - bridge / dummy 等容器虚拟接口
//   - 名字以 lo / docker / cni / veth / virbr 等开头
//   - link 明确 down（LinkUp=false 且数据已采集到，即 SpeedMbps 非零或 Driver 非空）
func filterUsable(ifs []nodeprobe.Interface) []nodeprobe.Interface {
	out := make([]nodeprobe.Interface, 0, len(ifs))
	for _, n := range ifs {
		if n.Master != "" {
			continue // bond slave
		}
		if n.Kind == "bridge" {
			continue
		}
		name := strings.ToLower(n.Name)
		if name == "lo" || strings.HasPrefix(name, "docker") ||
			strings.HasPrefix(name, "cni") || strings.HasPrefix(name, "veth") ||
			strings.HasPrefix(name, "virbr") || strings.HasPrefix(name, "br-") {
			continue
		}
		// 已采到 ethtool 数据但明确 link down → 排除（数据未采到时 LinkUp 为 false 但
		// 不视为 down，避免在缺 ethtool 的环境全部被剔除）
		if (n.SpeedMbps > 0 || n.Driver != "") && !n.LinkUp {
			continue
		}
		out = append(out, n)
	}
	return out
}

// scoreForRole 对每个 nic 算单角色得分；返回按 score 降序排列的列表。
func scoreForRole(role Role, ifs []nodeprobe.Interface) []Candidate {
	out := make([]Candidate, 0, len(ifs))
	for _, n := range ifs {
		s, reasons := scoreNICForRole(role, n)
		if s <= 0 && len(reasons) == 0 {
			// 完全不适合该角色（如名字 / 类型不符）→ 跳过
			continue
		}
		out = append(out, Candidate{
			NIC:     n.Name,
			Score:   clamp01(s),
			Reasons: reasons,
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	// 计算 confidence（领先幅度），仅 top1 用
	for i := range out {
		if i == 0 && len(out) > 1 {
			out[i].Confidence = clamp01(out[0].Score - out[1].Score)
		} else if i == 0 {
			out[i].Confidence = out[i].Score
		} else {
			out[i].Confidence = 0 // 非 top1 不展示 confidence
		}
	}
	return out
}

// scoreNICForRole 对单个 nic 评单角色得分。返回 score 0..1+ + 中文理由列表。
//
// 评分加权器：每条规则单独评估，求和后 clamp 到 [0, 1]。理由按命中顺序记录，
// 让前端 hover 时看到"为什么这台被推荐"。
func scoreNICForRole(role Role, n nodeprobe.Interface) (float64, []string) {
	score := 0.0
	var reasons []string

	switch role {
	case RoleBridge:
		if n.IsDefaultRoute {
			score += 0.7
			reasons = append(reasons, "默认路由所在")
		}
		if n.SpeedMbps >= 1000 || n.SpeedMbps == 0 { // 0 = 速率未知，给中性加分避免缺数据被埋
			score += 0.2
		}
		if n.SpeedMbps >= 10_000 {
			score += 0.1
			reasons = append(reasons, "10G 高速链路")
		}
		// 公网 IP 启发式：地址不是 RFC1918 私网
		if hasPublicIP(n) {
			score += 0.2
			reasons = append(reasons, "已配公网 IP")
		}
		if n.SpeedMbps > 0 && n.SpeedMbps < 1000 {
			score -= 0.3
			reasons = append(reasons, "链路 < 1G（不推荐桥源）")
		}

	case RoleMgmt:
		if hasIPInCIDR(n, "10.0.10.") {
			score += 0.7
			reasons = append(reasons, "已配 mgmt 网段（10.0.10.0/24）")
		}
		if n.SpeedMbps >= 1000 && n.SpeedMbps <= 2500 {
			score += 0.2
			reasons = append(reasons, "1-2.5G 适合 mgmt")
		}
		if n.SpeedMbps >= 10_000 && !hasIPInCIDR(n, "10.0.10.") {
			score -= 0.1 // 10G 不应当 mgmt（浪费）
		}
		if n.IsDefaultRoute {
			score -= 0.4
			reasons = append(reasons, "默认路由不应作 mgmt")
		}
		if n.LinkUp || n.SpeedMbps > 0 {
			score += 0.1
		}

	case RoleCephCluster:
		if n.SpeedMbps >= 10_000 {
			score += 0.5
			reasons = append(reasons, "≥10G 链路（Ceph cluster 关键）")
		}
		if n.SpeedMbps >= 25_000 {
			score += 0.2
			reasons = append(reasons, "25G+ 链路")
		}
		if hasIPInCIDR(n, "10.0.30.") {
			score += 0.3
			reasons = append(reasons, "已配 cluster 网段（10.0.30.0/24）")
		}
		if n.IsDefaultRoute {
			score -= 0.4
			reasons = append(reasons, "默认路由不应作 ceph cluster")
		}
		// 速率不到 10G 大幅扣
		if n.SpeedMbps > 0 && n.SpeedMbps < 10_000 {
			score -= 0.5
			reasons = append(reasons, "<10G 不推荐 ceph cluster")
		}

	case RoleCephPublic:
		if n.SpeedMbps >= 10_000 {
			score += 0.4
			reasons = append(reasons, "≥10G 链路")
		}
		if hasIPInCIDR(n, "10.0.20.") {
			score += 0.4
			reasons = append(reasons, "已配 ceph public 网段（10.0.20.0/24）")
		}
		if n.IsDefaultRoute {
			score -= 0.3
		}
		if n.SpeedMbps > 0 && n.SpeedMbps < 10_000 {
			score -= 0.3
			reasons = append(reasons, "<10G 不推荐 ceph public")
		}
	}

	if n.Kind == "bond" {
		score += 0.05
		reasons = append(reasons, "bond 聚合（高可用）")
	}

	return score, reasons
}

func hasIPInCIDR(n nodeprobe.Interface, prefix string) bool {
	for _, a := range n.Addresses {
		if strings.HasPrefix(stripCIDR(a), prefix) {
			return true
		}
	}
	return false
}

// hasPublicIP 启发式：interface 上是否有非 RFC1918 / 非 link-local 的 IPv4。
func hasPublicIP(n nodeprobe.Interface) bool {
	for _, a := range n.Addresses {
		ip := stripCIDR(a)
		if ip == "" {
			continue
		}
		// 仅判断 IPv4 简单 case；IPv6 略
		if strings.HasPrefix(ip, "10.") ||
			strings.HasPrefix(ip, "192.168.") ||
			strings.HasPrefix(ip, "169.254.") ||
			strings.HasPrefix(ip, "127.") {
			continue
		}
		// 172.16.0.0/12 简化为 172.16-31
		if strings.HasPrefix(ip, "172.") {
			parts := strings.Split(ip, ".")
			if len(parts) >= 2 {
				if v := atoiSafe(parts[1]); v >= 16 && v <= 31 {
					continue
				}
			}
		}
		return true
	}
	return false
}

func atoiSafe(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return -1
		}
		n = n*10 + int(c-'0')
	}
	return n
}

func stripCIDR(addr string) string {
	if i := strings.IndexByte(addr, '/'); i > 0 {
		return addr[:i]
	}
	return addr
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}
