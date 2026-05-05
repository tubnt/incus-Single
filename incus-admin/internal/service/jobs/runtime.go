package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/incuscloud/incus-admin/internal/cluster"
	"github.com/incuscloud/incus-admin/internal/model"
	"github.com/incuscloud/incus-admin/internal/repository"
)

// Deps 集中声明 runtime 依赖。每条都是 jobs 必须的能力，调用方在 main 里组装。
type Deps struct {
	Jobs       *repository.ProvisioningJobRepo
	VMs        *repository.VMRepo
	IPAddrs    *repository.IPAddrRepo
	Users      *repository.UserRepo
	Orders     *repository.OrderRepo
	Audit      AuditWriter
	Clusters   *cluster.Manager
	OSTemplates *repository.OSTemplateRepo // 重装时按 slug 查 image_source
	// PLAN-036：vm.create finalize 软失败应用用户默认 firewall_groups。
	// 任一为 nil 时跳过（保持向后兼容 + 测试环境无 firewall service）。
	Firewall    DefaultFirewallApplier
	// PoolSize 是 worker 池容量；建议 4–8。0 取默认 4。
	PoolSize int
}

// DefaultFirewallApplier 拓窄到 jobs 所需：列出用户默认组 + attach 到 VM。
// service.FirewallService + repository.FirewallRepo 通过 main 的 adapter 实现此接口。
type DefaultFirewallApplier interface {
	ListDefaultGroups(ctx context.Context, userID int64) ([]model.FirewallGroup, error)
	Attach(ctx context.Context, clusterName, project, vmName string, group *model.FirewallGroup) error
	Bind(ctx context.Context, vmID, groupID int64) error
}

// AuditWriter 与 worker.AuditWriter 同形态：jobs 在终态写 vm.provisioning.{started,succeeded,failed} 三段 audit。
type AuditWriter interface {
	Log(ctx context.Context, userID *int64, action, targetType string, targetID int64, details map[string]any, ip string)
}

// Runtime 持有 worker 池 + broker，handler 调 Enqueue 入队，worker 异步跑。
//
// params 是 in-memory job 参数缓存，handler 入队时存入；worker 消费后清除；
// 进程崩溃时丢失没问题 —— sweeper 会把缺失 params 的 stale running job 直接
// 走 rollback 路径（释放 IP / 退款 / cancel order）。
type Runtime struct {
	deps    Deps
	broker  *Broker
	queue   chan int64
	wg      sync.WaitGroup
	once    sync.Once
	pmu     sync.Mutex
	params  map[int64]*Params
	// dispatchFn 在测试里可注入返回桩 Executor；生产留 nil 走 default dispatch。
	dispatchFn func(*model.ProvisioningJob) (Executor, error)
}

func NewRuntime(deps Deps) *Runtime {
	if deps.PoolSize <= 0 {
		deps.PoolSize = 4
	}
	return &Runtime{
		deps:   deps,
		broker: NewBroker(),
		queue:  make(chan int64, 64),
		params: make(map[int64]*Params),
	}
}

func (r *Runtime) Broker() *Broker { return r.broker }

func (r *Runtime) setParams(jobID int64, p Params) {
	r.pmu.Lock()
	defer r.pmu.Unlock()
	cp := p
	r.params[jobID] = &cp
}

func (r *Runtime) takeParams(jobID int64) *Params {
	r.pmu.Lock()
	defer r.pmu.Unlock()
	p := r.params[jobID]
	delete(r.params, jobID)
	return p
}

func (r *Runtime) peekParams(jobID int64) *Params {
	r.pmu.Lock()
	defer r.pmu.Unlock()
	return r.params[jobID]
}

// Start 启动 N 个 worker goroutine + recovery sweeper（每 5min 扫一次老 row）。
// ctx 取消后 worker 退出；queue 中尚未消费的 job 会被下一次重启时的 sweeper 兜底。
func (r *Runtime) Start(ctx context.Context) {
	r.once.Do(func() {
		// 启动时先做一次 recovery：把上次进程崩溃留下的 running/queued 老 row
		// 标 partial 并触发 rollback。30 分钟阈值留给未崩溃但仍在跑的 long job。
		r.recoverStale(ctx, 30*time.Minute)

		for i := 0; i < r.deps.PoolSize; i++ {
			r.wg.Add(1)
			go r.worker(ctx, i)
		}

		go r.sweeper(ctx)
	})
}

// Stop 等所有 worker 退出。调用方应先 cancel runtime ctx。
func (r *Runtime) Stop() { r.wg.Wait() }

