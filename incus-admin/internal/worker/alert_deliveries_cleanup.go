package worker

import (
	"context"
	"log/slog"
	"time"

	"github.com/incuscloud/incus-admin/internal/repository"
)

// PLAN-041 / INFRA-009 alert_deliveries 清理。
//
// 与 audit_cleanup 同模式：每天 1 tick，删除 retentionDays 之前的行。
// 默认 90 天。retentionDays <= 0 → 禁用清理（测试环境）。
func RunAlertDeliveriesCleanup(ctx context.Context, repo *repository.AlertDeliveryRepo, retentionDays int) {
	if repo == nil || retentionDays <= 0 {
		slog.Info("alert_deliveries cleanup disabled")
		return
	}
	slog.Info("alert_deliveries cleanup started", "retention_days", retentionDays)
	tick := time.NewTicker(24 * time.Hour)
	defer tick.Stop()

	runOnce := func() {
		n, err := repo.PurgeOlderThan(ctx, retentionDays)
		if err != nil {
			slog.Warn("alert_deliveries cleanup failed", "error", err)
			return
		}
		if n > 0 {
			slog.Info("alert_deliveries cleanup deleted", "rows", n)
		}
	}

	// 启动后等 1 分钟跑一次，避免与其他启动 worker 抢 DB
	timer := time.NewTimer(time.Minute)
	for {
		select {
		case <-ctx.Done():
			slog.Info("alert_deliveries cleanup stopping")
			return
		case <-timer.C:
			runOnce()
		case <-tick.C:
			runOnce()
		}
	}
}
