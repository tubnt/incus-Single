package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// PLAN-041 / INFRA-009 评估器需要的查询。
// 单独成文件，避免污染主 repo（vm.go / user.go / order.go / provisioning_job.go）。

// VMRecentDown 给 evaluator vm_down 评估用。
type VMRecentDown struct {
	VMID    int64
	Name    string
	Cluster string
	Status  string
}

// ListVMRecentlyDown 返回 since 之后状态变成 'gone' / 'error' 的 VM。
//
// 不查 trashed VM（用户主动删的不告警）。cluster 取 clusters.name。
func (r *VMRepo) ListVMRecentlyDown(ctx context.Context, since time.Time) ([]VMRecentDown, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT v.id, v.name, COALESCE(c.name, ''), v.status
		FROM vms v
		LEFT JOIN clusters c ON c.id = v.cluster_id
		WHERE v.status IN ('gone','error')
		  AND v.updated_at >= $1
		  AND v.trashed_at IS NULL
		ORDER BY v.updated_at DESC
	`, since)
	if err != nil {
		return nil, fmt.Errorf("list recently down vms: %w", err)
	}
	defer rows.Close()
	var out []VMRecentDown
	for rows.Next() {
		var d VMRecentDown
		if err := rows.Scan(&d.VMID, &d.Name, &d.Cluster, &d.Status); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// UserBalanceLowRow 给 evaluator balance_low 用。
type UserBalanceLowRow struct {
	ID      int64
	Email   string
	Balance float64
}

// ListUsersBelowBalance 列出余额低于阈值的（非 admin）用户。admin 余额无业务意义，
// 跳过避免误报。
func (r *UserRepo) ListUsersBelowBalance(ctx context.Context, threshold float64) ([]UserBalanceLowRow, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, email, balance
		FROM users
		WHERE role = 'customer' AND balance < $1
		ORDER BY balance ASC LIMIT 200
	`, threshold)
	if err != nil {
		return nil, fmt.Errorf("list users below balance: %w", err)
	}
	defer rows.Close()
	var out []UserBalanceLowRow
	for rows.Next() {
		var u UserBalanceLowRow
		if err := rows.Scan(&u.ID, &u.Email, &u.Balance); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// CountFailedJobsSince 给 evaluator job_failed 用。
func (r *ProvisioningJobRepo) CountFailedJobsSince(ctx context.Context, since time.Time) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM provisioning_jobs
		WHERE status = 'failed' AND completed_at >= $1
	`, since).Scan(&n)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("count failed jobs since: %w", err)
	}
	return n, nil
}

// CountFailedOrdersSince 给 evaluator order_failed 用。
//
// 业务定义：'cancelled' 含义不一定是失败（有用户主动取消），改用 status 转换
// 历史（orders.updated_at + status='failed' 严格）；本仓库 Order 没有 'failed'
// status，使用一个保守逻辑：cancelled 计入。
func (r *OrderRepo) CountFailedOrdersSince(ctx context.Context, since time.Time) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM orders
		WHERE status = 'cancelled' AND updated_at >= $1
	`, since).Scan(&n)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("count failed orders since: %w", err)
	}
	return n, nil
}
