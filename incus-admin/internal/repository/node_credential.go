package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// NodeCredential 是 PLAN-033 / OPS-039 引入的"运维进入新节点"凭据。
// 区别于 ssh_keys 表（用户公钥，注入到 VM cloud-init）。
//
// Plaintext 字段（password / key_data）由调用方调用 auth.EncryptPassword
// 加密到 Ciphertext 后落库；查询时调用方再解密。这里 repo 层不感知明文。
type NodeCredential struct {
	ID          int64
	Name        string
	Kind        string // "password" | "private_key"
	Ciphertext  string
	Fingerprint sql.NullString
	CreatedBy   int64
	CreatedAt   time.Time
	LastUsedAt  sql.NullTime
}

type NodeCredentialRepo struct{ db *sql.DB }

func NewNodeCredentialRepo(db *sql.DB) *NodeCredentialRepo {
	return &NodeCredentialRepo{db: db}
}

// ErrNodeCredentialNotFound is returned by GetForUse / Delete when the row
// is missing or owned by someone else (with no role override).
var ErrNodeCredentialNotFound = errors.New("node credential not found")

func (r *NodeCredentialRepo) Create(ctx context.Context, ownerID int64, name, kind, ciphertext string, fingerprint *string) (*NodeCredential, error) {
	var fp sql.NullString
	if fingerprint != nil {
		fp = sql.NullString{Valid: true, String: *fingerprint}
	}
	var c NodeCredential
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO node_credentials (name, kind, ciphertext, fingerprint, created_by)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, name, kind, ciphertext, fingerprint, created_by, created_at, last_used_at
	`, name, kind, ciphertext, fp, ownerID).Scan(
		&c.ID, &c.Name, &c.Kind, &c.Ciphertext, &c.Fingerprint, &c.CreatedBy, &c.CreatedAt, &c.LastUsedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert node credential: %w", err)
	}
	return &c, nil
}

// ListByOwner returns rows the user owns. SuperAdmin views can call ListAll.
func (r *NodeCredentialRepo) ListByOwner(ctx context.Context, ownerID int64) ([]NodeCredential, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, name, kind, ciphertext, fingerprint, created_by, created_at, last_used_at
		FROM node_credentials
		WHERE created_by = $1
		ORDER BY id DESC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanCreds(rows)
}

// ListAll exposes every credential — only for super-admin views.
func (r *NodeCredentialRepo) ListAll(ctx context.Context) ([]NodeCredential, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, name, kind, ciphertext, fingerprint, created_by, created_at, last_used_at
		FROM node_credentials
		ORDER BY id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanCreds(rows)
}

func scanCreds(rows *sql.Rows) ([]NodeCredential, error) {
	var out []NodeCredential
	for rows.Next() {
		var c NodeCredential
		if err := rows.Scan(
			&c.ID, &c.Name, &c.Kind, &c.Ciphertext, &c.Fingerprint,
			&c.CreatedBy, &c.CreatedAt, &c.LastUsedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetForUse loads a credential by id. If requireOwner is true the row must
// belong to ownerID; admins should pass false to bypass.
func (r *NodeCredentialRepo) GetForUse(ctx context.Context, id int64, requireOwner bool, ownerID int64) (*NodeCredential, error) {
	q := `SELECT id, name, kind, ciphertext, fingerprint, created_by, created_at, last_used_at
		FROM node_credentials WHERE id = $1`
	args := []any{id}
	if requireOwner {
		q += ` AND created_by = $2`
		args = append(args, ownerID)
	}
	var c NodeCredential
	err := r.db.QueryRowContext(ctx, q, args...).Scan(
		&c.ID, &c.Name, &c.Kind, &c.Ciphertext, &c.Fingerprint,
		&c.CreatedBy, &c.CreatedAt, &c.LastUsedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNodeCredentialNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// TouchUsed records the last_used_at stamp; failure is non-fatal.
func (r *NodeCredentialRepo) TouchUsed(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE node_credentials SET last_used_at = now() WHERE id = $1`, id)
	return err
}

// Delete removes a credential. requireOwner=true scopes the delete to the
// owner; admins should pass false.
func (r *NodeCredentialRepo) Delete(ctx context.Context, id int64, requireOwner bool, ownerID int64) error {
	q := `DELETE FROM node_credentials WHERE id = $1`
	args := []any{id}
	if requireOwner {
		q += ` AND created_by = $2`
		args = append(args, ownerID)
	}
	res, err := r.db.ExecContext(ctx, q, args...)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNodeCredentialNotFound
	}
	return nil
}
