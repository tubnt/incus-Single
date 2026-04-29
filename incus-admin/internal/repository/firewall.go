package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/incuscloud/incus-admin/internal/model"
)

type FirewallRepo struct {
	db *sql.DB
}

func NewFirewallRepo(db *sql.DB) *FirewallRepo {
	return &FirewallRepo{db: db}
}

// --- groups ---

const firewallGroupColumns = `id, slug, name, description, created_at, updated_at`

func scanFirewallGroup(row interface{ Scan(dest ...any) error }, g *model.FirewallGroup) error {
	return row.Scan(&g.ID, &g.Slug, &g.Name, &g.Description, &g.CreatedAt, &g.UpdatedAt)
}

func (r *FirewallRepo) ListGroups(ctx context.Context) ([]model.FirewallGroup, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+firewallGroupColumns+` FROM firewall_groups ORDER BY id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]model.FirewallGroup, 0)
	for rows.Next() {
		var g model.FirewallGroup
		if err := scanFirewallGroup(rows, &g); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (r *FirewallRepo) GetGroupByID(ctx context.Context, id int64) (*model.FirewallGroup, error) {
	var g model.FirewallGroup
	err := scanFirewallGroup(
		r.db.QueryRowContext(ctx, `SELECT `+firewallGroupColumns+` FROM firewall_groups WHERE id = $1`, id),
		&g,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &g, nil
}

func (r *FirewallRepo) GetGroupBySlug(ctx context.Context, slug string) (*model.FirewallGroup, error) {
	var g model.FirewallGroup
	err := scanFirewallGroup(
		r.db.QueryRowContext(ctx, `SELECT `+firewallGroupColumns+` FROM firewall_groups WHERE slug = $1`, slug),
		&g,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &g, nil
}

func (r *FirewallRepo) CreateGroup(ctx context.Context, g *model.FirewallGroup) (*model.FirewallGroup, error) {
	var out model.FirewallGroup
	err := scanFirewallGroup(
		r.db.QueryRowContext(ctx,
			`INSERT INTO firewall_groups (slug, name, description)
			 VALUES ($1, $2, $3)
			 RETURNING `+firewallGroupColumns,
			g.Slug, g.Name, g.Description,
		),
		&out,
	)
	if err != nil {
		return nil, fmt.Errorf("create firewall_group: %w", err)
	}
	return &out, nil
}

func (r *FirewallRepo) UpdateGroup(ctx context.Context, g *model.FirewallGroup) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE firewall_groups SET slug=$1, name=$2, description=$3, updated_at=NOW() WHERE id=$4`,
		g.Slug, g.Name, g.Description, g.ID,
	)
	return err
}

func (r *FirewallRepo) DeleteGroup(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM firewall_groups WHERE id = $1`, id)
	return err
}

// --- rules ---

const firewallRuleColumns = `id, group_id, COALESCE(direction, 'ingress'), action, protocol, destination_port, source_cidr, description, sort_order, created_at`

func scanFirewallRule(row interface{ Scan(dest ...any) error }, rule *model.FirewallRule) error {
	return row.Scan(&rule.ID, &rule.GroupID, &rule.Direction, &rule.Action, &rule.Protocol, &rule.DestinationPort,
		&rule.SourceCIDR, &rule.Description, &rule.SortOrder, &rule.CreatedAt)
}

func (r *FirewallRepo) ListRules(ctx context.Context, groupID int64) ([]model.FirewallRule, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+firewallRuleColumns+` FROM firewall_rules WHERE group_id = $1 ORDER BY sort_order ASC, id ASC`,
		groupID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]model.FirewallRule, 0)
	for rows.Next() {
		var rule model.FirewallRule
		if err := scanFirewallRule(rows, &rule); err != nil {
			return nil, err
		}
		out = append(out, rule)
	}
	return out, rows.Err()
}

func (r *FirewallRepo) CreateRule(ctx context.Context, rule *model.FirewallRule) (*model.FirewallRule, error) {
	var out model.FirewallRule
	dir := rule.Direction
	if dir == "" {
		dir = "ingress"
	}
	err := scanFirewallRule(
		r.db.QueryRowContext(ctx,
			`INSERT INTO firewall_rules (group_id, direction, action, protocol, destination_port, source_cidr, description, sort_order)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			 RETURNING `+firewallRuleColumns,
			rule.GroupID, dir, rule.Action, rule.Protocol, rule.DestinationPort, rule.SourceCIDR, rule.Description, rule.SortOrder,
		),
		&out,
	)
	if err != nil {
		return nil, fmt.Errorf("create firewall_rule: %w", err)
	}
	return &out, nil
}

func (r *FirewallRepo) DeleteRule(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM firewall_rules WHERE id = $1`, id)
	return err
}

// ReplaceRules atomically swaps all rules for a group. Used by PATCH
// /firewall/groups/{id} which accepts the full rule list at once — simpler
// contract than per-rule PUT/DELETE.
func (r *FirewallRepo) ReplaceRules(ctx context.Context, groupID int64, rules []model.FirewallRule) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM firewall_rules WHERE group_id = $1`, groupID); err != nil {
		return fmt.Errorf("clear rules: %w", err)
	}
	for _, rule := range rules {
		dir := rule.Direction
		if dir == "" {
			dir = "ingress"
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO firewall_rules (group_id, direction, action, protocol, destination_port, source_cidr, description, sort_order)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			groupID, dir, rule.Action, rule.Protocol, rule.DestinationPort, rule.SourceCIDR, rule.Description, rule.SortOrder,
		); err != nil {
			return fmt.Errorf("insert rule: %w", err)
		}
	}
	return tx.Commit()
}

// --- bindings ---

func (r *FirewallRepo) ListBindingsByVM(ctx context.Context, vmID int64) ([]model.FirewallGroup, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT g.id, g.slug, g.name, g.description, g.created_at, g.updated_at
		 FROM firewall_groups g
		 JOIN vm_firewall_bindings b ON b.group_id = g.id
		 WHERE b.vm_id = $1
		 ORDER BY g.id ASC`,
		vmID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]model.FirewallGroup, 0)
	for rows.Next() {
		var g model.FirewallGroup
		if err := scanFirewallGroup(rows, &g); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (r *FirewallRepo) Bind(ctx context.Context, vmID, groupID int64) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO vm_firewall_bindings (vm_id, group_id) VALUES ($1, $2)
		 ON CONFLICT DO NOTHING`,
		vmID, groupID,
	)
	return err
}

func (r *FirewallRepo) Unbind(ctx context.Context, vmID, groupID int64) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM vm_firewall_bindings WHERE vm_id = $1 AND group_id = $2`,
		vmID, groupID,
	)
	return err
}
