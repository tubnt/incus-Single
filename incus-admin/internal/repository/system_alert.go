package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// PLAN-039 / OPS-044 system_alerts 表读写。

type SystemAlert struct {
	ID          int64           `json:"id"`
	Kind        string          `json:"kind"`
	Cluster     string          `json:"cluster"`
	Severity    string          `json:"severity"`
	Payload     json.RawMessage `json:"payload"`
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
func (r *SystemAlertRepo) UpsertActive(ctx context.Context, kind, cluster, severity string, payload []byte) error {
	if payload == nil {
		payload = []byte(`{}`)
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO system_alerts (kind, cluster, severity, payload)
		VALUES ($1, $2, $3, $4::jsonb)
		ON CONFLICT (cluster, kind) WHERE resolved_at IS NULL
		DO UPDATE SET payload = EXCLUDED.payload,
		              severity = EXCLUDED.severity,
		              updated_at = now()
	`, kind, cluster, severity, payload)
	if err != nil {
		return fmt.Errorf("upsert system_alert: %w", err)
	}
	return nil
}

// ResolveActive 把 (kind, cluster) 的 active alert 标 resolved。watchdog 检测
// 不再不均衡时调用；找不到 active 不视为错误。
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
		SELECT id, kind, cluster, severity, payload::text, created_at, updated_at, resolved_at, dismissed_by
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
			&a.CreatedAt, &a.UpdatedAt, &a.ResolvedAt, &a.DismissedBy); err != nil {
			return nil, err
		}
		a.Payload = json.RawMessage(payloadText)
		out = append(out, a)
	}
	return out, rows.Err()
}
