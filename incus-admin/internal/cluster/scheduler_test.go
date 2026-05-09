package cluster

import (
	"os"
	"testing"
)

// PLAN-039 / OPS-042 多维度评分单测。

func TestScoreNode_OnlineHealthy(t *testing.T) {
	w := schedWeights{mem: 0.5, cpu: 0.4, disk: 0.1}
	n := NodeInfo{
		Status:        "Online",
		FreeRatio:     0.8,
		CPUFreeRatio:  0.9,
		DiskFreeRatio: 0.5,
	}
	got := scoreNode(n, w)
	want := 0.5*0.8 + 0.4*0.9 + 0.1*0.5 // 0.4 + 0.36 + 0.05 = 0.81
	if got < want-0.001 || got > want+0.001 {
		t.Fatalf("score=%v want %v", got, want)
	}
}

func TestScoreNode_MaintenanceZero(t *testing.T) {
	n := NodeInfo{
		Status:        "Online",
		FreeRatio:     0.9,
		CPUFreeRatio:  0.9,
		DiskFreeRatio: 0.9,
		Maintenance:   true,
	}
	if got := scoreNode(n, schedWeights{0.5, 0.4, 0.1}); got != 0 {
		t.Fatalf("maintenance score=%v want 0", got)
	}
}

func TestScoreNode_EvacuatedZero(t *testing.T) {
	n := NodeInfo{
		Status:        "Online",
		FreeRatio:     0.9,
		CPUFreeRatio:  0.9,
		DiskFreeRatio: 0.9,
		Evacuated:     true,
	}
	if got := scoreNode(n, schedWeights{0.5, 0.4, 0.1}); got != 0 {
		t.Fatalf("evacuated score=%v want 0", got)
	}
}

func TestScoreNode_OfflineZero(t *testing.T) {
	n := NodeInfo{Status: "Offline", FreeRatio: 0.9, CPUFreeRatio: 0.9, DiskFreeRatio: 0.9}
	if got := scoreNode(n, schedWeights{0.5, 0.4, 0.1}); got != 0 {
		t.Fatalf("offline score=%v want 0", got)
	}
}

func TestScoreNode_DiskMissingNeutral(t *testing.T) {
	// disk=0 → 中性 0.5（避免 disk 数据未拉到时把节点压成 0）
	w := schedWeights{mem: 0.5, cpu: 0.4, disk: 0.1}
	n := NodeInfo{
		Status:       "Online",
		FreeRatio:    0.6,
		CPUFreeRatio: 0.7,
		DiskFreeRatio: 0,
	}
	got := scoreNode(n, w)
	want := 0.5*0.6 + 0.4*0.7 + 0.1*0.5 // 0.3 + 0.28 + 0.05 = 0.63
	if got < want-0.001 || got > want+0.001 {
		t.Fatalf("disk-missing score=%v want %v", got, want)
	}
}

func TestScoreNode_ClampOutOfRange(t *testing.T) {
	// FreeRatio 1.5 / -0.2 / NaN 等异常值应被 clamp01 兜住
	w := schedWeights{mem: 0.5, cpu: 0.4, disk: 0.1}
	n := NodeInfo{
		Status:        "Online",
		FreeRatio:     1.5,
		CPUFreeRatio:  -0.2,
		DiskFreeRatio: 2.0,
	}
	got := scoreNode(n, w)
	want := 0.5*1.0 + 0.4*0 + 0.1*1.0 // 0.5 + 0 + 0.1 = 0.6
	if got < want-0.001 || got > want+0.001 {
		t.Fatalf("clamped score=%v want %v", got, want)
	}
}

func TestLoadWeights_Default(t *testing.T) {
	t.Setenv("SCHEDULER_WEIGHTS", "")
	w := loadWeights()
	if w.mem != 0.5 || w.cpu != 0.4 || w.disk != 0.1 {
		t.Fatalf("default weights mismatch: %+v", w)
	}
}

func TestLoadWeights_OverrideNormalized(t *testing.T) {
	// 5,4,1 应归一化为 0.5,0.4,0.1
	t.Setenv("SCHEDULER_WEIGHTS", "5,4,1")
	w := loadWeights()
	if w.mem < 0.499 || w.mem > 0.501 || w.cpu < 0.399 || w.cpu > 0.401 || w.disk < 0.099 || w.disk > 0.101 {
		t.Fatalf("normalized weights mismatch: %+v", w)
	}
}

