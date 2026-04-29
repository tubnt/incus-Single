package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIsValidLinuxUsername(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"ubuntu", true},
		{"user_01", true},
		{"_system", true},
		{"a", true},
		{"", false},
		{"0user", false},
		{"-user", false},
		{"USER", false},
		{"user name", false},
		{"user;rm", false},
		{"user'x", false},
		{"user`x", false},
		{"user$x", false},
		{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", false}, // 33 chars
	}
	for _, c := range cases {
		if got := isValidLinuxUsername(c.in); got != c.want {
			t.Errorf("isValidLinuxUsername(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestShellSingleQuote(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"ubuntu", "'ubuntu'"},
		{"a b c", "'a b c'"},
		{"it's", `'it'\''s'`},
		{"''", `''\'''\'''`},
		{"", "''"},
		{`$(whoami)`, `'$(whoami)'`},
	}
	for _, c := range cases {
		if got := shellSingleQuote(c.in); got != c.want {
			t.Errorf("shellSingleQuote(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestOfflineChpasswdCloudConfig pins the YAML shape the offline reset path
// injects into cloud-init.vendor-data. chpasswd.users[] + ssh_pwauth is what
// cloud-init's set_passwords module consumes; the shape rarely changes, so
// diffs on this test signal intent shifts (e.g. switching to a hashed form).
func TestOfflineChpasswdCloudConfig(t *testing.T) {
	got := offlineChpasswdCloudConfig("ubuntu", "deadbeef")

	wantFragments := []string{
		"#cloud-config",
		"chpasswd:",
		"expire: false",
		`name: "ubuntu"`,
		`password: "deadbeef"`,
		"type: text",
		"ssh_pwauth: true",
	}
	for _, frag := range wantFragments {
		if !strings.Contains(got, frag) {
			t.Errorf("cloud-config missing %q:\n---\n%s---", frag, got)
		}
	}
	// Guard against accidentally leaving a runcmd echo that would log the
	// password to /var/log/cloud-init.log via shell command tracing.
	if strings.Contains(got, "runcmd") || strings.Contains(got, "chpasswd |") {
		t.Errorf("cloud-config should not contain runcmd/chpasswd pipe:\n%s", got)
	}
}

// TestNewInstanceID confirms the ID is unique-ish (two calls differ) and uses
// the documented "iid-" prefix. A collision here would silently skip
// cloud-init re-run and the offline reset would appear to "succeed" without
// actually rotating the password.
func TestNewInstanceID(t *testing.T) {
	a := newInstanceID()
	b := newInstanceID()
	if a == b {
		t.Fatalf("newInstanceID produced identical IDs: %q", a)
	}
	for _, id := range []string{a, b} {
		if !strings.HasPrefix(id, "iid-") {
			t.Errorf("id %q missing iid- prefix", id)
		}
		if len(id) != len("iid-")+16 {
			t.Errorf("id %q wrong length (want iid- + 16 hex chars)", id)
		}
	}
}

// TestStripVolatileConfig protects against the Incus PUT-instance bug we
// hit on 2026-04-25: vm-8f8912 offline reset returned 500 because the GET
// body included `volatile.eth0.host_name` and PUT-ing it back is forbidden.
// Any future caller of GET-instance → modify → PUT-instance MUST strip
// volatile.* before marshal; this test pins the helper's contract.
func TestStripVolatileConfig(t *testing.T) {
	cfg := map[string]string{
		"limits.cpu":              "1",
		"user.cloud-init":         "#cloud-config\n",
		"cloud-init.instance-id":  "iid-abc",
		"volatile.eth0.host_name": "vethXXXX",
		"volatile.uuid":           "00000000-0000-0000-0000-000000000000",
		"volatile.last_state.power":     "RUNNING",
		"volatile.cloud-init.instance-id": "iid-prev",
	}
	stripVolatileConfig(cfg)
	for k := range cfg {
		if strings.HasPrefix(k, "volatile.") {
			t.Errorf("volatile key %q survived strip", k)
		}
	}
	for _, must := range []string{"limits.cpu", "user.cloud-init", "cloud-init.instance-id"} {
		if _, ok := cfg[must]; !ok {
			t.Errorf("non-volatile key %q was wrongly removed", must)
		}
	}
}

// TestResetPasswordModeConstants pins the wire-level mode strings used by
// handlers. Changing any of these is a breaking API change for the portal /
// admin reset endpoints; the test makes that explicit.
func TestProbeImageServer(t *testing.T) {
	// Empty serverURL is allowed (caller passes default upstream).
	if err := probeImageServer(context.Background(), ""); err != nil {
		t.Fatalf("empty url should not error, got %v", err)
	}

	// Server returns 200 → reachable.
	srvOK := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodHead {
			t.Errorf("expected HEAD, got %s", r.Method)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srvOK.Close()
	if err := probeImageServer(context.Background(), srvOK.URL); err != nil {
		t.Fatalf("expected reachable, got %v", err)
	}

	// Server returns 405 (HEAD not allowed by some CDNs) → still treated as reachable.
	srv405 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusMethodNotAllowed)
	}))
	defer srv405.Close()
	if err := probeImageServer(context.Background(), srv405.URL); err != nil {
		t.Fatalf("405 should be treated as reachable, got %v", err)
	}

	// Server returns 503 → not reachable, must error.
	srv503 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv503.Close()
	if err := probeImageServer(context.Background(), srv503.URL); err == nil {
		t.Fatal("expected error for 503, got nil")
	}

	// Unreachable URL must error.
	if err := probeImageServer(context.Background(), "http://127.0.0.1:1"); err == nil {
		t.Fatal("expected error for unreachable URL, got nil")
	}
}

func TestResetPasswordModeConstants(t *testing.T) {
	cases := []struct {
		mode ResetPasswordMode
		want string
	}{
		{ResetPasswordAuto, "auto"},
		{ResetPasswordOnline, "online"},
		{ResetPasswordOffline, "offline"},
	}
	for _, c := range cases {
		if string(c.mode) != c.want {
			t.Errorf("mode constant mismatch: got %q, want %q", c.mode, c.want)
		}
	}
}
