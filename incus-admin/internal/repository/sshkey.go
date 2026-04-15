package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/incuscloud/incus-admin/internal/model"
)

type SSHKeyRepo struct {
	db *sql.DB
}

func NewSSHKeyRepo(db *sql.DB) *SSHKeyRepo {
	return &SSHKeyRepo{db: db}
}

func (r *SSHKeyRepo) ListByUser(ctx context.Context, userID int64) ([]model.SSHKey, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, user_id, name, public_key, fingerprint, created_at FROM ssh_keys WHERE user_id = $1 ORDER BY id DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var keys []model.SSHKey
	for rows.Next() {
		var k model.SSHKey
		if err := rows.Scan(&k.ID, &k.UserID, &k.Name, &k.PublicKey, &k.Fingerprint, &k.CreatedAt); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func (r *SSHKeyRepo) Create(ctx context.Context, userID int64, name, publicKey, fingerprint string) (*model.SSHKey, error) {
	var k model.SSHKey
	err := r.db.QueryRowContext(ctx,
		`INSERT INTO ssh_keys (user_id, name, public_key, fingerprint) VALUES ($1, $2, $3, $4)
		 RETURNING id, user_id, name, public_key, fingerprint, created_at`,
		userID, name, publicKey, fingerprint,
	).Scan(&k.ID, &k.UserID, &k.Name, &k.PublicKey, &k.Fingerprint, &k.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("create ssh key: %w", err)
	}
	return &k, nil
}

func (r *SSHKeyRepo) Delete(ctx context.Context, id, userID int64) error {
	result, err := r.db.ExecContext(ctx,
		`DELETE FROM ssh_keys WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("ssh key not found")
	}
	return nil
}

func (r *SSHKeyRepo) GetByUser(ctx context.Context, userID int64) ([]string, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT public_key FROM ssh_keys WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var keys []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}
