package main

import (
	"testing"
)

// OPS-027 / PLAN-029 回归保护：clusterFromDB 走 DB-load 时必须填好 Projects，
// 否则 ListClusterVMs fallback 到 ["default"] 漏掉 customers project 里的 VM。
func TestDefaultProjectsFor(t *testing.T) {
	cases := []struct {
		name           string
		defaultProject string
		want           []string
	}{
		{"空 DefaultProject 仅 default", "", []string{"default"}},
		{"DefaultProject == default 去重", "default", []string{"default"}},
		{"DefaultProject == customers 双 project", "customers", []string{"default", "customers"}},
		{"自定义 DefaultProject", "internal", []string{"default", "internal"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := defaultProjectsFor(tc.defaultProject)
			if len(got) != len(tc.want) {
				t.Fatalf("len = %d, want %d (%v)", len(got), len(tc.want), got)
			}
			for i, p := range got {
				if p.Name != tc.want[i] {
					t.Errorf("Projects[%d].Name = %q, want %q", i, p.Name, tc.want[i])
				}
			}
			if got[0].Name != "default" {
				t.Errorf("first project must be 'default', got %q", got[0].Name)
			}
		})
	}
}
