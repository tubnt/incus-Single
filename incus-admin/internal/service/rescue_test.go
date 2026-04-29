package service

import (
	"strings"
	"testing"
	"time"
)

// TestRescueSnapshotName locks the name format. The prefix is what the
// frontend filters on to distinguish automatic rescue snapshots from
// user-created ones; the timestamp lets repeated enter/exit cycles coexist
// in the snapshot list.
func TestRescueSnapshotName(t *testing.T) {
	// Fixed UTC timestamp so we don't depend on local tz.
	now := time.Date(2026, 4, 24, 17, 30, 45, 0, time.UTC)
	got := RescueSnapshotName(now)
	want := "rescue-20260424-173045"
	if got != want {
		t.Errorf("want %q, got %q", want, got)
	}

	// Two calls within the same second produce the same name — acceptable
	// for the rescue snapshot path (the handler already guards against
	// re-entering rescue while in rescue state). Document the invariant so
	// future refactors don't accidentally add millisecond precision.
	a := RescueSnapshotName(now)
	b := RescueSnapshotName(now)
	if a != b {
		t.Errorf("same timestamp should produce same name: %q vs %q", a, b)
	}

	// Calls one second apart differ.
	later := now.Add(1 * time.Second)
	if RescueSnapshotName(later) == a {
		t.Error("different timestamp should produce different name")
	}
}

// TestRescueSnapshotNamePrefix guards the prefix separately so a rename
// (e.g. swap to 'safemode-') goes through an explicit test update.
func TestRescueSnapshotNamePrefix(t *testing.T) {
	got := RescueSnapshotName(time.Now())
	if !strings.HasPrefix(got, "rescue-") {
		t.Errorf("missing 'rescue-' prefix: %q", got)
	}
	// 'rescue-' + 'YYYYMMDD-HHMMSS' = 7 + 15 = 22 chars
	if len(got) != 22 {
		t.Errorf("unexpected length %d: %q", len(got), got)
	}
}
