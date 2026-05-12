package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// PLAN-041 / INFRA-009 alert_deliveries 表读写。
//
// dedup 三元组 (channel_id, group_key, phase)：同一三元组在 retention 窗口内
// 只发 1 条 → firing→resolved→firing 流转时按 phase 翻转触发新一条 delivery，
// 恢复通知不会被吞（社区 Alertmanager 标准模式，修正 PLAN 草稿的旧设计）。
//
// 重试：3 次后标 failed 不再重试 + 写一条 system_alerts(kind='channel_delivery_failed')
// 让管理员感知通道挂了。退避：1m / 5m / 15m。

const (
	DeliveryStatusPending  = "pending"
	DeliveryStatusSuccess  = "success"
	DeliveryStatusFailed   = "failed"
	DeliveryStatusResolved = "resolved" // resolved phase 发送成功后用

	DeliveryPhaseFiring   = "firing"
	DeliveryPhaseResolved = "resolved"

	DeliveryMaxAttempts = 3
)

type AlertDelivery struct {
	ID          int64           `json:"id"`
	AlertID     *int64          `json:"alert_id,omitempty"`
	RuleID      *int64          `json:"rule_id,omitempty"`
	ChannelID   int64           `json:"channel_id"`
	GroupKey    string          `json:"group_key"`
	Status      string          `json:"status"`
	Phase       string          `json:"phase"`
	Severity    string          `json:"severity"`
	Payload     json.RawMessage `json:"payload"`
	Attempts    int             `json:"attempts"`
	LastError   *string         `json:"last_error,omitempty"`
	NextRetryAt *time.Time      `json:"next_retry_at,omitempty"`
	SentAt      *time.Time      `json:"sent_at,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
}

type AlertDeliveryRepo struct {
	db *sql.DB
}

func NewAlertDeliveryRepo(db *sql.DB) *AlertDeliveryRepo {
	return &AlertDeliveryRepo{db: db}
}

// EnqueueIfNotDuplicated 决定是否需要给该 (channel, group_key, phase) 入队一条新 delivery。
//
// P0 CR 修复（#2）：原方案"24h 内同三元组已有 pending/success → 跳过"会吞掉
// firing→resolved→firing 序列里的第二次 firing。正确语义：去重应基于"上一次该
// (channel, group_key) 的 phase + 状态"，而不是固定 24h 窗口。
//
// 算法：
//
//	last := SELECT phase, status FROM alert_deliveries
//	       WHERE channel_id=? AND group_key=?
//	       ORDER BY created_at DESC LIMIT 1
//
//	若 last 不存在 → 入队
//	若 last.phase != 当前 phase → 入队（phase 翻转，必须发恢复 / 重新告警）
//	若 last.phase == 当前 phase 且 last.status IN (pending, success, resolved) → dedup（跳过）
//	若 last.phase == 当前 phase 且 last.status == failed → 入队（失败后重试）
//
// failed 行不挡新尝试（admin 修复 webhook 后告警自然重发）。
func (r *AlertDeliveryRepo) EnqueueIfNotDuplicated(
	ctx context.Context,
	alertID *int64, ruleID *int64, channelID int64,
	groupKey, phase, severity string, payload []byte,
) (int64, error) {
	if payload == nil {
		payload = []byte(`{}`)
	}
	var lastPhase, lastStatus sql.NullString
	err := r.db.QueryRowContext(ctx, `
		SELECT phase, status FROM alert_deliveries
		WHERE channel_id = $1 AND group_key = $2
		ORDER BY created_at DESC LIMIT 1
	`, channelID, groupKey).Scan(&lastPhase, &lastStatus)
	if err != nil && err != sql.ErrNoRows {
		return 0, fmt.Errorf("last delivery lookup: %w", err)
	}
	if lastPhase.Valid && lastPhase.String == phase &&
		lastStatus.Valid && lastStatus.String != DeliveryStatusFailed {
		// 同 phase 上次还成功 / 待发 → dedup
		return 0, nil
	}
	var id int64
	err = r.db.QueryRowContext(ctx, `
		INSERT INTO alert_deliveries (alert_id, rule_id, channel_id, group_key, phase, severity, payload, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'pending')
		RETURNING id
	`, alertID, ruleID, channelID, groupKey, phase, severity, payload).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("insert alert_delivery: %w", err)
	}
	return id, nil
}

// ListPending dispatcher 1 个 tick 拉一批待送：status=pending 且
// next_retry_at <= now()（NULL 视为可立即处理）。
func (r *AlertDeliveryRepo) ListPending(ctx context.Context, limit int) ([]AlertDelivery, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, alert_id, rule_id, channel_id, group_key, status, phase, severity,
		       payload::text, attempts, last_error, next_retry_at, sent_at, created_at
		FROM alert_deliveries
		WHERE status = 'pending'
		  AND (next_retry_at IS NULL OR next_retry_at <= now())
		ORDER BY created_at
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("list pending deliveries: %w", err)
	}
	defer rows.Close()
	var out []AlertDelivery
	for rows.Next() {
		var d AlertDelivery
		var payloadText string
		if err := rows.Scan(
			&d.ID, &d.AlertID, &d.RuleID, &d.ChannelID, &d.GroupKey, &d.Status,
			&d.Phase, &d.Severity, &payloadText, &d.Attempts, &d.LastError,
			&d.NextRetryAt, &d.SentAt, &d.CreatedAt,
		); err != nil {
			return nil, err
		}
		d.Payload = json.RawMessage(payloadText)
		out = append(out, d)
	}
	return out, rows.Err()
}

// MarkSuccess 标完成；resolved phase 用 status='resolved'，firing phase 用 'success'。
func (r *AlertDeliveryRepo) MarkSuccess(ctx context.Context, id int64, phase string) error {
	status := DeliveryStatusSuccess
	if phase == DeliveryPhaseResolved {
		status = DeliveryStatusResolved
	}
	_, err := r.db.ExecContext(ctx, `
		UPDATE alert_deliveries SET status = $2, sent_at = now()
		WHERE id = $1
	`, id, status)
	if err != nil {
		return fmt.Errorf("mark delivery success: %w", err)
	}
	return nil
}

// MarkRetry 失败但还在重试范围内：attempts++, last_error, 写下次 next_retry_at。
// 退避：1m, 5m, 15m。
func (r *AlertDeliveryRepo) MarkRetry(ctx context.Context, id int64, attempts int, errMsg string) error {
	backoff := []time.Duration{1 * time.Minute, 5 * time.Minute, 15 * time.Minute}
	idx := attempts
	if idx >= len(backoff) {
		idx = len(backoff) - 1
	}
	next := time.Now().Add(backoff[idx])
	_, err := r.db.ExecContext(ctx, `
		UPDATE alert_deliveries
		SET attempts = $2, last_error = $3, next_retry_at = $4
		WHERE id = $1
	`, id, attempts, errMsg, next)
	if err != nil {
		return fmt.Errorf("mark delivery retry: %w", err)
	}
	return nil
}

// MarkFailed 用尽重试次数后调；status=failed 让 dispatcher 不再拾起。
func (r *AlertDeliveryRepo) MarkFailed(ctx context.Context, id int64, errMsg string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE alert_deliveries
		SET status = 'failed', last_error = $2, next_retry_at = NULL
		WHERE id = $1
	`, id, errMsg)
	if err != nil {
		return fmt.Errorf("mark delivery failed: %w", err)
	}
	return nil
}

