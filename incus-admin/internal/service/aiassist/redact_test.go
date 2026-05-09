package aiassist

import (
	"strings"
	"testing"
)

func TestRedactString_IPv4(t *testing.T) {
	in := "default via 202.151.179.62 dev enp1s0 src 202.151.179.5"
	out := RedactString(in)
	if !strings.Contains(out, "202.151.179.0/24") {
		t.Errorf("expected /24 mask; got %q", out)
	}
	if strings.Contains(out, ".5 ") || strings.Contains(out, ".62 ") {
		t.Errorf("last octet should be redacted; got %q", out)
	}
}

func TestRedactString_MAC(t *testing.T) {
	in := "link/ether 10:66:6a:ad:2c:12 brd ff:ff:ff:ff:ff:ff"
	out := RedactString(in)
	if strings.Contains(out, "10:66:6a:ad:2c:12") {
		t.Errorf("MAC should be hashed; got %q", out)
	}
	if !strings.Contains(out, "mac-") {
		t.Errorf("expected mac-XXXXXXXX placeholder; got %q", out)
	}
}

func TestRedactString_JWT(t *testing.T) {
	in := "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.X3MEZTfX_KfQzN1u22"
	out := RedactString(in)
	if strings.Contains(out, "eyJhbGc") {
		t.Errorf("JWT should be redacted; got %q", out)
	}
	if !strings.Contains(out, "<JWT>") {
		t.Errorf("expected <JWT>; got %q", out)
	}
}

func TestRedactString_Hostname(t *testing.T) {
	in := "Host node1.dc1.example.com responding to ping"
	out := RedactString(in)
	if strings.Contains(out, "dc1.example.com") {
		t.Errorf("subdomain should be redacted; got %q", out)
	}
	if !strings.Contains(out, "node1.*") {
		t.Errorf("expected first-segment only; got %q", out)
	}
}

func TestRedactString_LongTokens(t *testing.T) {
	in := "key=eyJabcdefghij.eyJklmnop.qrstuv1234567890ABC ssh-key=AAAAB3NzaC1yc2EAAAABAQABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef"
	out := RedactString(in)
	if strings.Contains(out, "ssh-key=AAAAB3NzaC1") {
		t.Errorf("long token should be redacted; got %q", out)
	}
}

func TestRedactIP(t *testing.T) {
	if got := RedactIP("10.0.10.5"); got != "10.0.10.0/24" {
		t.Errorf("RedactIP=%q want 10.0.10.0/24", got)
	}
	if got := RedactIP("not-an-ip"); got != "not-an-ip" {
		t.Errorf("non-ip pass-through; got %q", got)
	}
}

func TestRedactHostname(t *testing.T) {
	if got := RedactHostname("node1.dc1.example.com"); got != "node1.*" {
		t.Errorf("got %q", got)
	}
	if got := RedactHostname("singleword"); got != "singleword" {
		t.Errorf("non-fqdn pass-through; got %q", got)
	}
}

func TestHashMAC_StableSHA256(t *testing.T) {
	// 同 MAC 两次哈希结果一致；不同 MAC 不同。case-insensitive。
	a := HashMAC("aa:bb:cc:dd:ee:ff")
	b := HashMAC("AA:BB:CC:DD:EE:FF")
	c := HashMAC("aa:bb:cc:dd:ee:00")
	if a != b {
		t.Errorf("case-insensitive: %q != %q", a, b)
	}
	if a == c {
		t.Errorf("different MACs should hash differently")
	}
	if !strings.HasPrefix(a, "mac-") || len(a) != 12 {
		t.Errorf("expected mac-XXXXXXXX (12 chars); got %q (len=%d)", a, len(a))
	}
}