// Enqueue 把已 INSERT 的 job 推入队列，并暂存 params。queue 满时阻塞等待
// （避免静默丢任务）。handler 拿到 job_id 后立即返 202。
func (r *Runtime) Enqueue(ctx context.Context, jobID int64, params Params) error {
	r.setParams(jobID, params)
	select {
	case <-ctx.Done():
		// ctx 取消，回收 params
		r.takeParams(jobID)
		return ctx.Err()
	case r.queue <- jobID:
		return nil
	}
}

func (r *Runtime) worker(ctx context.Context, idx int) {
	defer r.wg.Done()
	slog.Info("provisioning job worker started", "idx", idx)
	for {
		select {
		case <-ctx.Done():
			slog.Info("provisioning job worker stopping", "idx", idx)
			return
		case jobID := <-r.queue:
			// pma-cr MEDIUM：runOne 内部已对 executor.Run 做 recover；这里再
			// 包一层防 dispatch / MarkRunning / finalize / Rollback 的意外 panic
			// 干掉 worker goroutine（pool 永久缩容）。捕获后继续 loop。
			func() {
				defer func() {
					if rec := recover(); rec != nil {
						slog.Error("provisioning worker recover", "idx", idx, "job_id", jobID, "panic", rec)
					}
				}()
				r.runOne(ctx, jobID)
			}()
		}
	}
}

// runOne 执行一个 job 的全生命周期：load → MarkRunning → 派发到对应 executor →
// 写终态 → publish terminal event → 关订阅。
//
// 每个 job 用独立的 ctx（base + 30min 超时）+ 不被 worker ctx 取消。这样
// shutdown 时 in-flight job 仍能跑完，避免下一次启动 sweep 把它当 partial。
func (r *Runtime) runOne(parent context.Context, jobID int64) {
	job, err := r.deps.Jobs.GetByID(parent, jobID)
	if err != nil {
		slog.Error("load job failed", "job_id", jobID, "error", err)
		return
	}
	if job == nil {
		slog.Warn("job vanished before run", "job_id", jobID)
		return
	}

	if err := r.deps.Jobs.MarkRunning(parent, jobID); err != nil {
		// 已经 running（多 worker race）或已终态：忽略
		slog.Debug("mark running skipped", "job_id", jobID, "reason", err)
		return
	}

	// audit started —— action label 按 kind 派生，让查询日志的人能按 prefix 过滤：
	//   vm.create / vm.reinstall  → "vm.provisioning.started"
	//   cluster.node.add/remove   → "node.provisioning.started"
	uid := job.UserID
	r.deps.Audit.Log(parent, &uid, auditActionByKind(job.Kind, "started"), "job", jobID, map[string]any{
		"kind":        job.Kind,
		"target_name": job.TargetName,
		"cluster_id":  job.ClusterID,
	}, "")

	// detached ctx：worker shutdown 不取消进行中的 job；30min 是 image-pull 上限
	jobCtx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	exec, err := r.dispatch(job)
	if err != nil {
		r.finalize(jobCtx, job, model.JobStatusFailed, err.Error())
		return
	}

	// 包一层 panic 兜底防 worker goroutine 永久死掉（pma-cr MEDIUM）。
	// 任何 executor 内未捕获 panic → finalize failed + Rollback。
	runErr := func() (rerr error) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("provisioning executor panic", "job_id", job.ID, "panic", rec)
				rerr = fmt.Errorf("executor panic: %v", rec)
			}
		}()
		return exec.Run(jobCtx, r, job)
	}()
	if runErr != nil {
		// pma-cr CRITICAL：Run 失败必须先做补偿（释放 IP / 退款 / 取消订单 /
		// 删残留 instance），再写终态。原版只 finalize failed 不调 Rollback ——
		// 用户被扣款 VM 没建成也没退款。
		exec.Rollback(jobCtx, r, job, runErr.Error())
		r.finalize(jobCtx, job, model.JobStatusFailed, runErr.Error())
		return
	}

	r.finalize(jobCtx, job, model.JobStatusSucceeded, "")
}

func (r *Runtime) finalize(ctx context.Context, job *model.ProvisioningJob, status, errMsg string) {
	if err := r.deps.Jobs.Finish(ctx, job.ID, status, errMsg); err != nil {
		slog.Error("finalize job failed", "job_id", job.ID, "error", err)
	}
	uid := job.UserID
	suffix := "succeeded"
	details := map[string]any{
		"kind":        job.Kind,
		"target_name": job.TargetName,
	}
	if status != model.JobStatusSucceeded {
		suffix = "failed"
		details["error"] = errMsg
	}
	r.deps.Audit.Log(ctx, &uid, auditActionByKind(job.Kind, suffix), "job", job.ID, details, "")

	// publish terminal so SSE 订阅者收到后断开
	r.broker.Publish(StepEvent{JobID: job.ID, Terminal: true, Status: status})
}

