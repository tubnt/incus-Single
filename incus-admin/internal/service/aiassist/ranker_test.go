package aiassist

import (
	"testing"

	"github.com/incuscloud/incus-admin/internal/service/nodeprobe"
)

// PLAN-038 / OPS-041 Phase A：Tier 1 ranker 单测。
//
// 覆盖关键启发式：默认路由偏向 bridge / mgmt 网段 / ceph 高速链路 / 排除 bond
// slave / link down 排除 / 完全空输入安全。

func ifc(name string, opts ...func(*nodeprobe.Interface)) nodeprobe.Interface {
	n := nodeprobe.Interface{Name: name, Kind: "ether", LinkUp: true}
	for _, o := range opts {
		o(&n)
	}
	return n
}

func withSpeed(s int) func(*nodeprobe.Interface)        { return func(n *nodeprobe.Interface) { n.SpeedMbps = s } }
func withDefault() func(*nodeprobe.Interface)            { return func(n *nodeprobe.Interface) { n.IsDefaultRoute = true } }
func withAddr(a string) func(*nodeprobe.Interface)       { return func(n *nodeprobe.Interface) { n.Addresses = append(n.Addresses, a) } }
func withMaster(m string) func(*nodeprobe.Interface)     { return func(n *nodeprobe.Interface) { n.Master = m } }
func withKind(k string) func(*nodeprobe.Interface)       { return func(n *nodeprobe.Interface) { n.Kind = k } }
func withDriver(d string) func(*nodeprobe.Interface)     { return func(n *nodeprobe.Interface) { n.Driver = d } }
func withLinkDown() func(*nodeprobe.Interface)           { return func(n *nodeprobe.Interface) { n.LinkUp = false } }

func TestRankNICRoles_TypicalCluster(t *testing.T) {
	// 标准 5 节点拓扑：eno1 公网 / enp1s0 mgmt 1G / ens3 ceph cluster 25G / ens4 ceph public 10G
	info := &nodeprobe.NodeInfo{
		Interfaces: []nodeprobe.Interface{
			ifc("eno1", withSpeed(1000), withDefault(), withAddr("202.151.179.226/26")),
			ifc("enp1s0", withSpeed(1000), withAddr("10.0.10.1/24")),
			ifc("ens3", withSpeed(25000), withAddr("10.0.30.1/24")),
			ifc("ens4", withSpeed(10000), withAddr("10.0.20.1/24")),
		},
	}
	r := RankNICRoles(info)
	// 4 角色都应有 top1
	wants := map[Role]string{
		RoleBridge:      "eno1",
		RoleMgmt:        "enp1s0",
		RoleCephCluster: "ens3",
		RoleCephPublic:  "ens4",
	}
	for _, rc := range r.Roles {
		if len(rc.Candidates) == 0 {
			t.Errorf("role %s no candidates", rc.Role)
			continue
		}
		if got := rc.Candidates[0].NIC; got != wants[rc.Role] {
			t.Errorf("role %s top1 = %q; want %q", rc.Role, got, wants[rc.Role])
		}
	}
	if r.OverallConfidence <= 0 {
		t.Errorf("expected >0 overall confidence, got %v", r.OverallConfidence)
	}
}

func TestRankNICRoles_BondSlavesExcluded(t *testing.T) {
	info := &nodeprobe.NodeInfo{
		Interfaces: []nodeprobe.Interface{
			ifc("eno1", withMaster("bond0"), withSpeed(10000)), // slave，应剔除
			ifc("eno2", withMaster("bond0"), withSpeed(10000)), // slave，应剔除
			ifc("bond0", withKind("bond"), withSpeed(20000), withAddr("10.0.30.1/24")),
		},
	}
	r := RankNICRoles(info)
	for _, rc := range r.Roles {
		for _, c := range rc.Candidates {
			if c.NIC == "eno1" || c.NIC == "eno2" {
				t.Errorf("bond slave %s should be excluded from %s", c.NIC, rc.Role)
			}
		}
	}
	// bond0 应当是 ceph_cluster top1（25G + 10.0.30.x）
	for _, rc := range r.Roles {
		if rc.Role == RoleCephCluster && len(rc.Candidates) > 0 && rc.Candidates[0].NIC != "bond0" {
			t.Errorf("expected bond0 as ceph_cluster top1; got %v", rc.Candidates)
		}
	}
}