func TestLoadWeights_Invalid(t *testing.T) {
	t.Setenv("SCHEDULER_WEIGHTS", "1,2") // 少一个组件
	w := loadWeights()
	if w.mem != 0.5 || w.cpu != 0.4 || w.disk != 0.1 {
		t.Fatalf("invalid input should fall back to defaults; got %+v", w)
	}
	t.Setenv("SCHEDULER_WEIGHTS", "abc,def,ghi")
	w = loadWeights()
	if w.mem != 0.5 || w.cpu != 0.4 || w.disk != 0.1 {
		t.Fatalf("non-numeric input should fall back to defaults; got %+v", w)
	}
}

func TestPickNode_OrdersByScore(t *testing.T) {
	// 用纯函数路径模拟（绕开 cluster Manager 的 IO）
	s := &Scheduler{cache: map[string][]NodeInfo{}, weights: schedWeights{0.5, 0.4, 0.1}}
	s.cache["c0"] = []NodeInfo{
		// hot：mem 紧张
		{Name: "n1", Status: "Online", Message: "Fully operational", FreeRatio: 0.1, CPUFreeRatio: 0.5, DiskFreeRatio: 0.5, Score: 0},
		// cold：mem 充裕
		{Name: "n2", Status: "Online", Message: "Fully operational", FreeRatio: 0.9, CPUFreeRatio: 0.9, DiskFreeRatio: 0.5, Score: 0},
		// 维护态：必须被剔除
		{Name: "n3", Status: "Online", Message: "Fully operational", FreeRatio: 0.95, CPUFreeRatio: 0.95, Maintenance: true, Score: 0},
	}
	// 重算 score（refreshCluster 内部已算；这里手动）
	for i := range s.cache["c0"] {
		s.cache["c0"][i].Score = scoreNode(s.cache["c0"][i], s.weights)
	}
	got, err := s.PickNode("c0")
	if err != nil {
		t.Fatalf("PickNode err: %v", err)
	}
	if got != "n2" {
		t.Fatalf("expected n2 (highest score, non-maint), got %s", got)
	}
}

func TestPickNode_AllUnavailable(t *testing.T) {
	s := &Scheduler{cache: map[string][]NodeInfo{}, weights: schedWeights{0.5, 0.4, 0.1}}
	s.cache["c0"] = []NodeInfo{
		{Name: "n1", Status: "Offline"},
		{Name: "n2", Status: "Online", Maintenance: true},
		{Name: "n3", Status: "Online", Evacuated: true},
	}
	if _, err := s.PickNode("c0"); err == nil {
		t.Fatalf("expected error when no candidates available")
	}
}

func TestClamp01(t *testing.T) {
	cases := []struct {
		in, want float64
	}{
		{0.5, 0.5},
		{1.5, 1.0},
		{-0.5, 0},
		{0, 0},
		{1, 1},
	}
	for _, c := range cases {
		if got := clamp01(c.in); got != c.want {
			t.Errorf("clamp01(%v)=%v want %v", c.in, got, c.want)
		}
	}
	// NaN 测试不能直接比较，单独检查
	if got := clamp01(parseNaN()); got != 0 {
		t.Errorf("clamp01(NaN)=%v want 0", got)
	}
}

func parseNaN() float64 {
	// math.NaN() 不引入新 import：手算
	zero := 0.0
	return zero / (zero + 0) // 编译器会通过；运行时 NaN
}

// TestSchedWeightsFromEnv_NormalizationStable 防回归：归一化后总和应 == 1.0
func TestSchedWeightsFromEnv_NormalizationStable(t *testing.T) {
	for _, raw := range []string{"5,4,1", "0.5,0.4,0.1", "10,8,2", "100,80,20"} {
		os.Setenv("SCHEDULER_WEIGHTS", raw)
		w := loadWeights()
		sum := w.mem + w.cpu + w.disk
		if sum < 0.999 || sum > 1.001 {
			t.Errorf("weights from %q not normalized to 1: sum=%v (%+v)", raw, sum, w)
		}
	}
	os.Unsetenv("SCHEDULER_WEIGHTS")
}
