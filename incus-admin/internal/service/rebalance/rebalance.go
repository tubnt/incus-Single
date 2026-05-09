// Package rebalance 计算 cluster 的 VM 不均衡程度并提供"建议迁移列表"。
//
// 设计目标：
//
//   - 仅给出 ranked 建议，**不直接执行**（执行体走 cluster.vm.migrate-batch job）
//   - 算法纯函数：输入节点容量 / VM 列表 → 输出 plan，便于单测覆盖
//   - 不假设 live migration（业内主流仍是冷迁移；OPS-008 #5）
//
// PLAN-037 / OPS-040.
package rebalance

import (
	"math"
	"sort"
	"strings"
)

// NodeCapacity 描述一个节点当前容量画像。Memory 用 byte 计数，与 Incus
// /1.0/resources?target=<member> 同口径。MemUsed 0 → 节点不可调度（视作满）。
type NodeCapacity struct {
	Name        string
	MemTotal    int64
	MemUsed     int64
	VMCount     int
	Maintenance bool // scheduler.instance == "manual" → 不接收新 VM
	Online      bool // status == "Online"
}

// VM 描述一台候选迁移 VM。Project 必填，executor 按 project 路由。
type VM struct {
	Name      string
	Project   string
	Node      string // 当前所在节点
	MemoryMB  int64  // 估算占用，用作迁移后容量调整
}

// Suggestion 是给用户的一条建议：把 VM 从 source 迁到 target。
type Suggestion struct {
	VMName     string  `json:"vm_name"`
	Project    string  `json:"project"`
	SourceNode string  `json:"source_node"`
	TargetNode string  `json:"target_node"`
	Reason     string  `json:"reason"`
	Score      float64 `json:"score"` // 越大越值得迁移（高负载差 + 低风险）
}

// Stats 是当前集群分布的指标快照，用作前端 banner。
type Stats struct {
	Mean        float64 `json:"mean_util"`
	StdDev      float64 `json:"stddev"`
	MaxDiff     float64 `json:"max_diff"`
	HotNode     string  `json:"hot_node,omitempty"`
	ColdNode    string  `json:"cold_node,omitempty"`
	Imbalanced  bool    `json:"imbalanced"`
}

// Plan 把统计 + 建议拼到一起返给 endpoint。
type Plan struct {
	Stats       Stats        `json:"stats"`
	Suggestions []Suggestion `json:"suggestions"`
}

// Options 控制算法行为，留作前端调参（默认值已在 Default 里）。
type Options struct {
	// MaxSuggestions 上限；默认 8 防止 plan 过长。
	MaxSuggestions int
	// ImbalanceThreshold 触发"建议"的 stddev 阈值；默认 0.20（20%）。
	// 低于该值 stats.Imbalanced=false，suggestions=[]。
	ImbalanceThreshold float64
	// MinHotUtil 节点 mem 使用率超过此值才考虑作 source；默认 0.50（50%）。
	MinHotUtil float64
}

// Default 返回缺省参数。
func Default() Options {
	return Options{
		MaxSuggestions:     8,
		ImbalanceThreshold: 0.20,
		MinHotUtil:         0.50,
	}
}

