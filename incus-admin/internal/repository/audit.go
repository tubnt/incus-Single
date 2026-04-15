package repository

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/incuscloud/incus-admin/internal/model"
)

type AuditRepo struct {
	db *sql.DB
}

func NewAuditRepo(db *sql.DB) *AuditRepo {
	return &AuditRepo{db: db}
}

func (r *AuditRepo) Log(ctx context.Context, userID *int64, action, targetType string, targetID int64, details any, ip string) {
	detailsJSON, _ := json.Marshal(details)
	r.db.ExecContext(ctx,
		`INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6)`,
		userID, action, targetType, targetID, string(detailsJSON), ip)
}

func (r *AuditRepo) List(ctx context.Context, limit, offset int) ([]model.AuditLog, int, error) {
	var total int
	r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM audit_logs`).Scan(&total)

	rows, err := r.db.QueryContext(ctx,
		`SELECT id, user_id, action, target_type, target_id, COALESCE(details::text, '{}'), COALESCE(ip_address::text, ''), created_at
		 FROM audit_logs ORDER BY id DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var logs []model.AuditLog
	for rows.Next() {
		var l model.AuditLog
		var uid sql.NullInt64
		if err := rows.Scan(&l.ID, &uid, &l.Action, &l.TargetType, &l.TargetID, &l.Details, &l.IPAddress, &l.CreatedAt); err != nil {
			return nil, 0, err
		}
		if uid.Valid {
			l.UserID = &uid.Int64
		}
		logs = append(logs, l)
	}
	return logs, total, rows.Err()
}
