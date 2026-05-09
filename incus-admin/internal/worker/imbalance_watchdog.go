package worker

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/incuscloud/incus-admin/internal/cluster"
	"github.com/incuscloud/incus-admin/internal/repository"
	"github.com/incuscloud/incus-admin/internal/service/rebalance"
)

// PLAN-039 / OPS-044 imbalance watchdog
//
// 周期性运行 rebalance.Compute；同一 cluster 连续 ≥ persistTicks 次 imbalanced
// 才升级为告警（防抖）。任一 tick 翻转为 balanced → 立即 resolve active alert。
//
// **永不自动迁移** —— 仅写 system_alerts 表 + 让前端展示 banner，admin 自行决定。

// AlertWriter 是 watchdog 写告警的子集；测试可注入 stub。
type AlertWriter interface {
	UpsertActive(ctx context.Context, kind, cluster, severity string, payload []byte) error
	ResolveActive(ctx context.Context, kind, cluster string) error
}

// VMLister 给 watchdog 拉每个 cluster 的活跃 VM 列表（rebalance.VM 输入）。
type VMLister interface {
	ListActiveForRebalance(ctx context.Context, clusterID int64) ([]repository.RebalanceVM, error)
}

// RunImbalanceWatchdog 启动后台监控；ctx 取消后退出。
//
// tickEvery <= 0 → 默认 5min；persistTicks <= 0 → 默认 3（即连续 15min 不均衡才告警）。
// scheduler / mgr / vmRepo / alertRepo 任一为 nil → 直接退出（部分部署场景禁用）。
func RunImbalanceWatchdog(
	ctx context.Context,
	scheduler *cluster.Scheduler,
	mgr *cluster.Manager,
	vmRepo VMLister,
	alertRepo AlertWriter,
	tickEvery time.Duration,
	persistTicks int,
) {
	if scheduler == nil || mgr == nil || vmRepo == nil || alertRepo == nil {
		slog.Info("imbalance watchdog disabled (deps missing)")
		return
	}
	if tickEvery <= 0 {
		tickEvery = 5 * time.Minute
	}
	if persistTicks <= 0 {
		persistTicks = 3
	}
	slog.Info("imbalance watchdog started", "tick", tickEvery, "persist_ticks", persistTicks)

	// in-memory counter：cluster name → 连续 imbalanced 次数。
	// 进程重启会重置；保守不误报。
	counters := make(map[string]int)
	var mu sync.Mutex

	tick := time.NewTicker(tickEvery)
	defer tick.Stop()

	runOnce := func() {
		for _, client := range mgr.List() {
			runForCluster(ctx, scheduler, mgr, vmRepo, alertRepo, client.Name, counters, &mu, persistTicks)
		}
	}

	// 启动后等一个 tick 再跑（让 scheduler refresh / DB 准备）
	for {
		select {
		case <-ctx.Done():
			slog.Info("imbalance watchdog stopping")
			return
		case <-tick.C:
			runOnce()
		}
	}
}

func runForCluster(
	ctx context.Context,
	scheduler *cluster.Scheduler,
	mgr *cluster.Manager,
	vmRepo VMLister,
	alertRepo AlertWriter,
	clusterName string,
	counters map[string]int,
	mu *sync.Mutex,
	persistTicks int,
) {
	defer func() {
		// recover：单 cluster 失败不应拖死 worker
		if rec := recover(); rec != nil {
			slog.Error("imbalance watchdog panic", "cluster", clusterName, "panic", rec)
		}
	}()

	rawNodes := scheduler.GetNodes(clusterName)
	if len(rawNodes) < 2 {
		return // 单节点 / 空集群无意义
	}

	caps := make([]rebalance.NodeCapacity, 0, len(rawNodes))
	for _, n := range rawNodes {
		caps = append(caps, rebalance.NodeCapacity{
			Name:        n.Name,
			MemTotal:    n.MemTotal,
			MemUsed:     n.MemUsed,
			Maintenance: n.Maintenance,
			Online:      n.Status == "Online",
		})
	}

	clusterID := mgr.IDByName(clusterName)
	rawVMs, err := vmRepo.ListActiveForRebalance(ctx, clusterID)
	if err != nil {
		slog.Warn("watchdog: list vms failed", "cluster", clusterName, "error", err)
		return
	}
	vms := make([]rebalance.VM, 0, len(rawVMs))
	for _, v := range rawVMs {
		if v.Node == "" {
			continue
		}
		vms = append(vms, rebalance.VM{
			Name:     v.Name,
			Project:  v.Project,
			Node:     v.Node,
			MemoryMB: v.MemoryMB,
		})
	}

	plan := rebalance.Compute(caps, vms, rebalance.Default())

	mu.Lock()
	defer mu.Unlock()

	if !plan.Stats.Imbalanced {
		// balanced：清 counter + resolve active alert
		if counters[clusterName] > 0 {
			counters[clusterName] = 0
			if err := alertRepo.ResolveActive(ctx, "imbalance", clusterName); err != nil {
				slog.Warn("watchdog: resolve alert failed", "cluster", clusterName, "error", err)
			} else {
				slog.Info("watchdog: cluster rebalanced; alert resolved", "cluster", clusterName)
			}
		}
		return
	}

	counters[clusterName]++
	if counters[clusterName] < persistTicks {
		// 还没满阈值 → 仅积累，不告警
		return
	}

	// 持续 imbalanced ≥ persistTicks → 升级为告警
	payload, _ := json.Marshal(map[string]any{
		"stats":             plan.Stats,
		"suggestion_count":  len(plan.Suggestions),
		"persistent_ticks":  counters[clusterName],
	})
	severity := "warning"
	if plan.Stats.StdDev > 0.4 {
		severity = "error"
	}
	if err := alertRepo.UpsertActive(ctx, "imbalance", clusterName, severity, payload); err != nil {
		slog.Warn("watchdog: upsert alert failed", "cluster", clusterName, "error", err)
		return
	}
	slog.Info("watchdog: imbalance alert raised",
		"cluster", clusterName, "stddev", plan.Stats.StdDev, "ticks", counters[clusterName])
}
