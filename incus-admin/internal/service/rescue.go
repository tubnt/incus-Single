package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/incuscloud/incus-admin/internal/cluster"
)

// RescueService handles the Incus-side effects of entering / exiting the
// safe-mode-with-snapshot rescue state. DB writes (rescue_state column) are
// owned by the handler against VMRepo; this service only performs snapshot
// and state change calls against Incus.
type RescueService struct {
	vmSvc    *VMService
	clusters *cluster.Manager
}

func NewRescueService(vmSvc *VMService, clusters *cluster.Manager) *RescueService {
	return &RescueService{vmSvc: vmSvc, clusters: clusters}
}

// RescueSnapshotName returns a stable, prefixed snapshot name keyed on the
// timestamp. Prefix "rescue-" keeps our snapshots distinguishable from
// user-created ones in the snapshots list, and the timestamp lets us tell
// multiple rescue cycles apart.
func RescueSnapshotName(now time.Time) string {
	return "rescue-" + now.UTC().Format("20060102-150405")
}

// EnterRescue takes a rescue snapshot and stops the VM. Called after the
// handler has verified the VM is in rescue_state='normal'. Returns the
// snapshot name so the handler can persist it in rescue_snapshot_name.
func (s *RescueService) EnterRescue(ctx context.Context, clusterName, project, vmName string) (snapshotName string, err error) {
	client, ok := s.clusters.Get(clusterName)
	if !ok {
		return "", fmt.Errorf("cluster %q not found", clusterName)
	}

	snapshotName = RescueSnapshotName(time.Now())
	body, _ := json.Marshal(map[string]any{"name": snapshotName})
	path := fmt.Sprintf("/1.0/instances/%s/snapshots?project=%s", vmName, project)
	resp, err := client.APIPost(ctx, path, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create rescue snapshot: %w", err)
	}
	if resp.Type == "async" {
		var op struct{ ID string }
		_ = json.Unmarshal(resp.Metadata, &op)
		if op.ID != "" {
			if err := client.WaitForOperation(ctx, op.ID); err != nil {
				// Proceed best-effort — snapshot may be in-flight and stop
				// still makes sense. Log so the admin can reconcile.
				slog.Warn("wait for rescue snapshot failed", "vm", vmName, "error", err)
			}
		}
	}

	// Force-stop so a hung VM still enters rescue cleanly. Rescue exists
	// precisely for misbehaving VMs.
	if err := s.vmSvc.ChangeState(ctx, clusterName, project, vmName, "stop", true); err != nil {
		return snapshotName, fmt.Errorf("stop vm: %w", err)
	}
	return snapshotName, nil
}

// ExitRescue takes the VM out of rescue. If restore==true, the recorded
// snapshot is applied first (rolling back any in-VM changes the admin made
// during investigation). Either way the VM is started after.
func (s *RescueService) ExitRescue(ctx context.Context, clusterName, project, vmName, snapshotName string, restore bool) error {
	client, ok := s.clusters.Get(clusterName)
	if !ok {
		return fmt.Errorf("cluster %q not found", clusterName)
	}

	if restore && snapshotName != "" {
		// Incus PUT /1.0/instances/{name} with restore={snap} applies the
		// snapshot. VM must be stopped (which is our rescue invariant).
		body, _ := json.Marshal(map[string]any{"restore": snapshotName})
		path := fmt.Sprintf("/1.0/instances/%s?project=%s", vmName, project)
		resp, err := client.APIPut(ctx, path, bytes.NewReader(body))
		if err != nil {
			return fmt.Errorf("restore snapshot %s: %w", snapshotName, err)
		}
		if resp.Type == "async" {
			var op struct{ ID string }
			_ = json.Unmarshal(resp.Metadata, &op)
			if op.ID != "" {
				if err := client.WaitForOperation(ctx, op.ID); err != nil {
					slog.Warn("wait for snapshot restore failed", "vm", vmName, "error", err)
				}
			}
		}
	}

	if err := s.vmSvc.ChangeState(ctx, clusterName, project, vmName, "start", false); err != nil {
		return fmt.Errorf("start vm: %w", err)
	}
	return nil
}

// DeleteRescueSnapshot removes the automatic snapshot once the admin is
// done with rescue. Best-effort: log but don't fail if Incus can't find it.
func (s *RescueService) DeleteRescueSnapshot(ctx context.Context, clusterName, project, vmName, snapshotName string) error {
	if snapshotName == "" {
		return nil
	}
	client, ok := s.clusters.Get(clusterName)
	if !ok {
		return nil
	}
	path := fmt.Sprintf("/1.0/instances/%s/snapshots/%s?project=%s", vmName, snapshotName, project)
	resp, err := client.APIDelete(ctx, path)
	if err != nil {
		slog.Warn("delete rescue snapshot failed", "vm", vmName, "snap", snapshotName, "error", err)
		return err
	}
	if resp != nil && resp.Type == "async" {
		var op struct{ ID string }
		_ = json.Unmarshal(resp.Metadata, &op)
		if op.ID != "" {
			_ = client.WaitForOperation(ctx, op.ID)
		}
	}
	return nil
}
