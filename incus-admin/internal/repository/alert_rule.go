package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// PLAN-041 / INFRA-009 alert_rules 表读写。
//
// AlertRule 描述一条阈值告警规则。kind 与 system_alerts.kind 对齐，evaluator
// 按 kind 派发到具体子例程。channel_ids 是 BIGINT[]，dispatcher 读取后扇出送达。
// builtin=TRUE 是系统内置（如 imbalance），admin 不可删除（DELETE 语句加守卫）。

const (
	AlertKindImbalance           = "imbalance"
	AlertKindVMCPU               = "vm_cpu"
	AlertKindVMMem               = "vm_mem"
	AlertKindVMDisk              = "vm_disk"
	AlertKindVMDown              = "vm_down"
	AlertKindClusterNodeOffline  = "cluster_node_offline"
	AlertKindOrderFailed         = "order_failed"
	AlertKindJobFailed           = "job_failed"
	AlertKindBalanceLow          = "balance_low"
	AlertKindBackupFailed        = "backup_failed"

	AlertScopeGlobal  = "global"
	AlertScopeCluster = "cluster"
	AlertScopeVM      = "vm"
	AlertScopeUser    = "user"

	AlertSeverityInfo     = "info"
	AlertSeverityWarning  = "warning"
	AlertSeverityError    = "error"
	AlertSeverityCritical = "critical"
)

type AlertRule struct {
	ID            int64     `json:"id"`
	Name          string    `json:"name"`
	Kind          string    `json:"kind"`
	ScopeKind     string    `json:"scope_kind"`
	ScopeID       *int64    `json:"scope_id,omitempty"`
	Threshold     *float64  `json:"threshold,omitempty"`
	WindowSeconds int       `json:"window_seconds"`
	Severity      string    `json:"severity"`
	Enabled       bool      `json:"enabled"`
	ChannelIDs    []int64   `json:"channel_ids"`
	Builtin       bool      `json:"builtin"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type AlertRuleRepo struct {
	db *sql.DB
}

func NewAlertRuleRepo(db *sql.DB) *AlertRuleRepo {
	return &AlertRuleRepo{db: db}
}

func (r *AlertRuleRepo) Create(ctx context.Context, rule *AlertRule) (int64, error) {
	var id int64
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO alert_rules (
			name, kind, scope_kind, scope_id, threshold, window_seconds, severity, enabled, channel_ids, builtin
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING id
	`,
		rule.Name, rule.Kind, rule.ScopeKind, rule.ScopeID,
		rule.Threshold, rule.WindowSeconds, rule.Severity, rule.Enabled,
		pgInt64Array(rule.ChannelIDs), rule.Builtin,
	).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("insert alert_rule: %w", err)
	}
	return id, nil
}

// Update 全字段更新（admin 编辑面板）。builtin 不允许改 kind / scope。
func (r *AlertRuleRepo) Update(ctx context.Context, rule *AlertRule) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE alert_rules SET
			name = $2, threshold = $3, window_seconds = $4,
			severity = $5, enabled = $6, channel_ids = $7,
			updated_at = now()
		WHERE id = $1
	`,
		rule.ID, rule.Name, rule.Threshold, rule.WindowSeconds,
		rule.Severity, rule.Enabled, pgInt64Array(rule.ChannelIDs),
	)
	if err != nil {
		return fmt.Errorf("update alert_rule: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *AlertRuleRepo) SetEnabled(ctx context.Context, id int64, enabled bool) error {
	_, err := r.db.ExecContext(ctx, `UPDATE alert_rules SET enabled=$2, updated_at=now() WHERE id=$1`, id, enabled)
	if err != nil {
		return fmt.Errorf("toggle alert_rule: %w", err)
	}
	return nil
}

// Delete 不允许删 builtin 行。
func (r *AlertRuleRepo) Delete(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM alert_rules WHERE id=$1 AND builtin = FALSE`, id)
	if err != nil {
		return fmt.Errorf("delete alert_rule: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("alert rule not found or is builtin")
	}
	return nil
}

