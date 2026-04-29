package service

import (
	"reflect"
	"testing"

	"github.com/incuscloud/incus-admin/internal/model"
)

func TestACLName(t *testing.T) {
	cases := map[string]string{
		"default-web":  "fwg-default-web",
		"ssh-only":     "fwg-ssh-only",
		"database-lan": "fwg-database-lan",
		"":             "fwg-", // caller's validator must reject empty; we still pin the shape.
	}
	for slug, want := range cases {
		if got := ACLName(slug); got != want {
			t.Errorf("ACLName(%q) = %q, want %q", slug, got, want)
		}
	}
}

func TestRulesToIncus(t *testing.T) {
	rules := []model.FirewallRule{
		{Action: "allow", Protocol: "tcp", DestinationPort: "22,80,443", Description: "web + ssh"},
		{Action: "allow", Protocol: "tcp", DestinationPort: "3306", SourceCIDR: "10.0.0.0/8", Description: "mysql LAN"},
		{Action: "reject", Protocol: "", DestinationPort: "", Description: "catch-all"},
	}
	got := rulesToIncus(rules)
	if len(got) != 3 {
		t.Fatalf("want 3 rules, got %d", len(got))
	}
	for i, r := range got {
		if r.State != "enabled" {
			t.Errorf("rule %d: state = %q, want enabled", i, r.State)
		}
	}
	if got[0].DestinationPort != "22,80,443" || got[0].Action != "allow" {
		t.Errorf("rule 0 mismatch: %+v", got[0])
	}
	if got[1].Source != "10.0.0.0/8" {
		t.Errorf("rule 1 source: got %q", got[1].Source)
	}
}

func TestParseACLList(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"", []string{}},
		{"a", []string{"a"}},
		{"a,b,c", []string{"a", "b", "c"}},
		{"a, b ,c ", []string{"a", "b", "c"}},
		{"a,,b", []string{"a", "b"}},
		{",", []string{}},
	}
	for _, c := range cases {
		got := parseACLList(c.in)
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("parseACLList(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestAddUnique(t *testing.T) {
	cases := []struct {
		list []string
		v    string
		want []string
	}{
		{nil, "a", []string{"a"}},
		{[]string{"a"}, "b", []string{"a", "b"}},
		{[]string{"a", "b"}, "a", []string{"a", "b"}},
		{[]string{}, "x", []string{"x"}},
	}
	for _, c := range cases {
		got := addUnique(c.list, c.v)
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("addUnique(%v, %q) = %v, want %v", c.list, c.v, got, c.want)
		}
	}
}

func TestRemoveValue(t *testing.T) {
	cases := []struct {
		list []string
		v    string
		want []string
	}{
		{[]string{"a", "b", "c"}, "b", []string{"a", "c"}},
		{[]string{"a"}, "a", []string{}},
		{[]string{"a", "b"}, "z", []string{"a", "b"}},
		{[]string{"a", "a", "b"}, "a", []string{"b"}}, // removes all copies
		{[]string{}, "x", []string{}},
	}
	for _, c := range cases {
		got := removeValue(c.list, c.v)
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("removeValue(%v, %q) = %v, want %v", c.list, c.v, got, c.want)
		}
	}
}

func TestPickNICDevice(t *testing.T) {
	cases := []struct {
		name string
		in   map[string]map[string]any
		want string
	}{
		{"eth0 preferred when present", map[string]map[string]any{
			"root": {"type": "disk"},
			"eth0": {"type": "nic"},
			"eth1": {"type": "nic"},
		}, "eth0"},
		{"first nic when no eth0", map[string]map[string]any{
			"root":     {"type": "disk"},
			"ens1f0":   {"type": "nic"},
		}, "ens1f0"},
		{"empty devices", map[string]map[string]any{}, ""},
		{"no nic anywhere", map[string]map[string]any{
			"root":  {"type": "disk"},
			"data":  {"type": "disk"},
		}, ""},
		{"eth0 present but wrong type falls through", map[string]map[string]any{
			"eth0": {"type": "disk"},
			"ens1": {"type": "nic"},
		}, "ens1"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := pickNICDevice(c.in); got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}
