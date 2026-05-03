// Package nodeprobe runs an idempotent read-only inventory probe against a
// candidate cluster node. PLAN-033 / OPS-039: the wizard calls Probe before
// asking the operator to confirm topology, so what the user sees in the UI
// is what the remote box really reports.
package nodeprobe

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/incuscloud/incus-admin/internal/sshexec"
)

// NodeInfo is the parsed view returned to the wizard. Field names map 1:1
// to JSON sent on the wire — the frontend confirms each item before
// proceeding.
type NodeInfo struct {
	Hostname         string      `json:"hostname"`
	OS               OSInfo      `json:"os"`
	CPU              CPUInfo     `json:"cpu"`
	MemoryKB         int64       `json:"memory_kb"`
	Interfaces       []Interface `json:"interfaces"`
	DefaultRoute     *Route      `json:"default_route,omitempty"`
	PublicIPObserved string      `json:"public_ip_observed,omitempty"`
	Disks            []Disk      `json:"disks"`
	IncusInstalled   bool        `json:"incus_installed"`
	CephInstalled    bool        `json:"ceph_installed"`
}

type OSInfo struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Kernel  string `json:"kernel"`
}

type CPUInfo struct {
	Model   string `json:"model"`
	Cores   int    `json:"cores"`
	Threads int    `json:"threads"`
}

type Interface struct {
	Name           string   `json:"name"`
	Kind           string   `json:"kind"` // "ether", "bond", "bridge", "vlan", ...
	MAC            string   `json:"mac,omitempty"`
	SpeedMbps      int      `json:"speed_mbps,omitempty"`
	Slaves         []string `json:"slaves,omitempty"`
	Master         string   `json:"master,omitempty"`
	Addresses      []string `json:"addresses,omitempty"`
	IsDefaultRoute bool     `json:"is_default_route,omitempty"`
}

type Route struct {
	Interface string `json:"interface"`
	Gateway   string `json:"gateway,omitempty"`
	Source    string `json:"source,omitempty"`
}

type Disk struct {
	Name       string `json:"name"`
	SizeBytes  int64  `json:"size_bytes,omitempty"`
	Rotational bool   `json:"rotational"`
	Model      string `json:"model,omitempty"`
	Type       string `json:"type,omitempty"`
}

// Probe uploads the embedded probe-node.sh, runs it via `bash -s` over the
// existing Runner, and parses the section-delimited output. Any section that
// fails to parse degrades to an empty value rather than aborting the whole
// probe — operators get partial info instead of nothing.
func Probe(ctx context.Context, runner *sshexec.Runner) (*NodeInfo, error) {
	scriptBytes, err := sshexec.ScriptBytes("probe-node.sh")
	if err != nil {
		return nil, fmt.Errorf("load probe-node.sh: %w", err)
	}
	// Stream the script to bash via stdin so no tmp file is left behind on
	// the target. `bash -s` reads the script from stdin.
	out, runErr := runner.RunWithStdin(ctx, "bash -s", scriptBytes)
	if runErr != nil && out == "" {
		return nil, classifyErr(runErr)
	}
	info := parse(out)
	return info, nil
}

// classifyErr maps SSH-layer errors into typed wizard-friendly errors so the
// UI can render the right hint (auth vs network vs script failure).
var (
	ErrConnRefused = errors.New("connection refused")
	ErrAuthFailed  = errors.New("ssh authentication failed")
	ErrTimeout     = errors.New("ssh timeout")
)

func classifyErr(err error) error {
	if err == nil {
		return nil
	}
	s := err.Error()
	switch {
	case strings.Contains(s, "connection refused"):
		return fmt.Errorf("%w: %v", ErrConnRefused, err)
	case strings.Contains(s, "unable to authenticate"), strings.Contains(s, "no supported methods remain"):
		return fmt.Errorf("%w: %v", ErrAuthFailed, err)
	case strings.Contains(s, "i/o timeout"), strings.Contains(s, "context deadline exceeded"):
		return fmt.Errorf("%w: %v", ErrTimeout, err)
	}
	return err
}

