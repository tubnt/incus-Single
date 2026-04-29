package portal

import (
	"errors"
	"testing"
)

// TestIsPoolExhausted covers the error-string match that drives pool-fallback.
// The repo returns a plain fmt.Errorf containing "no available IPs in pool N";
// the allocator uses this helper to decide whether to try the next pool or
// surface the failure.
func TestIsPoolExhausted(t *testing.T) {
	tests := []struct {
		name    string
		err     error
		want    bool
	}{
		{name: "nil is not exhausted", err: nil, want: false},
		{name: "exhausted exact phrase", err: errors.New("no available IPs in pool 2"), want: true},
		{name: "wrapped exhausted is still matched", err: errors.New("allocate: no available IPs in pool 7"), want: true},
		{name: "DB error is not exhausted", err: errors.New("connection refused"), want: false},
		{name: "permission error is not exhausted", err: errors.New("permission denied"), want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isPoolExhausted(tt.err); got != tt.want {
				t.Fatalf("want %v, got %v", tt.want, got)
			}
		})
	}
}