// auditActionByKind 按 job.Kind 派生 audit action label，让 audit grep
// 能按 vm.* / node.* 过滤。suffix 应为 started / succeeded / failed。
func auditActionByKind(kind, suffix string) string {
	switch kind {
	case model.JobKindClusterNodeAdd, model.JobKindClusterNodeRemove:
		return "node.provisioning." + suffix
	default:
		return "vm.provisioning." + suffix
	}
}

func (r *Runtime) dispatch(job *model.ProvisioningJob) (Executor, error) {
	if r.dispatchFn != nil {
		return r.dispatchFn(job)
	}
	switch job.Kind {
	case model.JobKindVMCreate:
		return &vmCreateExecutor{}, nil
	case model.JobKindVMReinstall:
		return &vmReinstallExecutor{}, nil
	case model.JobKindClusterNodeAdd:
		return &clusterNodeAddExecutor{}, nil
	case model.JobKindClusterNodeRemove:
		return &clusterNodeRemoveExecutor{}, nil
	default:
		return nil, fmt.Errorf("unknown job kind %q", job.Kind)
	}
}

// sweeper 周期性扫超过 maxAge 的 running job，标 partial 并触发 rollback。
// 与 healing_expire 同模式：5min tick，比 30min 阈值密 6 倍，最多 5min 漂移。
func (r *Runtime) sweeper(ctx context.Context) {
	tick := time.NewTicker(5 * time.Minute)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			r.recoverStale(ctx, 30*time.Minute)
		}
	}
}

func (r *Runtime) recoverStale(ctx context.Context, maxAge time.Duration) {
	cutoff := time.Now().Add(-maxAge)
	stale, err := r.deps.Jobs.FindStaleRunning(ctx, cutoff)
	if err != nil {
		slog.Error("find stale jobs failed", "error", err)
		return
	}
	for _, j := range stale {
		j := j
		slog.Warn("recovering stale provisioning job", "job_id", j.ID, "kind", j.Kind, "started_at", j.StartedAt)
		// 标 partial 让 finalize 走 fail 分支 + 触发 audit；rollback 走 dispatch
		if err := r.deps.Jobs.Finish(ctx, j.ID, model.JobStatusPartial, "recovered after process restart or stale > 30m"); err != nil {
			slog.Error("finalize stale failed", "job_id", j.ID, "error", err)
			continue
		}
		// 派发同一 executor 的 Rollback 路径（创建态已部分写入资源时清扫）
		if exec, derr := r.dispatch(&j); derr == nil {
			rec := j
			exec.Rollback(ctx, r, &rec, "stale recovery")
		}
		r.deps.Audit.Log(ctx, &j.UserID, auditActionByKind(j.Kind, "failed"), "job", j.ID, map[string]any{
			"kind":   j.Kind,
			"reason": "stale recovery",
		}, "")
		r.broker.Publish(StepEvent{JobID: j.ID, Terminal: true, Status: model.JobStatusPartial})
	}
}

// step 是 executor 内部的进度推送辅助。封装 AppendStep + Publish 双写，
// 失败仅记录 slog 不中断流程（broker 是尽力而为，DB 是真源）。
func (r *Runtime) step(ctx context.Context, jobID int64, seq int, name, status, detail string) {
	step, err := r.deps.Jobs.AppendStep(ctx, jobID, seq, name, status, detail)
	if err != nil {
		slog.Error("append step failed", "job_id", jobID, "seq", seq, "error", err)
		return
	}
	r.broker.Publish(StepEvent{JobID: jobID, Step: *step})
}

// finishStep 把 running step 翻到终态并推送。
func (r *Runtime) finishStep(ctx context.Context, jobID int64, seq int, name, status, detail string) {
	if err := r.deps.Jobs.UpdateStep(ctx, jobID, seq, status, detail); err != nil {
		slog.Error("update step failed", "job_id", jobID, "seq", seq, "error", err)
	}
	// 重新拉一次拿最新的 completed_at，简化下游
	steps, err := r.deps.Jobs.ListSteps(ctx, jobID, seq-1)
	if err != nil || len(steps) == 0 {
		return
	}
	for _, s := range steps {
		if s.Seq == seq {
			r.broker.Publish(StepEvent{JobID: jobID, Step: s})
			return
		}
	}
}
