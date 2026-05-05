package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"strings"

	"github.com/incuscloud/incus-admin/internal/cluster"
	"github.com/incuscloud/incus-admin/internal/model"
)

// FirewallService talks to Incus network-ACL endpoints and patches instance
// NIC security.acls for binding. It is deliberately stateless — DB writes
// happen in the handler against the repository; this service only mirrors
// state to Incus.
type FirewallService struct {
	clusters *cluster.Manager
	vmSvc    *VMService
}

func NewFirewallService(clusters *cluster.Manager, vmSvc *VMService) *FirewallService {
	return &FirewallService{clusters: clusters, vmSvc: vmSvc}
}

// ACLProject is where all firewall ACLs land. In our topology the customers
// project inherits networks (and ACLs) from default, so there's no point
// juggling per-project ACLs — they'd collapse to default anyway.
const ACLProject = "default"

// ACLName returns the Incus ACL name for a firewall_group. PLAN-035:
//   - admin 共享组（OwnerID == nil）保留旧名 "fwg-<slug>"，向后兼容生产已有
//     的 default-web/ssh-only/database-lan 等 ACL 与已绑 VM 的 NIC security.acls；
//   - 用户私有组（OwnerID != nil）使用 "fwg-u<owner>-<slug>" 在 Incus 单 project
//     的 ACL 命名空间里隔离，允许不同用户复用同 slug。
func ACLName(group *model.FirewallGroup) string {
	if group == nil {
		return ""
	}
	if group.OwnerID == nil {
		return "fwg-" + group.Slug
	}
	return fmt.Sprintf("fwg-u%d-%s", *group.OwnerID, group.Slug)
}

type aclRule struct {
	Action          string `json:"action"`
	State           string `json:"state"`
	Protocol        string `json:"protocol,omitempty"`
	Source          string `json:"source,omitempty"`
	DestinationPort string `json:"destination_port,omitempty"`
	Description     string `json:"description,omitempty"`
}

type aclBody struct {
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Ingress     []aclRule `json:"ingress"`
	Egress      []aclRule `json:"egress"`
	Config      struct{}  `json:"config"`
}

// rulesToIncus converts our flat DB rows into Incus ACL rules. Direction is
// applied at the splitRulesByDirection layer; this helper just maps fields.
func rulesToIncus(rules []model.FirewallRule) []aclRule {
	out := make([]aclRule, 0, len(rules))
	for _, r := range rules {
		ar := aclRule{
			Action:          r.Action,
			State:           "enabled",
			Protocol:        r.Protocol,
			Source:          r.SourceCIDR,
			DestinationPort: r.DestinationPort,
			Description:     r.Description,
		}
		out = append(out, ar)
	}
	return out
}

// splitRulesByDirection partitions a flat rule list into Incus ACL's ingress
// and egress slots. Empty / unset direction defaults to ingress (matches the
// Phase E original behaviour and the DB CHECK constraint default).
func splitRulesByDirection(rules []model.FirewallRule) (ingress, egress []model.FirewallRule) {
	for _, r := range rules {
		if r.Direction == "egress" {
			egress = append(egress, r)
		} else {
			ingress = append(ingress, r)
		}
	}
	return
}

// EnsureACL creates-or-updates the Incus network ACL for the given group.
// Idempotent: safe to call repeatedly, e.g. after a group or rule edit.
func (s *FirewallService) EnsureACL(ctx context.Context, group *model.FirewallGroup, rules []model.FirewallRule) error {
	clients := s.clusters.List()
	if len(clients) == 0 {
		return nil // nothing to do on configs without an Incus cluster
	}
	ingress, egress := splitRulesByDirection(rules)
	body := aclBody{
		Name:        ACLName(group),
		Description: group.Description,
		Ingress:     rulesToIncus(ingress),
		Egress:      rulesToIncus(egress),
	}
	bodyJSON, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal acl: %w", err)
	}

	for _, c := range clients {
		// Try update first; if the ACL doesn't exist, create it. Avoids a
		// pre-flight GET and tolerates the case where our DB and Incus
		// briefly drift (e.g. operator deleted the ACL by hand).
		putPath := fmt.Sprintf("/1.0/network-acls/%s?project=%s", url.PathEscape(body.Name), ACLProject)
		if _, err := c.APIPut(ctx, putPath, bytes.NewReader(bodyJSON)); err != nil {
			if !strings.Contains(err.Error(), "not found") {
				return fmt.Errorf("put acl on %s: %w", c.Name, err)
			}
			// Create path: POST to the collection, body without name-in-URL.
			createPath := fmt.Sprintf("/1.0/network-acls?project=%s", ACLProject)
			if _, err := c.APIPost(ctx, createPath, bytes.NewReader(bodyJSON)); err != nil {
				return fmt.Errorf("create acl on %s: %w", c.Name, err)
			}
		}
	}
	return nil
}

// DeleteACL removes the Incus ACL for a group. 404-equivalent errors are
// swallowed so repeated deletes (admin retry) don't error out.
func (s *FirewallService) DeleteACL(ctx context.Context, group *model.FirewallGroup) error {
	clients := s.clusters.List()
	if len(clients) == 0 {
		return nil
	}
	name := ACLName(group)
	path := fmt.Sprintf("/1.0/network-acls/%s?project=%s", url.PathEscape(name), ACLProject)
	for _, c := range clients {
		if _, err := c.APIDelete(ctx, path); err != nil {
			if strings.Contains(err.Error(), "not found") {
				slog.Info("acl already absent on cluster", "cluster", c.Name, "slug", group.Slug)
				continue
			}
			return fmt.Errorf("delete acl on %s: %w", c.Name, err)
		}
	}
	return nil
}

