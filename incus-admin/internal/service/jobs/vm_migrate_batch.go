package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/incuscloud/incus-admin/internal/model"
)

// vmMigrateBatchExecutor 编排"批量冷迁移 N 台 VM 到目标节点"。
//
// 复用 jobs runtime + SSE 步骤推送：
//
//	step 0  plan       规划/排序：对 items 按 source_node 分桶，限并发
//	step 1  migrate    实际执行（并发 N 个 worker，每个 source 子并发上限 K）
//	step 2  summarize  汇总结果（成功 / 失败 / partial）
//
// 失败语义：单台 VM 迁移失败不阻塞其他；最终 status 为 succeeded（全成功）/
// failed（全失败）/ partial（部分失败）。runtime.runOne 仅识别 failed 走 Rollback；
// 这里把"全失败"映射为 failed，"部分失败"通过 finalize 直接走 partial 的 finishStep
// 表达，job 顶层标 succeeded（整体已尽力执行完毕，由 step detail 反映 partial）。
type vmMigrateBatchExecutor struct{}

const (
	stepBatchPlan      = "plan"
	stepBatchMigrate   = "migrate"
	stepBatchSummarize = "summarize"
)

func (e *vmMigrateBatchExecutor) Run(ctx context.Context, rt *Runtime, job *model.ProvisioningJob) error {
	params := rt.peekParams(job.ID)
	if params == nil {
		return fmt.Errorf("params missing for job %d", job.ID)
	}
	if rt.deps.Migrator == nil {
		return fmt.Errorf("migrator not configured (deps.Migrator nil)")
	}
	if len(params.BatchItems) == 0 {
		return fmt.Errorf("batch items empty")
	}
	clusterName := params.ClusterName
	if clusterName == "" {
		clusterName = rt.clusterName(job.ClusterID)
	}
	if clusterName == "" {
		return fmt.Errorf("cluster name unresolved for job %d", job.ID)
	}

	perSrc := params.ConcurrencyPerSrc
	if perSrc <= 0 {
		perSrc = 2
	}
	globalCap := params.GlobalConcurrency
	if globalCap <= 0 {
		globalCap = 4
	}

	total := len(params.BatchItems)

	// step 0: plan —— 仅汇报一次"规划完成"。
	rt.step(ctx, job.ID, 0, stepBatchPlan, model.StepStatusRunning,
		fmt.Sprintf("planning %d items (per-source≤%d, global≤%d)", total, perSrc, globalCap))
	rt.finishStep(ctx, job.ID, 0, stepBatchPlan, model.StepStatusSucceeded,
		fmt.Sprintf("planned %d items", total))

	// step 1: migrate —— 并发执行；progress detail 实时滚动 ok/fail/进度。
	rt.step(ctx, job.ID, 1, stepBatchMigrate, model.StepStatusRunning,
		fmt.Sprintf("0/%d", total))

	var (
		okCount   atomic.Int64
		failCount atomic.Int64
		failures  sync.Map // vm_name -> error string
	)

	// per-source 并发限制：每个 source bucket 一把信号量；空 source（未知源节点）
	// 并发不限于桶，仅受 globalSem 制约。
	srcSems := make(map[string]chan struct{})
	srcMu := sync.Mutex{}
	getSrcSem := func(src string) chan struct{} {
		srcMu.Lock()
		defer srcMu.Unlock()
		if s, ok := srcSems[src]; ok {
			return s
		}
		s := make(chan struct{}, perSrc)
		srcSems[src] = s
		return s
	}

	globalSem := make(chan struct{}, globalCap)
	wg := sync.WaitGroup{}

	progressMu := sync.Mutex{}
	updateProgress := func(item MigrateBatchItem, ok bool, errMsg string) {
		if ok {
			okCount.Add(1)
		} else {
			failCount.Add(1)
			if errMsg != "" {
				failures.Store(item.VMName, errMsg)
			}
		}
		progressMu.Lock()
		defer progressMu.Unlock()
		done := okCount.Load() + failCount.Load()
		detail := fmt.Sprintf("%d/%d (ok=%d fail=%d)", done, total, okCount.Load(), failCount.Load())
		_ = rt.deps.Jobs.UpdateStep(ctx, job.ID, 1, model.StepStatusRunning, detail)
	}

	for i, item := range params.BatchItems {
		i, item := i, item
		wg.Add(1)
		go func() {
			defer wg.Done()

			// 全局并发上限
			select {
			case globalSem <- struct{}{}:
			case <-ctx.Done():
				updateProgress(item, false, "ctx canceled before start")
				return
			}
			defer func() { <-globalSem }()

			// per-source 并发上限（仅当 source 已知）
			if item.SourceNode != "" {
				sem := getSrcSem(item.SourceNode)
				select {
				case sem <- struct{}{}:
				case <-ctx.Done():
					updateProgress(item, false, "ctx canceled before src slot")
					return
				}
				defer func() { <-sem }()
			}

			start := time.Now()
			res, err := rt.deps.Migrator.Migrate(ctx, clusterName, item.Project, item.VMName, item.TargetNode, item.Mode)
			elapsed := time.Since(start).Truncate(time.Millisecond)
			if err != nil {
				slog.Warn("batch migrate item failed",
					"job_id", job.ID, "idx", i, "vm", item.VMName, "target", item.TargetNode,
					"elapsed", elapsed, "error", err)
				updateProgress(item, false, err.Error())
				return
			}
			slog.Info("batch migrate item ok",
				"job_id", job.ID, "idx", i, "vm", item.VMName, "target", item.TargetNode,
				"was_running", res.WasRunning, "elapsed", elapsed)
			updateProgress(item, true, "")
		}()
	}
	wg.Wait()

	ok := okCount.Load()
	fail := failCount.Load()
	doneDetail := fmt.Sprintf("done %d/%d (ok=%d fail=%d)", ok+fail, total, ok, fail)

	switch {
	case fail == 0:
		rt.finishStep(ctx, job.ID, 1, stepBatchMigrate, model.StepStatusSucceeded, doneDetail)
	case ok == 0:
		// 全失败 —— summarize 之后让 runtime 走 failed 路径，触发 audit failed。
		rt.finishStep(ctx, job.ID, 1, stepBatchMigrate, model.StepStatusFailed, doneDetail)
	default:
		// 部分失败 —— step 标记 failed 让前端能渲染 partial 红点；job 顶层仍标
		// succeeded（已尽力执行；调用方按需读 step.detail 看明细）。
		rt.finishStep(ctx, job.ID, 1, stepBatchMigrate, model.StepStatusFailed, doneDetail)
	}

	// step 2: summarize —— 把失败明细打到 step.detail（最多前 5 条），便于前端
	// JobProgress 直接读，不必单独拉 audit。
	rt.step(ctx, job.ID, 2, stepBatchSummarize, model.StepStatusRunning, doneDetail)
	var summary string
	if fail > 0 {
		samples := []string{}
		failures.Range(func(k, v any) bool {
			samples = append(samples, fmt.Sprintf("%s: %s", k, v))
			return len(samples) < 5
		})
		more := ""
		if int64(len(samples)) < fail {
			more = fmt.Sprintf(" (+%d more)", fail-int64(len(samples)))
		}
		summary = fmt.Sprintf("%s; failures: %v%s", doneDetail, samples, more)
	} else {
		summary = doneDetail
	}
	rt.finishStep(ctx, job.ID, 2, stepBatchSummarize, model.StepStatusSucceeded, summary)

	rt.takeParams(job.ID)

	if fail > 0 && ok == 0 {
		return fmt.Errorf("batch migrate all-failed: %d/%d", fail, total)
	}
	return nil
}

// Rollback：批量迁移本身就是 best-effort —— 单台失败不影响其他。已迁移的 VM
// 不应再被"撤销"（撤销=另一次迁移，会进一步打散调度）。仅清 params。
func (e *vmMigrateBatchExecutor) Rollback(ctx context.Context, rt *Runtime, job *model.ProvisioningJob, reason string) {
	rt.takeParams(job.ID)
}
