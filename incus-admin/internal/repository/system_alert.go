package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// PLAN-039 / OPS-044 system_alerts 表读写。
//
// PLAN-041 / INFRA-009 扩展：
//   - kind CHECK 放宽（migration 025）支持 vm_*/cluster_node_offline/...
//   - 新增 group_key/scope_kind/scope_id/rule_id 字段，给 dispatcher dedup 用
//   - 老 UpsertActive 保留向后兼容（imbalance_watchdog 仍直接调）→
//     自动派生 group_key = "<kind>:<cluster>"

type SystemAlert struct {
	ID          int64           `json:"id"`
	Kind        string          `json:"kind"`
	Cluster     string          `json:"cluster"`
	Severity    string          `json:"severity"`
	Payload     json.RawMessage `json:"payload"`
	GroupKey    *string         `json:"group_key,omitempty"`
	ScopeKind   *string         `json:"scope_kind,omitempty"`
	ScopeID     *int64          `json:"scope_id,omitempty"`
	RuleID      *int64          `json:"rule_id,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
	ResolvedAt  *time.Time      `json:"resolved_at,omitempty"`
	DismissedBy *int64          `json:"dismissed_by,omitempty"`
}

type SystemAlertRepo struct {
	db *sql.DB
}

func NewSystemAlertRepo(db *sql.DB) *SystemAlertRepo {
	return &SystemAlertRepo{db: db}
}

// UpsertActive 写入或更新一条 active alert（kind+cluster 复合 unique 约束）。
// 同一 (cluster, kind) 已有 unresolved 时仅更新 payload + updated_at。
//
// PLAN-041 兼容层：自动派生 group_key = "<kind>:<cluster>"，scope=cluster。
// imbalance_watchdog 调本方法不需改动。
func (r *SystemAlertRepo) UpsertActive(ctx context.Context, kind, cluster, severity string, payload []byte) error {
	if payload == nil {
		payload = []byte(`{}`)
	}
	groupKey := kind + ":" + cluster
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO system_alerts (kind, cluster, severity, payload, group_key, scope_kind, scope_id)
		VALUES ($1, $2, $3, $4::jsonb, $5, 'cluster', NULL)
		ON CONFLICT (cluster, kind) WHERE resolved_at IS NULL
		DO UPDATE SET payload = EXCLUDED.payload,
		              severity = EXCLUDED.severity,
		              group_key = EXCLUDED.group_key,
		              updated_at = now()
	`, kind, cluster, severity, payload, groupKey)
	if err != nil {
		return fmt.Errorf("upsert system_alert: %w", err)
	}
	return nil
}

// UpsertWithGroup 评估器用：完整指定 group_key + scope + rule_id。
// cluster 字段可空字符串（global / user 维度的告警）。
//
// P0 CR 修复（#1）：以 group_key 为聚合键。原 ON CONFLICT (cluster, kind)
// 在同一 cluster 内多个 scope-VM 维度 alert 互相 UPDATE 覆盖。新走
// system_alerts_group_active_uniq UNIQUE INDEX (group_key) WHERE resolved_at IS NULL。
func (r *SystemAlertRepo) UpsertWithGroup(
	ctx context.Context,
	kind, cluster, severity, groupKey, scopeKind string,
	scopeID *int64, ruleID *int64, payload []byte,
) (int64, error) {
	if payload == nil {
		payload = []byte(`{}`)
	}
	var id int64
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO system_alerts (
			kind, cluster, severity, payload, group_key, scope_kind, scope_id, rule_id
		) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
		ON CONFLICT (group_key) WHERE resolved_at IS NULL AND group_key IS NOT NULL
		DO UPDATE SET payload = EXCLUDED.payload,
		              severity = EXCLUDED.severity,
		              kind = EXCLUDED.kind,
		              cluster = EXCLUDED.cluster,
		              scope_kind = EXCLUDED.scope_kind,
		              scope_id = EXCLUDED.scope_id,
		              rule_id = EXCLUDED.rule_id,
		              updated_at = now()
		RETURNING id
	`, kind, cluster, severity, payload, groupKey, scopeKind, scopeID, ruleID).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("upsert system_alert with group: %w", err)
	}
	return id, nil
}

// ResolveByGroup 给 evaluator 用：按 group_key 解析（替代 (kind, cluster) 维度），
// 适配 vm_down 等多 scope 场景。返回被 resolve 的行供 dispatcher 推 resolved 通知。
func (r *SystemAlertRepo) ResolveByGroup(ctx context.Context, groupKey string) (*SystemAlert, error) {
	var a SystemAlert
	var payloadText string
	err := r.db.QueryRowContext(ctx, `
		UPDATE system_alerts SET resolved_at = now(), updated_at = now()
		WHERE group_key = $1 AND resolved_at IS NULL
		RETURNING id, kind, cluster, severity, payload::text,
		          group_key, scope_kind, scope_id, rule_id,
		          created_at, updated_at, resolved_at, dismissed_by
	`, groupKey).Scan(&a.ID, &a.Kind, &a.Cluster, &a.Severity, &payloadText,
		&a.GroupKey, &a.ScopeKind, &a.ScopeID, &a.RuleID,
		&a.CreatedAt, &a.UpdatedAt, &a.ResolvedAt, &a.DismissedBy)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("resolve by group: %w", err)
	}
	a.Payload = json.RawMessage(payloadText)
	return &a, nil
}

// ResolveActive 把 (kind, cluster) 的 active alert 标 resolved。watchdog 检测
// 不再不均衡时调用；找不到 active 不视为错误。签名保留向后兼容（imbalance_watchdog 直接用）。
func (r *SystemAlertRepo) ResolveActive(ctx context.Context, kind, cluster string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE system_alerts SET resolved_at = now(), updated_at = now()
		WHERE kind = $1 AND cluster = $2 AND resolved_at IS NULL
	`, kind, cluster)
	if err != nil {
		return fmt.Errorf("resolve system_alert: %w", err)
	}
	return nil
}

