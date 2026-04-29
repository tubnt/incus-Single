package service

import (
	"strings"
	"testing"
)

// TestFloatingIPRunbookHint covers the admin-facing shell hint returned by
// Attach / Detach. The hint is part of the handler response shown in the UI
// and copied into runbooks; drift here would silently produce non-working
// commands so we lock the exact shape.
func TestFloatingIPRunbookHint(t *testing.T) {
	tests := []struct {
		name       string
		ip         string
		attach     bool
		wantFrags  []string
		notWant    []string
	}{
		{
			name:   "attach produces ip addr add + arping -U",
			ip:     "202.151.179.55",
			attach: true,
			wantFrags: []string{
				"sudo ip addr add 202.151.179.55/26 dev eth0",
				"sudo arping -U -I eth0 -c 3 202.151.179.55",
			},
			notWant: []string{"ip addr del"},
		},
		{
			name:   "detach produces ip addr del only (no arping needed)",
			ip:     "202.151.179.55",
			attach: false,
			wantFrags: []string{
				"sudo ip addr del 202.151.179.55/26 dev eth0",
			},
			notWant: []string{"arping", "addr add"},
		},
		{
			name:   "arbitrary IP passes through",
			ip:     "198.51.100.42",
			attach: true,
			wantFrags: []string{
				"198.51.100.42/26",
				"arping -U -I eth0 -c 3 198.51.100.42",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := floatingIPRunbookHint(tt.ip, tt.attach)
			for _, frag := range tt.wantFrags {
				if !strings.Contains(got, frag) {
					t.Errorf("missing %q in hint:\n%s", frag, got)
				}
			}
			for _, frag := range tt.notWant {
				if strings.Contains(got, frag) {
					t.Errorf("unexpected %q in hint:\n%s", frag, got)
				}
			}
		})
	}
}
