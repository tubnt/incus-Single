package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/incuscloud/incus-admin/internal/model"
)

type ProductRepo struct {
	db *sql.DB
}

func NewProductRepo(db *sql.DB) *ProductRepo {
	return &ProductRepo{db: db}
}

func (r *ProductRepo) ListActive(ctx context.Context) ([]model.Product, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, name, slug, cpu, memory_mb, disk_gb, bandwidth_tb, price_monthly, access, active, sort_order
		 FROM products WHERE active = true ORDER BY sort_order ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var products []model.Product
	for rows.Next() {
		var p model.Product
		if err := rows.Scan(&p.ID, &p.Name, &p.Slug, &p.CPU, &p.MemoryMB, &p.DiskGB, &p.BandwidthTB, &p.PriceMonthly, &p.Access, &p.Active, &p.SortOrder); err != nil {
			return nil, err
		}
		products = append(products, p)
	}
	return products, rows.Err()
}

func (r *ProductRepo) ListAll(ctx context.Context) ([]model.Product, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, name, slug, cpu, memory_mb, disk_gb, bandwidth_tb, price_monthly, access, active, sort_order
		 FROM products ORDER BY sort_order ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var products []model.Product
	for rows.Next() {
		var p model.Product
		if err := rows.Scan(&p.ID, &p.Name, &p.Slug, &p.CPU, &p.MemoryMB, &p.DiskGB, &p.BandwidthTB, &p.PriceMonthly, &p.Access, &p.Active, &p.SortOrder); err != nil {
			return nil, err
		}
		products = append(products, p)
	}
	return products, rows.Err()
}

func (r *ProductRepo) GetByID(ctx context.Context, id int64) (*model.Product, error) {
	var p model.Product
	err := r.db.QueryRowContext(ctx,
		`SELECT id, name, slug, cpu, memory_mb, disk_gb, bandwidth_tb, price_monthly, access, active, sort_order
		 FROM products WHERE id = $1`, id,
	).Scan(&p.ID, &p.Name, &p.Slug, &p.CPU, &p.MemoryMB, &p.DiskGB, &p.BandwidthTB, &p.PriceMonthly, &p.Access, &p.Active, &p.SortOrder)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *ProductRepo) Create(ctx context.Context, p *model.Product) (*model.Product, error) {
	var out model.Product
	err := r.db.QueryRowContext(ctx,
		`INSERT INTO products (name, slug, cpu, memory_mb, disk_gb, bandwidth_tb, price_monthly, access, active, sort_order)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		 RETURNING id, name, slug, cpu, memory_mb, disk_gb, bandwidth_tb, price_monthly, access, active, sort_order`,
		p.Name, p.Slug, p.CPU, p.MemoryMB, p.DiskGB, p.BandwidthTB, p.PriceMonthly, p.Access, p.Active, p.SortOrder,
	).Scan(&out.ID, &out.Name, &out.Slug, &out.CPU, &out.MemoryMB, &out.DiskGB, &out.BandwidthTB, &out.PriceMonthly, &out.Access, &out.Active, &out.SortOrder)
	if err != nil {
		return nil, fmt.Errorf("create product: %w", err)
	}
	return &out, nil
}

func (r *ProductRepo) Update(ctx context.Context, p *model.Product) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE products SET name=$1, slug=$2, cpu=$3, memory_mb=$4, disk_gb=$5, bandwidth_tb=$6, price_monthly=$7, access=$8, active=$9, sort_order=$10, updated_at=NOW() WHERE id=$11`,
		p.Name, p.Slug, p.CPU, p.MemoryMB, p.DiskGB, p.BandwidthTB, p.PriceMonthly, p.Access, p.Active, p.SortOrder, p.ID)
	return err
}