// parse splits the probe-node.sh output into sections and decodes each one.
func parse(raw string) *NodeInfo {
	sections := splitSections(raw)
	info := &NodeInfo{}
	info.Hostname = strings.TrimSpace(sections["hostname"])
	info.OS = parseOSRelease(sections["os-release"])
	info.OS.Kernel = strings.TrimSpace(sections["kernel"])
	info.CPU = parseCPU(sections["cpu"])
	info.MemoryKB = parseMemory(sections["mem"])
	info.Interfaces = parseInterfaces(sections["ip-link"], sections["ip-addr"])
	info.DefaultRoute = parseRoute(sections["ip-route"])
	if info.DefaultRoute != nil {
		for i := range info.Interfaces {
			if info.Interfaces[i].Name == info.DefaultRoute.Interface {
				info.Interfaces[i].IsDefaultRoute = true
				for _, a := range info.Interfaces[i].Addresses {
					if ip := stripCIDR(a); ip != "" {
						info.PublicIPObserved = ip
						break
					}
				}
				break
			}
		}
	}
	info.Disks = parseDisks(sections["disks"])
	info.IncusInstalled = !strings.Contains(strings.TrimSpace(sections["incus-version"]), "MISSING")
	info.CephInstalled = !strings.Contains(strings.TrimSpace(sections["ceph-version"]), "MISSING")
	return info
}

var sectionMarker = regexp.MustCompile(`^---([a-z][a-z0-9-]*)---$`)

func splitSections(raw string) map[string]string {
	sections := make(map[string]string)
	scanner := bufio.NewScanner(strings.NewReader(raw))
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	current := ""
	var b strings.Builder
	flush := func() {
		if current != "" {
			sections[current] = b.String()
		}
	}
	for scanner.Scan() {
		line := scanner.Text()
		if m := sectionMarker.FindStringSubmatch(line); m != nil {
			flush()
			current = m[1]
			b.Reset()
			continue
		}
		if current == "" {
			continue
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	flush()
	return sections
}

func parseOSRelease(raw string) OSInfo {
	out := OSInfo{}
	for _, line := range strings.Split(raw, "\n") {
		k, v, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}
		v = strings.Trim(v, `"`)
		switch k {
		case "ID":
			out.ID = v
		case "VERSION_ID":
			out.Version = v
		}
	}
	return out
}

type lscpuJSON struct {
	Lscpu []struct {
		Field    string `json:"field"`
		Data     string `json:"data"`
		Children []struct {
			Field string `json:"field"`
			Data  string `json:"data"`
		} `json:"children,omitempty"`
	} `json:"lscpu"`
}

func parseCPU(raw string) CPUInfo {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return CPUInfo{}
	}
	if strings.HasPrefix(raw, "{") {
		var j lscpuJSON
		if err := json.Unmarshal([]byte(raw), &j); err == nil {
			return cpuFromJSON(j)
		}
	}
	// Plain `lscpu` text fallback.
	return cpuFromText(raw)
}

func cpuFromJSON(j lscpuJSON) CPUInfo {
	out := CPUInfo{}
	walk := func(field, data string) {
		switch strings.TrimSpace(strings.TrimSuffix(field, ":")) {
		case "Model name":
			out.Model = data
		case "CPU(s)":
			if n, err := strconv.Atoi(strings.TrimSpace(data)); err == nil {
				out.Threads = n
			}
		case "Core(s) per socket":
			if n, err := strconv.Atoi(strings.TrimSpace(data)); err == nil {
				out.Cores = n
			}
		}
	}
	for _, e := range j.Lscpu {
		walk(e.Field, e.Data)
		for _, c := range e.Children {
			walk(c.Field, c.Data)
		}
	}
	if out.Cores == 0 {
		out.Cores = out.Threads
	}
	return out
}

func cpuFromText(raw string) CPUInfo {
	out := CPUInfo{}
	for _, line := range strings.Split(raw, "\n") {
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		switch k {
		case "Model name":
			out.Model = v
		case "CPU(s)":
			if n, err := strconv.Atoi(v); err == nil {
				out.Threads = n
			}
		case "Core(s) per socket":
			if n, err := strconv.Atoi(v); err == nil {
				out.Cores = n
			}
		}
	}
	if out.Cores == 0 {
		out.Cores = out.Threads
	}
	return out
}

func parseMemory(raw string) int64 {
	for _, line := range strings.Split(raw, "\n") {
		if !strings.HasPrefix(line, "MemTotal:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			if kb, err := strconv.ParseInt(fields[1], 10, 64); err == nil {
				return kb
			}
		}
	}
	return 0
}

type ipLinkJSON struct {
	IfName   string `json:"ifname"`
	Address  string `json:"address"`
	Master   string `json:"master,omitempty"`
	LinkInfo struct {
		InfoKind  string `json:"info_kind,omitempty"`
		InfoSlave string `json:"info_slave_kind,omitempty"`
	} `json:"linkinfo"`
}