// ListByRule 给 admin UI 看"这条规则最近发到哪几个通道、是否成功"。
func (r *AlertDeliveryRepo) ListByRule(ctx context.Context, ruleID int64, limit int) ([]AlertDelivery, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, alert_id, rule_id, channel_id, group_key, status, phase, severity,
		       payload::text, attempts, last_error, next_retry_at, sent_at, created_at
		FROM alert_deliveries WHERE rule_id = $1
		ORDER BY created_at DESC LIMIT $2
	`, ruleID, limit)
	if err != nil {
		return nil, fmt.Errorf("list deliveries by rule: %w", err)
	}
	defer rows.Close()
	var out []AlertDelivery
	for rows.Next() {
		var d AlertDelivery
		var payloadText string
		if err := rows.Scan(
			&d.ID, &d.AlertID, &d.RuleID, &d.ChannelID, &d.GroupKey, &d.Status,
			&d.Phase, &d.Severity, &payloadText, &d.Attempts, &d.LastError,
			&d.NextRetryAt, &d.SentAt, &d.CreatedAt,
		); err != nil {
			return nil, err
		}
		d.Payload = json.RawMessage(payloadText)
		out = append(out, d)
	}
	return out, rows.Err()
}

// PurgeOlderThan 清理过老的 delivery 行（与 audit_cleanup 同模式）。
func (r *AlertDeliveryRepo) PurgeOlderThan(ctx context.Context, days int) (int64, error) {
	res, err := r.db.ExecContext(ctx, `
		DELETE FROM alert_deliveries WHERE created_at < now() - ($1 || ' days')::INTERVAL
	`, days)
	if err != nil {
		return 0, fmt.Errorf("purge alert_deliveries: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}
