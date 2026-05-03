package nodeprobe

import (
	"strings"
	"testing"
)

const sampleOutput = `---hostname---
node6
---os-release---
NAME="Ubuntu"
ID=ubuntu
VERSION_ID="24.04"
---kernel---
6.8.0-50-generic
---cpu---
{"lscpu":[{"field":"Model name:","data":"Intel Xeon"},{"field":"CPU(s):","data":"32"},{"field":"Core(s) per socket:","data":"16"}]}
---mem---
MemTotal:       268435456 kB
SomethingElse:  1
---ip-link---
[{"ifname":"eno1","address":"aa:bb:cc:dd:ee:01","linkinfo":{"info_kind":"ether"},"master":"bond-mgmt"},{"ifname":"bond-mgmt","address":"aa:bb:cc:dd:ee:01","linkinfo":{"info_kind":"bond"}},{"ifname":"bond-pub","address":"aa:bb:cc:dd:ee:99","linkinfo":{"info_kind":"bond"}}]
---ip-addr---
[{"ifname":"bond-mgmt","addr_info":[{"family":"inet","local":"10.0.10.6","prefixlen":24}]},{"ifname":"bond-pub","addr_info":[{"family":"inet","local":"202.151.179.231","prefixlen":27}]}]
---ip-route---
default via 202.151.179.225 dev bond-pub src 202.151.179.231
---disks---
{"blockdevices":[{"name":"nvme0n1","size":"1.8T","rota":0,"model":"Samsung","type":"disk"}]}
---incus-version---
MISSING
---ceph-version---
ceph version 18.2.0
---end---
`

func TestParse_Sample(t *testing.T) {
	info := parse(sampleOutput)
	if info.Hostname != "node6" {
		t.Errorf("hostname = %q", info.Hostname)
	}
	if info.OS.ID != "ubuntu" || info.OS.Version != "24.04" {
		t.Errorf("os = %+v", info.OS)
	}
	if info.OS.Kernel != "6.8.0-50-generic" {
		t.Errorf("kernel = %q", info.OS.Kernel)
	}
	if info.CPU.Threads != 32 || info.CPU.Cores != 16 {
		t.Errorf("cpu = %+v", info.CPU)
	}
	if info.MemoryKB != 268435456 {
		t.Errorf("memory = %d", info.MemoryKB)
	}
	if len(info.Interfaces) != 3 {
		t.Fatalf("interfaces count = %d", len(info.Interfaces))
	}
	bondMgmt := findIface(info.Interfaces, "bond-mgmt")
	if bondMgmt == nil || bondMgmt.Kind != "bond" {
		t.Fatalf("bond-mgmt missing or not bond: %+v", bondMgmt)
	}
	if len(bondMgmt.Slaves) != 1 || bondMgmt.Slaves[0] != "eno1" {
		t.Errorf("bond-mgmt slaves = %v", bondMgmt.Slaves)
	}
	if len(bondMgmt.Addresses) != 1 || !strings.HasPrefix(bondMgmt.Addresses[0], "10.0.10.6/") {
		t.Errorf("bond-mgmt addrs = %v", bondMgmt.Addresses)
	}
	bondPub := findIface(info.Interfaces, "bond-pub")
	if bondPub == nil || !bondPub.IsDefaultRoute {
		t.Errorf("bond-pub default route flag missing")
	}
	if info.PublicIPObserved != "202.151.179.231" {
		t.Errorf("public ip = %q", info.PublicIPObserved)
	}
	if info.DefaultRoute == nil || info.DefaultRoute.Interface != "bond-pub" || info.DefaultRoute.Gateway != "202.151.179.225" {
		t.Errorf("default route = %+v", info.DefaultRoute)
	}
	if len(info.Disks) != 1 || info.Disks[0].Name != "nvme0n1" || info.Disks[0].Rotational {
		t.Errorf("disks = %+v", info.Disks)
	}
	if info.IncusInstalled {
		t.Errorf("incus should be MISSING")
	}
	if !info.CephInstalled {
		t.Errorf("ceph should be installed")
	}
}

func TestSplitSections_StableOrder(t *testing.T) {
	got := splitSections("---a---\nfoo\n---b---\nbar\nbaz\n")
	if got["a"] != "foo\n" {
		t.Fatalf("a = %q", got["a"])
	}
	if got["b"] != "bar\nbaz\n" {
		t.Fatalf("b = %q", got["b"])
	}
}

func TestParseLsblkSize_String(t *testing.T) {
	cases := []struct {
		in   string
		want int64
	}{
		{"100G", 100 * (1 << 30)},
		{"512M", 512 * (1 << 20)},
		{"", 0},
	}
	for _, c := range cases {
		if got := parseLsblkSize(c.in); got != c.want {
			t.Errorf("parseLsblkSize(%q) = %d, want %d", c.in, got, c.want)
		}
	}
	// Fractional handled separately to avoid Go 1.25 untyped float-overflow check.
	got := parseLsblkSize("1.8T")
	mul := float64(int64(1) << 40)
	want := mul * 1.8
	if float64(got) < want-mul/100 || float64(got) > want+mul/100 {
		t.Errorf("parseLsblkSize(1.8T) = %d, want ~%.0f", got, want)
	}
}

func findIface(ifaces []Interface, name string) *Interface {
	for i := range ifaces {
		if ifaces[i].Name == name {
			return &ifaces[i]
		}
	}
	return nil
}
