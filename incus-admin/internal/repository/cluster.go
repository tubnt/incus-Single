package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/incuscloud/incus-admin/internal/model"
)

type ClusterRepo struct {
	db *sql.DB
}

func NewClusterRepo(db *sql.DB) *ClusterRepo {
	return &ClusterRepo{db: db}
}

// Upsert inserts a cluster if missing, otherwise updates display_name / api_url /
// status keyed by name. Returns the resulting row's ID.
func (r *ClusterRepo) Upsert(ctx context.Context, name, displayName, apiURL string) (int64, error) {
	var id int64
	err := r.db.QueryRowContext(ctx,
		`INSERT INTO clusters (name, display_name, api_url, status)
		 VALUES ($1, $2, $3, 'active')
		 ON CONFLICT (name) DO UPDATE
		   SET display_name = EXCLUDED.display_name,
		       api_url      = EXCLUDED.api_url,
		       status       = 'active',
		       updated_at   = NOW()
		 RETURNING id`, name, displayName, apiURL).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("upsert cluster %q: %w", name, err)
	}
	return id, nil
}

func (r *ClusterRepo) GetByName(ctx context.Context, name string) (*model.Cluster, error) {
	var c model.Cluster
	err := r.db.QueryRowContext(ctx,
		`SELECT id, name, display_name, api_url, status, created_at, updated_at
		 FROM clusters WHERE name = $1`, name,
	).Scan(&c.ID, &c.Name, &c.DisplayName, &c.APIURL, &c.Status, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &c, err
}

func (r *ClusterRepo) GetByID(ctx context.Context, id int64) (*model.Cluster, error) {
	var c model.Cluster
	err := r.db.QueryRowContext(ctx,
		`SELECT id, name, display_name, api_url, status, created_at, updated_at
		 FROM clusters WHERE id = $1`, id,
	).Scan(&c.ID, &c.Name, &c.DisplayName, &c.APIURL, &c.Status, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &c, err
}

func (r *ClusterRepo) List(ctx context.Context) ([]model.Cluster, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, name, display_name, api_url, status, created_at, updated_at
		 FROM clusters ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []model.Cluster
	for rows.Next() {
		var c model.Cluster
		if err := rows.Scan(&c.ID, &c.Name, &c.DisplayName, &c.APIURL, &c.Status, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
