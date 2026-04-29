package config

import (
	"testing"
)

func TestLoadIPPools_JSON(t *testing.T) {
	t.Setenv("CLUSTER_IP_POOLS_JSON", `[
		{"cidr":"202.151.179.0/26","gateway":"202.151.179.62","range":"202.151.179.10-202.151.179.61","vlan":376},
		{"cidr":"202.151.179.224/27","gateway":"202.151.179.225","range":"202.151.179.235-202.151.179.254","vlan":376}
	]`)
	// Legacy single-pool env present — JSON must still win.
	t.Setenv("CLUSTER_IP_RANGE", "legacy-should-be-ignored")

	got := loadIPPools()
	if len(got) != 2 {
		t.Fatalf("want 2 pools, got %d: %+v", len(got), got)
	}
	if got[0].CIDR != "202.151.179.0/26" || got[0].VLAN != 376 {
		t.Errorf("first pool mismatch: %+v", got[0])
	}
	if got[1].CIDR != "202.151.179.224/27" || got[1].Range != "202.151.179.235-202.151.179.254" {
		t.Errorf("second pool mismatch: %+v", got[1])
	}
}

func TestLoadIPPools_LegacySinglePool(t *testing.T) {
	t.Setenv("CLUSTER_IP_POOLS_JSON", "")
	t.Setenv("CLUSTER_IP_CIDR", "10.0.0.0/24")
	t.Setenv("CLUSTER_IP_GATEWAY", "10.0.0.1")
	t.Setenv("CLUSTER_IP_RANGE", "10.0.0.10-10.0.0.250")

	got := loadIPPools()
	if len(got) != 1 {
		t.Fatalf("want 1 pool, got %d", len(got))
	}
	if got[0].CIDR != "10.0.0.0/24" || got[0].Gateway != "10.0.0.1" || got[0].VLAN != 376 {
		t.Errorf("legacy pool mismatch: %+v", got[0])
	}
}

func TestLoadIPPools_Empty(t *testing.T) {
	t.Setenv("CLUSTER_IP_POOLS_JSON", "")
	t.Setenv("CLUSTER_IP_RANGE", "")

	if got := loadIPPools(); got != nil {
		t.Fatalf("want nil, got %+v", got)
	}
}

func TestLoadIPPools_BadJSONFallsThrough(t *testing.T) {
	t.Setenv("CLUSTER_IP_POOLS_JSON", "not-valid-json")
	t.Setenv("CLUSTER_IP_CIDR", "10.0.0.0/24")
	t.Setenv("CLUSTER_IP_GATEWAY", "10.0.0.1")
	t.Setenv("CLUSTER_IP_RANGE", "10.0.0.10-10.0.0.250")

	got := loadIPPools()
	if len(got) != 1 {
		t.Fatalf("want legacy pool after bad JSON, got %d pools", len(got))
	}
	if got[0].CIDR != "10.0.0.0/24" {
		t.Errorf("legacy fallback mismatch: %+v", got[0])
	}
}
