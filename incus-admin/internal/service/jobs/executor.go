package jobs

import (
	"context"

	"github.com/incuscloud/incus-admin/internal/model"
)

// Executor 是 vm.create / vm.reinstall 共用的接口。
//
// Run 在 in-flight job 上推进步骤；返回 nil 表示成功。
// Rollback 在失败 / stale 恢复时调用，必须幂等：可能已有部分资源（IP、instance）
// 需要清理。runtime 已经把 job 翻到 failed/partial，executor 只关心补偿动作。
type Executor interface {
	Run(ctx context.Context, rt *Runtime, job *model.ProvisioningJob) error
	Rollback(ctx context.Context, rt *Runtime, job *model.ProvisioningJob, reason string)
}

// Params 是 handler 入队时携带的额外配置；存到 provisioning_jobs.params JSONB 是
// 一种选择，但当前 schema 没那列。改用 in-memory map：runtime 维护 jobID→params，
// Enqueue 时 set，worker 消费后 clear。简单也避免 DB 漂移。
type Params struct {
	// vm.create
	Project     string
	CPU         int
	MemoryMB    int
	DiskGB      int
	OSImage     string
	SSHKeys     []string
	IP          string
	Gateway     string
	SubnetCIDR  string
	StoragePool string
	Network     string
	OrderAmount float64 // 用于 rollback 时的退款金额

	// vm.reinstall
	ImageSource string
	ServerURL   string
	Protocol    string
	DefaultUser string
}
