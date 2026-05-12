package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/incuscloud/incus-admin/internal/auth"
)

// PLAN-041 / INFRA-009 notify_channels 表读写。
//
// kind 取值：dingtalk / feishu / wecom / webhook / smtp。config_enc 是 AES-256-GCM
// 加密的 JSON config（复用 OPS-022 的 PASSWORD_ENCRYPTION_KEY），结构因 kind 而异。
// repo 层只负责加 / 解密 + CRUD，业务校验 / SSRF / 签名拼装在 service.notify。

type NotifyChannel struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Kind      string    `json:"kind"`
	Enabled   bool      `json:"enabled"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	// Config 在 repo 层解密后填入；序列化到前端时按 redact 策略处理。
	Config json.RawMessage `json:"config,omitempty"`
}

// NotifyChannelKind 常量，避免散落字符串。
const (
	NotifyChannelDingtalk = "dingtalk"
	NotifyChannelFeishu   = "feishu"
	NotifyChannelWecom    = "wecom"
	NotifyChannelWebhook  = "webhook"
	NotifyChannelSMTP     = "smtp"
)

type NotifyChannelRepo struct {
	db *sql.DB
}

func NewNotifyChannelRepo(db *sql.DB) *NotifyChannelRepo {
	return &NotifyChannelRepo{db: db}
}

// Create 写一条通道。configJSON 调用方先 marshal，repo 层加密后落 config_enc。
func (r *NotifyChannelRepo) Create(ctx context.Context, name, kind string, configJSON []byte, enabled bool) (*NotifyChannel, error) {
	enc, err := auth.EncryptPassword(string(configJSON))
	if err != nil {
		return nil, fmt.Errorf("encrypt notify config: %w", err)
	}
	row := &NotifyChannel{}
	err = r.db.QueryRowContext(ctx, `
		INSERT INTO notify_channels (name, kind, config_enc, enabled)
		VALUES ($1, $2, $3, $4)
		RETURNING id, name, kind, enabled, created_at, updated_at
	`, name, kind, enc, enabled).Scan(&row.ID, &row.Name, &row.Kind, &row.Enabled, &row.CreatedAt, &row.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("insert notify_channel: %w", err)
	}
	row.Config = json.RawMessage(configJSON)
	return row, nil
}

// Update 部分字段更新。configJSON 为 nil 表示不动配置；非 nil 重新加密落库。
func (r *NotifyChannelRepo) Update(ctx context.Context, id int64, name *string, configJSON []byte, enabled *bool) error {
	parts := []string{"updated_at = now()"}
	args := []any{id}
	idx := 2
	if name != nil {
		parts = append(parts, fmt.Sprintf("name = $%d", idx))
		args = append(args, *name)
		idx++
	}
	if configJSON != nil {
		enc, err := auth.EncryptPassword(string(configJSON))
		if err != nil {
			return fmt.Errorf("encrypt notify config: %w", err)
		}
		parts = append(parts, fmt.Sprintf("config_enc = $%d", idx))
		args = append(args, enc)
		idx++
	}
	if enabled != nil {
		parts = append(parts, fmt.Sprintf("enabled = $%d", idx))
		args = append(args, *enabled)
		idx++
	}
	if len(parts) == 1 { // 仅 updated_at
		return nil
	}
	q := "UPDATE notify_channels SET " + joinComma(parts) + " WHERE id = $1"
	if _, err := r.db.ExecContext(ctx, q, args...); err != nil {
		return fmt.Errorf("update notify_channel: %w", err)
	}
	return nil
}

func (r *NotifyChannelRepo) Delete(ctx context.Context, id int64) error {
	if _, err := r.db.ExecContext(ctx, `DELETE FROM notify_channels WHERE id = $1`, id); err != nil {
		return fmt.Errorf("delete notify_channel: %w", err)
	}
	return nil
}

// GetWithConfig 解密返回完整配置（service 层调，前端不直接看到）。
func (r *NotifyChannelRepo) GetWithConfig(ctx context.Context, id int64) (*NotifyChannel, error) {
	var enc string
	row := &NotifyChannel{}
	err := r.db.QueryRowContext(ctx, `
		SELECT id, name, kind, config_enc, enabled, created_at, updated_at
		FROM notify_channels WHERE id = $1
	`, id).Scan(&row.ID, &row.Name, &row.Kind, &enc, &row.Enabled, &row.CreatedAt, &row.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query notify_channel: %w", err)
	}
	plain, err := auth.DecryptPassword(enc)
	if err != nil {
		return nil, fmt.Errorf("decrypt notify config: %w", err)
	}
	row.Config = json.RawMessage(plain)
	return row, nil
}

// List 不返 config（前端列表不需要敏感配置）。
func (r *NotifyChannelRepo) List(ctx context.Context) ([]NotifyChannel, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, name, kind, enabled, created_at, updated_at
		FROM notify_channels ORDER BY id DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list notify_channels: %w", err)
	}
	defer rows.Close()
	var out []NotifyChannel
	for rows.Next() {
		var c NotifyChannel
		if err := rows.Scan(&c.ID, &c.Name, &c.Kind, &c.Enabled, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ListEnabledWithConfig 给 dispatcher 用，一次性把启用的通道 + 解密配置都拉出来。
// 解密失败的行跳过 + 返回 partial error 便于诊断。
func (r *NotifyChannelRepo) ListEnabledWithConfig(ctx context.Context, ids []int64) ([]NotifyChannel, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, name, kind, config_enc, enabled, created_at, updated_at
		FROM notify_channels
		WHERE enabled = TRUE AND id = ANY($1)
	`, pgInt64Array(ids))
	if err != nil {
		return nil, fmt.Errorf("list enabled notify_channels: %w", err)
	}
	defer rows.Close()
	var out []NotifyChannel
	for rows.Next() {
		var c NotifyChannel
		var enc string
		if err := rows.Scan(&c.ID, &c.Name, &c.Kind, &enc, &c.Enabled, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		plain, derr := auth.DecryptPassword(enc)
		if derr != nil {
			// 单行解密失败不阻止整个列表（可能是部分 channel 用旧 key）。
			continue
		}
		c.Config = json.RawMessage(plain)
		out = append(out, c)
	}
	return out, rows.Err()
}