func (r *AlertRuleRepo) Get(ctx context.Context, id int64) (*AlertRule, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT id, name, kind, scope_kind, scope_id, threshold, window_seconds,
		       severity, enabled, channel_ids, builtin, created_at, updated_at
		FROM alert_rules WHERE id = $1
	`, id)
	return scanAlertRule(row)
}

func (r *AlertRuleRepo) List(ctx context.Context) ([]AlertRule, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, name, kind, scope_kind, scope_id, threshold, window_seconds,
		       severity, enabled, channel_ids, builtin, created_at, updated_at
		FROM alert_rules ORDER BY builtin DESC, id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list alert_rules: %w", err)
	}
	defer rows.Close()
	var out []AlertRule
	for rows.Next() {
		ar, err := scanAlertRuleRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *ar)
	}
	return out, rows.Err()
}

// ListEnabled evaluator 用：只拉 enabled=TRUE。
func (r *AlertRuleRepo) ListEnabled(ctx context.Context) ([]AlertRule, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, name, kind, scope_kind, scope_id, threshold, window_seconds,
		       severity, enabled, channel_ids, builtin, created_at, updated_at
		FROM alert_rules WHERE enabled = TRUE ORDER BY id
	`)
	if err != nil {
		return nil, fmt.Errorf("list enabled alert_rules: %w", err)
	}
	defer rows.Close()
	var out []AlertRule
	for rows.Next() {
		ar, err := scanAlertRuleRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *ar)
	}
	return out, rows.Err()
}

// FindByKindScope 评估器在 imbalance watchdog 集成里用：拉某个 (kind, scope_kind) 的内置规则。
func (r *AlertRuleRepo) FindByKindScope(ctx context.Context, kind, scopeKind string) (*AlertRule, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT id, name, kind, scope_kind, scope_id, threshold, window_seconds,
		       severity, enabled, channel_ids, builtin, created_at, updated_at
		FROM alert_rules WHERE kind = $1 AND scope_kind = $2 LIMIT 1
	`, kind, scopeKind)
	ar, err := scanAlertRule(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return ar, err
}

func scanAlertRule(row *sql.Row) (*AlertRule, error) {
	var ar AlertRule
	var channelIDs pgInt64Slice
	err := row.Scan(
		&ar.ID, &ar.Name, &ar.Kind, &ar.ScopeKind, &ar.ScopeID,
		&ar.Threshold, &ar.WindowSeconds, &ar.Severity, &ar.Enabled,
		&channelIDs, &ar.Builtin, &ar.CreatedAt, &ar.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	ar.ChannelIDs = []int64(channelIDs)
	return &ar, nil
}

func scanAlertRuleRows(rows *sql.Rows) (*AlertRule, error) {
	var ar AlertRule
	var channelIDs pgInt64Slice
	err := rows.Scan(
		&ar.ID, &ar.Name, &ar.Kind, &ar.ScopeKind, &ar.ScopeID,
		&ar.Threshold, &ar.WindowSeconds, &ar.Severity, &ar.Enabled,
		&channelIDs, &ar.Builtin, &ar.CreatedAt, &ar.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	ar.ChannelIDs = []int64(channelIDs)
	return &ar, nil
}

// ============================================================================
// PG BIGINT[] 适配
//
// pgx/v5 stdlib 默认对 array 不友好；为了不引入 pgtype 直接依赖，自定义两段：
//   pgInt64Array(ids) → 给 INSERT/UPDATE 时用，序列化成 PG 字面量字符串
//   pgInt64Slice    → 给 SELECT scan 时用，反序列化 {1,2,3}
//
// 容量极小（每条规则最多 N 个 channel），直接 string 操作够用。
// ============================================================================

type pgInt64Array []int64

// Value 实现 driver.Valuer。
func (a pgInt64Array) Value() (any, error) {
	if a == nil {
		return "{}", nil
	}
	parts := make([]string, len(a))
	for i, v := range a {
		parts[i] = strconv.FormatInt(v, 10)
	}
	return "{" + strings.Join(parts, ",") + "}", nil
}

type pgInt64Slice []int64

// Scan 实现 sql.Scanner。
func (s *pgInt64Slice) Scan(src any) error {
	if src == nil {
		*s = nil
		return nil
	}
	var raw string
	switch v := src.(type) {
	case []byte:
		raw = string(v)
	case string:
		raw = v
	default:
		return fmt.Errorf("pgInt64Slice: unexpected type %T", src)
	}
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "{")
	raw = strings.TrimSuffix(raw, "}")
	if raw == "" {
		*s = nil
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]int64, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		n, err := strconv.ParseInt(p, 10, 64)
		if err != nil {
			return fmt.Errorf("pgInt64Slice: parse %q: %w", p, err)
		}
		out = append(out, n)
	}
	*s = out
	return nil
}

// joinComma 私有 helper，避免 strings.Join 散落。
func joinComma(parts []string) string {
	return strings.Join(parts, ", ")
}
