// Package observability 集中暴露给 Prometheus 的业务指标。
//
// PLAN-041 / INFRA-009 设计要点：
//   - 业务指标（active VMs / pending orders / active alerts / ...）后台 30s
//     刷新到 GaugeVec.Set；scrape 时 promhttp 直接读 GaugeVec，无 stampede。
//   - 不在 prometheus.Collector 的 Collect() 里读 DB（社区 client_golang 反模式）。
//   - 可选 Incus prometheus fan-out 留 v2；本期仅业务指标。
//
// 默认匿名暴露（决策 D13 = A）；外部 Bearer 通过 env METRICS_BEARER_TOKEN 控制。
// 业务指标不带 user_id label（决策 D18 = A），避免租户隔离泄漏。
package observability

import (
	"context"
	"database/sql"
	"log/slog"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// Metrics 是所有 GaugeVec / Counter 的集中入口。main.go 启动时
// New + Register + StartRefresh，请求路径里的代码（service / handler）若要
// "实时点数"也可以直接调 Inc/Add/Set；Refresh 会用 DB 真值覆盖避免漂移。
type Metrics struct {
	VMsActive       *prometheus.GaugeVec   // labels: status
	VMsTotal        prometheus.Gauge       // 不区分 status
	OrdersPending   prometheus.Gauge
	OrdersTotal     prometheus.Gauge
	JobsFailed      *prometheus.GaugeVec   // labels: kind
	AlertsActive    *prometheus.GaugeVec   // labels: kind, severity
	BalanceTotal    prometheus.Gauge
	BackupRunsTotal *prometheus.GaugeVec   // PLAN-040 落地后接，本期空 → 始终 0
	BuildInfo       *prometheus.GaugeVec   // labels: version, dist_hash, env
}

func New() *Metrics {
	return &Metrics{
		VMsActive: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "incusadmin_vms_active",
			Help: "Number of active VMs grouped by status (running/stopped/error/...)",
		}, []string{"status"}),
		VMsTotal: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "incusadmin_vms_total",
			Help: "Total number of VM rows in DB (excludes hard-deleted).",
		}),
		OrdersPending: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "incusadmin_orders_pending",
			Help: "Number of pending orders awaiting payment.",
		}),
		OrdersTotal: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "incusadmin_orders_total",
			Help: "Total number of orders in DB.",
		}),
		JobsFailed: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "incusadmin_jobs_failed",
			Help: "Number of provisioning jobs in failed status grouped by kind.",
		}, []string{"kind"}),
		AlertsActive: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "incusadmin_alerts_active",
			Help: "Number of active (unresolved) alerts grouped by kind and severity.",
		}, []string{"kind", "severity"}),
		BalanceTotal: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "incusadmin_balance_total",
			Help: "Sum of customer balances (USD).",
		}),
		BackupRunsTotal: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "incusadmin_backup_runs_total",
			Help: "Total backup runs grouped by status (placeholder; PLAN-040 will populate).",
		}, []string{"status"}),
		BuildInfo: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "incusadmin_build_info",
			Help: "Constant 1 with version/dist_hash/env labels for joining.",
		}, []string{"version", "dist_hash", "env"}),
	}
}

// Register 把所有 collector 注册到给定 registry。main.go 必须在 StartRefresh 前调。
func (m *Metrics) Register(reg prometheus.Registerer) {
	reg.MustRegister(
		m.VMsActive, m.VMsTotal,
		m.OrdersPending, m.OrdersTotal,
		m.JobsFailed,
		m.AlertsActive,
		m.BalanceTotal,
		m.BackupRunsTotal,
		m.BuildInfo,
	)
}

// SetBuildInfo 启动时调一次，把版本信息固化在 incusadmin_build_info{...} = 1。
func (m *Metrics) SetBuildInfo(version, distHash, env string) {
	m.BuildInfo.WithLabelValues(version, distHash, env).Set(1)
}

// StartRefresh 启动一个 goroutine，按 interval 周期刷新 DB-driven 指标。
// 取消 ctx 后 goroutine 退出。interval <= 0 → 默认 30s（与 Prom 默认 scrape 同频）。
func (m *Metrics) StartRefresh(ctx context.Context, db *sql.DB, interval time.Duration) {
	if db == nil {
		slog.Info("observability metrics refresh disabled (no DB)")
		return
	}
	if interval <= 0 {
		interval = 30 * time.Second
	}
	go func() {
		// 启动后立即跑一次，避免首次 scrape 全 0
		m.refreshOnce(ctx, db)
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				slog.Info("observability metrics refresh stopping")
				return
			case <-t.C:
				m.refreshOnce(ctx, db)
			}
		}
	}()
	slog.Info("observability metrics refresh started", "interval", interval)
}

func (m *Metrics) refreshOnce(ctx context.Context, db *sql.DB) {
	defer func() {
		if rec := recover(); rec != nil {
			slog.Error("metrics refresh panic", "panic", rec)
		}
	}()

	// VMs by status
	rows, err := db.QueryContext(ctx, `
		SELECT status, COUNT(*) FROM vms
		WHERE status NOT IN ('deleted')
		GROUP BY status
	`)
	if err != nil {
		slog.Warn("metrics refresh vms failed", "error", err)
	} else {
		// 先清旧 label（避免 status 消失后 GaugeVec 一直留旧值）
		m.VMsActive.Reset()
		var total float64
		for rows.Next() {
			var status string
			var n int64
			if err := rows.Scan(&status, &n); err != nil {
				continue
			}
			m.VMsActive.WithLabelValues(status).Set(float64(n))
			total += float64(n)
		}
		_ = rows.Close()
		m.VMsTotal.Set(total)
	}

	// Orders pending / total
	var pending, ordersTotal int64
	_ = db.QueryRowContext(ctx, `SELECT COUNT(*) FROM orders WHERE status='pending'`).Scan(&pending)
	_ = db.QueryRowContext(ctx, `SELECT COUNT(*) FROM orders`).Scan(&ordersTotal)
	m.OrdersPending.Set(float64(pending))
	m.OrdersTotal.Set(float64(ordersTotal))

	// Failed jobs by kind
	jobRows, err := db.QueryContext(ctx, `
		SELECT kind, COUNT(*) FROM provisioning_jobs WHERE status='failed' GROUP BY kind
	`)
	if err != nil {
		slog.Warn("metrics refresh jobs failed", "error", err)
	} else {
		m.JobsFailed.Reset()
		for jobRows.Next() {
			var kind string
			var n int64
			if err := jobRows.Scan(&kind, &n); err != nil {
				continue
			}
			m.JobsFailed.WithLabelValues(kind).Set(float64(n))
		}
		_ = jobRows.Close()
	}

	// Active alerts by (kind, severity)
	alertRows, err := db.QueryContext(ctx, `
		SELECT kind, severity, COUNT(*)
		FROM system_alerts
		WHERE resolved_at IS NULL
		GROUP BY kind, severity
	`)
	if err != nil {
		slog.Warn("metrics refresh alerts failed", "error", err)
	} else {
		m.AlertsActive.Reset()
		for alertRows.Next() {
			var kind, severity string
			var n int64
			if err := alertRows.Scan(&kind, &severity, &n); err != nil {
				continue
			}
			m.AlertsActive.WithLabelValues(kind, severity).Set(float64(n))
		}
		_ = alertRows.Close()
	}

	// Customer balance total
	var bal sql.NullFloat64
	_ = db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(balance), 0) FROM users WHERE role='customer'`,
	).Scan(&bal)
	m.BalanceTotal.Set(bal.Float64)
}
