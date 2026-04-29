package worker

import (
	"context"
	"log/slog"

	"github.com/incuscloud/incus-admin/internal/model"
)

// FirewallReconciler is the consumer-side interface needed for one-shot
// startup reconciliation of DB firewall_groups → Incus network ACLs. The
// actual implementations live in repository (DB) + service (Incus).
type FirewallReconciler interface {
	ListGroups(ctx context.Context) ([]model.FirewallGroup, error)
	ListRules(ctx context.Context, groupID int64) ([]model.FirewallRule, error)
	EnsureACL(ctx context.Context, group *model.FirewallGroup, rules []model.FirewallRule) error
}

// ReconcileFirewallOnce walks every DB firewall_groups row and pushes its
// rules to Incus via EnsureACL. Idempotent — Incus's ACL PUT semantics
// upsert. Soft-fail per group so a single Incus error doesn't block the
// whole reconcile.
//
// Called once at startup to fix the seed gap: migration 011 INSERTs DB
// rows but never calls service.EnsureACL, so VMs binding to seed groups
// (default-web / ssh-only / database-lan) hit "ACL doesn't exist" silently.
func ReconcileFirewallOnce(ctx context.Context, r FirewallReconciler) {
	groups, err := r.ListGroups(ctx)
	if err != nil {
		slog.Error("firewall reconcile: list groups failed", "error", err)
		return
	}
	ok, fail := 0, 0
	for i := range groups {
		g := groups[i]
		rules, err := r.ListRules(ctx, g.ID)
		if err != nil {
			slog.Warn("firewall reconcile: list rules failed", "slug", g.Slug, "error", err)
			fail++
			continue
		}
		if err := r.EnsureACL(ctx, &g, rules); err != nil {
			slog.Warn("firewall reconcile: ensure ACL failed", "slug", g.Slug, "error", err)
			fail++
			continue
		}
		ok++
	}
	slog.Info("firewall reconcile complete", "ok", ok, "fail", fail, "total", len(groups))
}
