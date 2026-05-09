package rebalance

import (
	"testing"
)

// PLAN-037 / OPS-040 unit tests for the rebalance algorithm.

func gb(n int64) int64 { return n * (1 << 30) }

func TestCompute_Balanced_NoSuggestions(t *testing.T) {
	nodes := []NodeCapacity{
		{Name: "n1", MemTotal: gb(64), MemUsed: gb(20), Online: true},
		{Name: "n2", MemTotal: gb(64), MemUsed: gb(22), Online: true},
		{Name: "n3", MemTotal: gb(64), MemUsed: gb(21), Online: true},
	}
	plan := Compute(nodes, nil, Default())
	if plan.Stats.Imbalanced && plan.Stats.StdDev > 0.20 {
		t.Fatalf("balanced cluster should not be flagged imbalanced; got stats %+v", plan.Stats)
	}
	if len(plan.Suggestions) != 0 {
		t.Fatalf("balanced cluster should yield 0 suggestions; got %d", len(plan.Suggestions))
	}
}

func TestCompute_Imbalanced_GeneratesSuggestion(t *testing.T) {
	nodes := []NodeCapacity{
		{Name: "hot", MemTotal: gb(64), MemUsed: gb(56), Online: true},  // 87.5% util
		{Name: "cold1", MemTotal: gb(64), MemUsed: gb(8), Online: true}, // 12.5%
		{Name: "cold2", MemTotal: gb(64), MemUsed: gb(8), Online: true}, // 12.5%
	}
	vms := []VM{
		{Name: "vm-a", Project: "customers", Node: "hot", MemoryMB: 8 * 1024},
		{Name: "vm-b", Project: "customers", Node: "hot", MemoryMB: 16 * 1024},
		{Name: "vm-c", Project: "customers", Node: "hot", MemoryMB: 4 * 1024},
	}
	plan := Compute(nodes, vms, Default())
	if !plan.Stats.Imbalanced {
		t.Fatalf("expected imbalanced; got %+v", plan.Stats)
	}
	if len(plan.Suggestions) == 0 {
		t.Fatalf("expected suggestions; got 0")
	}
	// 第一条建议应该把最大 VM (vm-b 16G) 从 hot 迁出
	first := plan.Suggestions[0]
	if first.SourceNode != "hot" {
		t.Fatalf("expected source=hot, got %s", first.SourceNode)
	}
	if first.VMName != "vm-b" {
		t.Fatalf("expected first migration to be biggest VM (vm-b); got %s", first.VMName)
	}
	if first.Score <= 0 {
		t.Fatalf("expected score > 0; got %f", first.Score)
	}
}

func TestCompute_MaintenanceNodeCannotReceive(t *testing.T) {
	nodes := []NodeCapacity{
		{Name: "hot", MemTotal: gb(64), MemUsed: gb(50), Online: true},
		{Name: "maint", MemTotal: gb(64), MemUsed: gb(8), Online: true, Maintenance: true},
		{Name: "cold", MemTotal: gb(64), MemUsed: gb(12), Online: true},
	}
	vms := []VM{
		{Name: "vm-a", Project: "customers", Node: "hot", MemoryMB: 8 * 1024},
	}
	plan := Compute(nodes, vms, Default())
	for _, s := range plan.Suggestions {
		if s.TargetNode == "maint" {
			t.Fatalf("maintenance node should not receive: %+v", s)
		}
	}
}

func TestCompute_OfflineSourceStillSuggested(t *testing.T) {
	// 离线/maintenance 节点也应当被作为 hot：把 VM 迁走是正确的运维动作
	nodes := []NodeCapacity{
		{Name: "stuck", MemTotal: gb(64), MemUsed: gb(60), Online: false, Maintenance: true},
		{Name: "ok", MemTotal: gb(64), MemUsed: gb(8), Online: true},
	}
	vms := []VM{
		{Name: "vm-stuck-a", Project: "customers", Node: "stuck", MemoryMB: 4 * 1024},
	}
	plan := Compute(nodes, vms, Default())
	if len(plan.Suggestions) == 0 {
		t.Fatalf("expected at least one suggestion for stuck VM")
	}
	if plan.Suggestions[0].SourceNode != "stuck" {
		t.Fatalf("expected stuck node as source; got %s", plan.Suggestions[0].SourceNode)
	}
}

func TestCompute_RespectsMaxSuggestions(t *testing.T) {
	nodes := []NodeCapacity{
		{Name: "hot", MemTotal: gb(256), MemUsed: gb(200), Online: true},
		{Name: "cold", MemTotal: gb(256), MemUsed: gb(20), Online: true},
	}
	var vms []VM
	for i := 0; i < 30; i++ {
		vms = append(vms, VM{
			Name: "vm-" + itoa(i), Project: "customers", Node: "hot", MemoryMB: 4 * 1024,
		})
	}
	opt := Default()
	opt.MaxSuggestions = 5
	plan := Compute(nodes, vms, opt)
	if len(plan.Suggestions) > 5 {
		t.Fatalf("expected ≤5 suggestions; got %d", len(plan.Suggestions))
	}
}

func TestCompute_EmptyClusterOK(t *testing.T) {
	plan := Compute(nil, nil, Default())
	if plan.Stats.Imbalanced {
		t.Fatalf("empty cluster should not be imbalanced")
	}
	if len(plan.Suggestions) != 0 {
		t.Fatalf("expected 0 suggestions; got %d", len(plan.Suggestions))
	}
}

func TestCompute_TargetCapacityRespected(t *testing.T) {
	// hot 上有一台超大 VM，cold 装不下 → 该 VM 不应出现在建议里
	nodes := []NodeCapacity{
		{Name: "hot", MemTotal: gb(64), MemUsed: gb(56), Online: true},
		{Name: "cold", MemTotal: gb(8), MemUsed: gb(2), Online: true}, // 只剩 6G
	}
	vms := []VM{
		{Name: "huge", Project: "customers", Node: "hot", MemoryMB: 32 * 1024},
		{Name: "fits", Project: "customers", Node: "hot", MemoryMB: 4 * 1024},
	}
	plan := Compute(nodes, vms, Default())
	for _, s := range plan.Suggestions {
		if s.VMName == "huge" {
			t.Fatalf("oversized VM should not be suggested: %+v", s)
		}
	}
}

func itoa(n int) string {
	return formatInt(n)
}