// AttachACLToVM adds `ACLName(group)` to the VM's eth0 security.acls list.
// The NIC device config is read-modify-write; other devices / config keys
// are preserved verbatim.
func (s *FirewallService) AttachACLToVM(ctx context.Context, clusterName, project, vmName string, group *model.FirewallGroup) error {
	return s.updateVMACLs(ctx, clusterName, project, vmName, func(cur []string) []string {
		return addUnique(cur, ACLName(group))
	})
}

// DetachACLFromVM removes the group's ACL name from the VM's NIC list. Noop
// if the ACL wasn't attached.
func (s *FirewallService) DetachACLFromVM(ctx context.Context, clusterName, project, vmName string, group *model.FirewallGroup) error {
	return s.updateVMACLs(ctx, clusterName, project, vmName, func(cur []string) []string {
		return removeValue(cur, ACLName(group))
	})
}

func (s *FirewallService) updateVMACLs(ctx context.Context, clusterName, project, vmName string, mutate func([]string) []string) error {
	client, ok := s.clusters.Get(clusterName)
	if !ok {
		return fmt.Errorf("cluster %q not found", clusterName)
	}
	instData, err := client.GetInstance(ctx, project, vmName)
	if err != nil {
		return fmt.Errorf("get instance: %w", err)
	}
	var inst struct {
		Devices map[string]map[string]any `json:"devices"`
		Status  string                    `json:"status"`
	}
	if err := json.Unmarshal(instData, &inst); err != nil {
		return fmt.Errorf("parse instance: %w", err)
	}

	nic := pickNICDevice(inst.Devices)
	if nic == "" {
		return fmt.Errorf("no NIC device found on %s", vmName)
	}
	current := parseACLList(stringAt(inst.Devices[nic], "security.acls"))
	next := mutate(current)
	if joinSliceEqual(current, next) {
		return nil // no change; nothing to do
	}

	// Cold-modify required: Incus 6.x ignores live NIC config changes for
	// security.acls. PATCH-only-the-NIC-device is safer than PUT-whole-
	// instance because PATCH preserves volatile.* (incl. volatile.uuid that
	// Incus needs to start the VM) — the 2026-04-25 strip-too-aggressive
	// regression burned us once.
	wasRunning := inst.Status == "Running"
	if wasRunning && s.vmSvc != nil {
		if err := s.vmSvc.ChangeState(ctx, clusterName, project, vmName, "stop", true); err != nil {
			return fmt.Errorf("stop vm for cold-modify: %w", err)
		}
	}

	// Build a minimal patch: only the NIC device with the new ACL list.
	// Other device keys on the same NIC (ipv4.address, security.ipv4_filtering,
	// nictype, parent, ...) must be present too because Incus PATCH
	// /1.0/instances/{name} replaces the entire NIC sub-object — it doesn't
	// merge inside a device. We forward the existing values verbatim.
	updatedNIC := map[string]any{}
	for k, v := range inst.Devices[nic] {
		updatedNIC[k] = v
	}
	updatedNIC["security.acls"] = strings.Join(next, ",")
	patchBody := map[string]any{
		"devices": map[string]map[string]any{
			nic: updatedNIC,
		},
	}
	bodyJSON, err := json.Marshal(patchBody)
	if err != nil {
		return fmt.Errorf("marshal patch: %w", err)
	}
	path := fmt.Sprintf("/1.0/instances/%s?project=%s", vmName, project)
	if _, err := client.APIPatch(ctx, path, bytes.NewReader(bodyJSON)); err != nil {
		if wasRunning && s.vmSvc != nil {
			_ = s.vmSvc.ChangeState(ctx, clusterName, project, vmName, "start", false)
		}
		return fmt.Errorf("patch instance: %w", err)
	}

	if wasRunning && s.vmSvc != nil {
		if err := s.vmSvc.ChangeState(ctx, clusterName, project, vmName, "start", false); err != nil {
			return fmt.Errorf("start vm after cold-modify: %w", err)
		}
	}
	return nil
}

// joinSliceEqual is a tiny order-sensitive equality check; if mutate kept
// the same list (e.g. addUnique on already-present entry) we skip the
// stop→put→start round-trip entirely.
func joinSliceEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// parseACLList splits a comma-separated NIC security.acls value, dropping
// empty entries and trimming whitespace. Robust against `""` and `"a,,b"`.
func parseACLList(s string) []string {
	if s == "" {
		return []string{}
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func addUnique(list []string, v string) []string {
	for _, x := range list {
		if x == v {
			return list
		}
	}
	return append(list, v)
}

func removeValue(list []string, v string) []string {
	out := make([]string, 0, len(list))
	for _, x := range list {
		if x != v {
			out = append(out, x)
		}
	}
	return out
}

// pickNICDevice returns the name of the first device with type=="nic".
// Most of our VMs have exactly one NIC ("eth0"), so first-match is safe.
func pickNICDevice(devices map[string]map[string]any) string {
	// Prefer "eth0" if present to stay consistent with Create's convention.
	if d, ok := devices["eth0"]; ok {
		if t, _ := d["type"].(string); t == "nic" {
			return "eth0"
		}
	}
	for name, d := range devices {
		if t, _ := d["type"].(string); t == "nic" {
			return name
		}
	}
	return ""
}

func stringAt(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	v, _ := m[key].(string)
	return v
}