func TestRankNICRoles_LinkDownExcluded(t *testing.T) {
	// 一台有 ethtool 数据但 link down 的网卡 — 应被排除
	info := &nodeprobe.NodeInfo{
		Interfaces: []nodeprobe.Interface{
			ifc("eno1", withSpeed(1000), withDriver("igb"), withDefault()),
			ifc("eno2", withSpeed(10000), withDriver("ixgbe"), withLinkDown()), // link down 应剔除
		},
	}
	r := RankNICRoles(info)
	for _, rc := range r.Roles {
		for _, c := range rc.Candidates {
			if c.NIC == "eno2" {
				t.Errorf("link-down %s should be excluded from %s", c.NIC, rc.Role)
			}
		}
	}
}

func TestRankNICRoles_VirtualIfaceExcluded(t *testing.T) {
	info := &nodeprobe.NodeInfo{
		Interfaces: []nodeprobe.Interface{
			ifc("eno1", withSpeed(1000), withDefault()),
			ifc("docker0", withKind("bridge")),
			ifc("veth123", withSpeed(10000)),
			ifc("br-pub", withKind("bridge")),
			ifc("lo", withSpeed(0)),
		},
	}
	r := RankNICRoles(info)
	for _, rc := range r.Roles {
		for _, c := range rc.Candidates {
			switch c.NIC {
			case "docker0", "veth123", "br-pub", "lo":
				t.Errorf("virtual %s should be excluded from %s", c.NIC, rc.Role)
			}
		}
	}
}

func TestRankNICRoles_MissingEthtoolDataNeutral(t *testing.T) {
	// 当 ethtool 数据缺失（SpeedMbps=0, Driver=""），ranker 不能因此排除
	info := &nodeprobe.NodeInfo{
		Interfaces: []nodeprobe.Interface{
			ifc("eno1", withDefault(), withAddr("202.151.179.226/26")), // 无 speed/driver/link 数据
		},
	}
	r := RankNICRoles(info)
	hasBridge := false
	for _, rc := range r.Roles {
		if rc.Role == RoleBridge && len(rc.Candidates) > 0 && rc.Candidates[0].NIC == "eno1" {
			hasBridge = true
		}
	}
	if !hasBridge {
		t.Errorf("eno1 should still be bridge candidate even without ethtool data")
	}
}

func TestRankNICRoles_EmptyInputSafe(t *testing.T) {
	if r := RankNICRoles(nil); len(r.Roles) != 0 {
		t.Errorf("nil input should return empty result; got %v", r)
	}
	if r := RankNICRoles(&nodeprobe.NodeInfo{}); len(r.Roles) != 0 {
		t.Errorf("empty interfaces should return empty result; got %v", r)
	}
}

func TestRankNICRoles_DefaultRouteDoesntDoubleAsCephCluster(t *testing.T) {
	// 默认路由网卡 + 25G — 不该被推 ceph_cluster top1（应让位给非默认路由 NIC）
	info := &nodeprobe.NodeInfo{
		Interfaces: []nodeprobe.Interface{
			ifc("eno1", withSpeed(25000), withDefault(), withAddr("202.151.179.226/26")),
			ifc("ens3", withSpeed(10000), withAddr("10.0.30.1/24")), // 非默认路由 + 10G + 在 cluster 网段
		},
	}
	r := RankNICRoles(info)
	for _, rc := range r.Roles {
		if rc.Role == RoleCephCluster && len(rc.Candidates) > 0 && rc.Candidates[0].NIC != "ens3" {
			t.Errorf("expected ens3 as ceph_cluster top1 (non-default-route + cluster CIDR); got %v", rc.Candidates)
		}
	}
}

func TestPCIQuoted_LspciFormat(t *testing.T) {
	cases := []struct {
		raw      string
		wantSlot string
		wantVend string
	}{
		{
			`0000:01:00.0 "Ethernet controller" "Intel Corporation" "82599ES 10-Gigabit"`,
			"0000:01:00.0", "Intel Corporation",
		},
		{
			`0000:02:00.0 "Network controller" "Mellanox Technologies" "MT27520"`,
			"0000:02:00.0", "Mellanox Technologies",
		},
	}
	for _, c := range cases {
		dev := nodeprobe.PCIDevice{}
		_ = dev // placeholder; lspci parser lives in nodeprobe pkg, not here
		_ = c
	}
	// 实际 parseLspciEth 测试在 nodeprobe 包；这里只是占位提醒覆盖路径
}