// ResolveAndReturn 与 ResolveActive 同语义，但返回被 resolve 的行（含 group_key /
// payload，给 dispatcher 决定是否要发"已恢复"通知用）。无 active 行返回 (nil, nil)。
func (r *SystemAlertRepo) ResolveAndReturn(ctx context.Context, kind, cluster string) (*SystemAlert, error) {
	var a SystemAlert
	var payloadText string
	err := r.db.QueryRowContext(ctx, `
		UPDATE system_alerts SET resolved_at = now(), updated_at = now()
		WHERE kind = $1 AND cluster = $2 AND resolved_at IS NULL
		RETURNING id, kind, cluster, severity, payload::text,
		          group_key, scope_kind, scope_id, rule_id,
		          created_at, updated_at, resolved_at, dismissed_by
	`, kind, cluster).Scan(&a.ID, &a.Kind, &a.Cluster, &a.Severity, &payloadText,
		&a.GroupKey, &a.ScopeKind, &a.ScopeID, &a.RuleID,
		&a.CreatedAt, &a.UpdatedAt, &a.ResolvedAt, &a.DismissedBy)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("resolve and return system_alert: %w", err)
	}
	a.Payload = json.RawMessage(payloadText)
	return &a, nil
}

// Dismiss 手工 dismiss（admin 主动忽略告警）。
func (r *SystemAlertRepo) Dismiss(ctx context.Context, id, userID int64) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE system_alerts SET resolved_at = now(), updated_at = now(), dismissed_by = $2
		WHERE id = $1 AND resolved_at IS NULL
	`, id, userID)
	if err != nil {
		return fmt.Errorf("dismiss system_alert: %w", err)
	}
	return nil
}

// ListActive 返当前所有未 resolved alerts。
func (r *SystemAlertRepo) ListActive(ctx context.Context) ([]SystemAlert, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, kind, cluster, severity, payload::text,
		       group_key, scope_kind, scope_id, rule_id,
		       created_at, updated_at, resolved_at, dismissed_by
		FROM system_alerts
		WHERE resolved_at IS NULL
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list active alerts: %w", err)
	}
	defer rows.Close()
	var out []SystemAlert
	for rows.Next() {
		var a SystemAlert
		var payloadText string
		if err := rows.Scan(&a.ID, &a.Kind, &a.Cluster, &a.Severity, &payloadText,
			&a.GroupKey, &a.ScopeKind, &a.ScopeID, &a.RuleID,
			&a.CreatedAt, &a.UpdatedAt, &a.ResolvedAt, &a.DismissedBy); err != nil {
			return nil, err
		}
		a.Payload = json.RawMessage(payloadText)
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetByGroupKey evaluator 在评估循环内查"该 (kind, scope) 是否已有 active 行"。
// resolved 行不返回。返回 nil 表示当前无 active。
func (r *SystemAlertRepo) GetByGroupKey(ctx context.Context, groupKey string) (*SystemAlert, error) {
	var a SystemAlert
	var payloadText string
	err := r.db.QueryRowContext(ctx, `
		SELECT id, kind, cluster, severity, payload::text,
		       group_key, scope_kind, scope_id, rule_id,
		       created_at, updated_at, resolved_at, dismissed_by
		FROM system_alerts WHERE group_key = $1 AND resolved_at IS NULL
		ORDER BY created_at DESC LIMIT 1
	`, groupKey).Scan(&a.ID, &a.Kind, &a.Cluster, &a.Severity, &payloadText,
		&a.GroupKey, &a.ScopeKind, &a.ScopeID, &a.RuleID,
		&a.CreatedAt, &a.UpdatedAt, &a.ResolvedAt, &a.DismissedBy)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get system_alert by group_key: %w", err)
	}
	a.Payload = json.RawMessage(payloadText)
	return &a, nil
}