type ipAddrJSON struct {
	IfName  string `json:"ifname"`
	AddrInf []struct {
		Family    string `json:"family"`
		Local     string `json:"local"`
		PrefixLen int    `json:"prefixlen"`
	} `json:"addr_info"`
}

func parseInterfaces(linkRaw, addrRaw string) []Interface {
	type entry struct {
		Interface
		ParentBond string
	}
	byName := make(map[string]*entry)
	order := []string{}

	var links []ipLinkJSON
	if err := json.Unmarshal([]byte(strings.TrimSpace(linkRaw)), &links); err == nil {
		for _, l := range links {
			e := &entry{Interface: Interface{
				Name: l.IfName,
				MAC:  l.Address,
				Kind: l.LinkInfo.InfoKind,
			}}
			if e.Kind == "" {
				e.Kind = "ether"
			}
			if l.Master != "" {
				e.Master = l.Master
			}
			byName[l.IfName] = e
			order = append(order, l.IfName)
		}
	}

	// Backfill bond slaves from link info.
	for _, l := range links {
		if l.Master == "" {
			continue
		}
		if parent, ok := byName[l.Master]; ok {
			parent.Slaves = append(parent.Slaves, l.IfName)
		}
	}

	// Attach addresses.
	var addrs []ipAddrJSON
	if err := json.Unmarshal([]byte(strings.TrimSpace(addrRaw)), &addrs); err == nil {
		for _, a := range addrs {
			e, ok := byName[a.IfName]
			if !ok {
				continue
			}
			for _, ai := range a.AddrInf {
				if ai.Family != "inet" {
					continue
				}
				e.Addresses = append(e.Addresses, fmt.Sprintf("%s/%d", ai.Local, ai.PrefixLen))
			}
		}
	}

	out := make([]Interface, 0, len(order))
	for _, name := range order {
		out = append(out, byName[name].Interface)
	}
	return out
}

func parseRoute(raw string) *Route {
	for _, line := range strings.Split(strings.TrimSpace(raw), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 || fields[0] != "default" {
			continue
		}
		r := &Route{}
		for i := 1; i < len(fields)-1; i++ {
			switch fields[i] {
			case "via":
				r.Gateway = fields[i+1]
			case "dev":
				r.Interface = fields[i+1]
			case "src":
				r.Source = fields[i+1]
			}
		}
		if r.Interface != "" {
			return r
		}
	}
	return nil
}

type lsblkJSON struct {
	BlockDevices []lsblkDevice `json:"blockdevices"`
}

type lsblkDevice struct {
	Name  string `json:"name"`
	Size  any    `json:"size"`
	Rota  any    `json:"rota"`
	Model string `json:"model"`
	Type  string `json:"type"`
}

func parseDisks(raw string) []Disk {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var j lsblkJSON
	if err := json.Unmarshal([]byte(raw), &j); err != nil {
		return nil
	}
	out := make([]Disk, 0, len(j.BlockDevices))
	for _, d := range j.BlockDevices {
		if d.Type != "" && d.Type != "disk" {
			continue
		}
		size := parseLsblkSize(d.Size)
		rota := parseLsblkBool(d.Rota)
		out = append(out, Disk{Name: d.Name, SizeBytes: size, Rotational: rota, Model: strings.TrimSpace(d.Model), Type: d.Type})
	}
	return out
}

// lsblk -J prints SIZE as either string ("1.8T") or number (bytes), and ROTA
// as int. Be permissive.
func parseLsblkSize(v any) int64 {
	switch x := v.(type) {
	case float64:
		return int64(x)
	case string:
		// Parse "1.8T" / "100G" / "512M" style.
		s := strings.TrimSpace(x)
		if s == "" {
			return 0
		}
		multiplier := int64(1)
		switch s[len(s)-1] {
		case 'K', 'k':
			multiplier = 1 << 10
			s = s[:len(s)-1]
		case 'M', 'm':
			multiplier = 1 << 20
			s = s[:len(s)-1]
		case 'G', 'g':
			multiplier = 1 << 30
			s = s[:len(s)-1]
		case 'T', 't':
			multiplier = 1 << 40
			s = s[:len(s)-1]
		case 'P', 'p':
			multiplier = 1 << 50
			s = s[:len(s)-1]
		}
		f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
		if err != nil {
			return 0
		}
		return int64(f * float64(multiplier))
	}
	return 0
}

func parseLsblkBool(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case float64:
		return x != 0
	case string:
		return x == "1" || strings.EqualFold(x, "true")
	}
	return false
}

func stripCIDR(addr string) string {
	if i := strings.IndexByte(addr, '/'); i > 0 {
		return addr[:i]
	}
	return addr
}

