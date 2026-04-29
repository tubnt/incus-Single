package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/incuscloud/incus-admin/internal/cluster"
)

// FloatingIPService handles the Incus-side effects of attaching / detaching
// a floating IP to a VM NIC. DB state is owned by the handler against the
// FloatingIPRepo; this service only mirrors allow-list / ARP semantics to
// Incus.
type FloatingIPService struct {
	clusters *cluster.Manager
}

func NewFloatingIPService(clusters *cluster.Manager) *FloatingIPService {
	return &FloatingIPService{clusters: clusters}
}

// AttachToVM permits the floating IP on the VM's NIC. With security.ipv4_filtering
// enabled (our default), the hypervisor bridge rejects ARP/traffic from any
// IP other than the NIC's configured address. Disabling filtering is the
// simplest way to let the VM serve a secondary IP; alternative is
// ipv4.routes.external which restricts to specific ranges.
//
// Returns a runbook hint telling the admin exactly what to run inside the
// VM to plumb the IP (the hypervisor can't do that from outside).
func (s *FloatingIPService) AttachToVM(ctx context.Context, clusterName, project, vmName, floatingIP string) (runbookHint string, err error) {
	return s.updateVMFiltering(ctx, clusterName, project, vmName, false, floatingIP, true)
}

// DetachFromVM re-enables ipv4 filtering on the NIC. The VM should have
// already removed the IP from its interface; filtering being restored is
// what actually severs traffic at the hypervisor.
func (s *FloatingIPService) DetachFromVM(ctx context.Context, clusterName, project, vmName, floatingIP string) (runbookHint string, err error) {
	return s.updateVMFiltering(ctx, clusterName, project, vmName, true, floatingIP, false)
}

func (s *FloatingIPService) updateVMFiltering(ctx context.Context, clusterName, project, vmName string, enableFilter bool, floatingIP string, attach bool) (string, error) {
	client, ok := s.clusters.Get(clusterName)
	if !ok {
		return "", fmt.Errorf("cluster %q not found", clusterName)
	}
	instData, err := client.GetInstance(ctx, project, vmName)
	if err != nil {
		return "", fmt.Errorf("get instance: %w", err)
	}
	var inst struct {
		Devices map[string]map[string]any `json:"devices"`
	}
	if err := json.Unmarshal(instData, &inst); err != nil {
		return "", fmt.Errorf("parse instance: %w", err)
	}
	nic := pickNICDevice(inst.Devices)
	if nic == "" {
		return "", fmt.Errorf("no NIC device found on %s", vmName)
	}
	// PATCH-only-the-NIC: see firewall service for rationale; PUT-whole-
	// instance breaks volatile.uuid and similar Incus-managed state.
	updatedNIC := map[string]any{}
	for k, v := range inst.Devices[nic] {
		updatedNIC[k] = v
	}
	if enableFilter {
		updatedNIC["security.ipv4_filtering"] = "true"
	} else {
		updatedNIC["security.ipv4_filtering"] = "false"
	}
	patchBody := map[string]any{
		"devices": map[string]map[string]any{
			nic: updatedNIC,
		},
	}
	bodyJSON, err := json.Marshal(patchBody)
	if err != nil {
		return "", fmt.Errorf("marshal patch: %w", err)
	}
	path := fmt.Sprintf("/1.0/instances/%s?project=%s", vmName, project)
	if _, err := client.APIPatch(ctx, path, bytes.NewReader(bodyJSON)); err != nil {
		return "", fmt.Errorf("patch instance: %w", err)
	}

	return floatingIPRunbookHint(floatingIP, attach), nil
}

// floatingIPRunbookHint returns the shell snippet the operator should run
// inside the VM to plumb / unplumb the IP. We keep both attach and detach
// in one helper so copies stay in sync (same NIC name, same CIDR length).
func floatingIPRunbookHint(floatingIP string, attach bool) string {
	// /26 matches our public segment; operators with other layouts adjust.
	if attach {
		return strings.Join([]string{
			fmt.Sprintf("sudo ip addr add %s/26 dev eth0", floatingIP),
			fmt.Sprintf("sudo arping -U -I eth0 -c 3 %s", floatingIP),
		}, " && ")
	}
	return strings.Join([]string{
		fmt.Sprintf("sudo ip addr del %s/26 dev eth0", floatingIP),
	}, " && ")
}