// Compute 根据节点容量 + VM 列表 生成 Plan。
//
// 算法（贪心）：
//
//  1. 计算每节点 mem util = MemUsed / MemTotal；offline / maintenance 节点剔出
//     可调度池但仍计入"hot 候选"（用户应当把它们 evacuate）。
//  2. 算 stats.Mean / StdDev / MaxDiff；如果 stddev <= ImbalanceThreshold 直接
//     返回（imbalanced=false，suggestions=[]）。
//  3. 选 hot = utilization 最高节点 / cold = utilization 最低（且非 maintenance）。
//  4. 在 hot 上按 VM 内存降序，逐个尝试迁到当前最 cold 的 target；每迁一台后
//     重算 hot/cold 的 used，更新优先队列。直到：
//       - hot util 降到 mean 上方 +threshold 之内
//       - 或 suggestions 达到 MaxSuggestions
//       - 或没有可用 cold 接收（candidate.MemTotal-MemUsed < vm.MemoryMB）
func Compute(nodes []NodeCapacity, vms []VM, opt Options) Plan {
	if opt.MaxSuggestions <= 0 {
		opt.MaxSuggestions = Default().MaxSuggestions
	}
	if opt.ImbalanceThreshold <= 0 {
		opt.ImbalanceThreshold = Default().ImbalanceThreshold
	}
	if opt.MinHotUtil <= 0 {
		opt.MinHotUtil = Default().MinHotUtil
	}

	stats := computeStats(nodes)
	if !stats.Imbalanced || stats.StdDev <= opt.ImbalanceThreshold {
		return Plan{Stats: stats}
	}

	// 找 hot：mem util 最高节点（包含 maintenance —— 它们更应该被疏散）
	var hot *NodeCapacity
	for i := range nodes {
		n := &nodes[i]
		if n.MemTotal == 0 {
			continue
		}
		util := float64(n.MemUsed) / float64(n.MemTotal)
		if util < opt.MinHotUtil {
			continue
		}
		if hot == nil || util > float64(hot.MemUsed)/float64(hot.MemTotal) {
			hot = n
		}
	}
	if hot == nil {
		return Plan{Stats: stats}
	}

	// cold pool：非 hot、Online、!Maintenance、按剩余空间降序
	var cold []*NodeCapacity
	for i := range nodes {
		n := &nodes[i]
		if n.Name == hot.Name || !n.Online || n.Maintenance || n.MemTotal == 0 {
			continue
		}
		cold = append(cold, n)
	}
	sortByFree(cold)
	if len(cold) == 0 {
		return Plan{Stats: stats}
	}

	// 候选 VM：按 Memory 降序（先迁大的，最多收缩 hot util）
	var candidates []VM
	for _, vm := range vms {
		if vm.Node == hot.Name {
			candidates = append(candidates, vm)
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].MemoryMB > candidates[j].MemoryMB
	})

	suggestions := make([]Suggestion, 0, opt.MaxSuggestions)
	hotUsed := hot.MemUsed
	hotTotal := hot.MemTotal
	freeOfMB := func(n *NodeCapacity) int64 {
		return (n.MemTotal - n.MemUsed) / (1 << 20)
	}

	for _, vm := range candidates {
		if len(suggestions) >= opt.MaxSuggestions {
			break
		}
		if vm.MemoryMB <= 0 {
			continue
		}
		if hotTotal == 0 || float64(hotUsed)/float64(hotTotal) <= stats.Mean+opt.ImbalanceThreshold {
			break
		}
		// 找能容纳这台 VM 的最 cold 节点
		var target *NodeCapacity
		for _, c := range cold {
			if freeOfMB(c) >= vm.MemoryMB {
				target = c
				break
			}
		}
		if target == nil {
			break
		}
		score := imbalanceScore(hotUsed, hotTotal, target.MemUsed+vm.MemoryMB*(1<<20), target.MemTotal)
		suggestions = append(suggestions, Suggestion{
			VMName:     vm.Name,
			Project:    vm.Project,
			SourceNode: hot.Name,
			TargetNode: target.Name,
			Reason:     reasonFor(hot, target, vm),
			Score:      score,
		})
		// 模拟迁移后的容量
		hotUsed -= vm.MemoryMB * (1 << 20)
		target.MemUsed += vm.MemoryMB * (1 << 20)
		sortByFree(cold)
	}

	return Plan{Stats: stats, Suggestions: suggestions}
}

func computeStats(nodes []NodeCapacity) Stats {
	utils := make([]float64, 0, len(nodes))
	utilByName := make(map[string]float64, len(nodes))
	for _, n := range nodes {
		if n.MemTotal == 0 {
			continue
		}
		u := float64(n.MemUsed) / float64(n.MemTotal)
		utils = append(utils, u)
		utilByName[n.Name] = u
	}
	if len(utils) < 2 {
		return Stats{}
	}
	mean := 0.0
	for _, u := range utils {
		mean += u
	}
	mean /= float64(len(utils))

	variance := 0.0
	for _, u := range utils {
		variance += (u - mean) * (u - mean)
	}
	stddev := math.Sqrt(variance / float64(len(utils)))

	minU, maxU := math.Inf(1), math.Inf(-1)
	hot, cold := "", ""
	for name, u := range utilByName {
		if u > maxU {
			maxU = u
			hot = name
		}
		if u < minU {
			minU = u
			cold = name
		}
	}
	return Stats{
		Mean:       mean,
		StdDev:     stddev,
		MaxDiff:    maxU - minU,
		HotNode:    hot,
		ColdNode:   cold,
		Imbalanced: stddev > 0.05, // 5% 以下的散布认为是噪声
	}
}

func sortByFree(ns []*NodeCapacity) {
	sort.SliceStable(ns, func(i, j int) bool {
		fi := ns[i].MemTotal - ns[i].MemUsed
		fj := ns[j].MemTotal - ns[j].MemUsed
		return fi > fj
	})
}

func imbalanceScore(srcUsed, srcTotal, dstUsed, dstTotal int64) float64 {
	if srcTotal == 0 || dstTotal == 0 {
		return 0
	}
	srcU := float64(srcUsed) / float64(srcTotal)
	dstU := float64(dstUsed) / float64(dstTotal)
	// 迁移后 src/dst 的差距：差距越大 → score 越高
	return math.Max(0, srcU-dstU)
}

func reasonFor(hot, target *NodeCapacity, vm VM) string {
	parts := []string{}
	if hot.Maintenance {
		parts = append(parts, "source in maintenance")
	}
	if hot.MemTotal > 0 {
		parts = append(parts, "source mem util "+formatPct(float64(hot.MemUsed)/float64(hot.MemTotal)))
	}
	if target.MemTotal > 0 {
		parts = append(parts, "target mem util "+formatPct(float64(target.MemUsed)/float64(target.MemTotal)))
	}
	return strings.Join(parts, "; ")
}

func formatPct(v float64) string {
	pct := int(math.Round(v * 100))
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	return formatInt(pct) + "%"
}

func formatInt(n int) string {
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	var digits [20]byte
	i := len(digits)
	for n > 0 {
		i--
		digits[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		digits[i] = '-'
	}
	return string(digits[i:])
}
