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

	// cluster.node.add / cluster.node.remove
	NodeName       string // 新节点名 / 待移除节点名
	NodePublicIP   string // 新节点公网 IP（add 必填）
	NodeRole       string // "osd" 或 "mon-mgr-osd"（add 用，远端 join-node.sh 暂未消费但保留）
	SSHUser        string // 远端 SSH 用户（add）/ leader SSH 用户（remove），默认 root
	SSHKeyFile     string // 私钥路径（admin 服务器本地）
	KnownHostsFile string // known_hosts 文件路径
	LeaderHost     string // 跑 incus cluster add / scale-node.sh 的目标 host，默认配置取
	IncusToken     string // add 时 leader 生成的 join token（在 leader_token 步骤前置同步阶段写入）
	ScriptDir      string // 远端脚本暂存目录，默认 /tmp/incus-admin-scripts

	// OPS-026 / PLAN-028：node 拓扑覆盖（仅 add 用）
	NICPrimary     string // 主网卡名覆盖；为空走 cluster-env.sh 默认
	NICCluster     string // 集群网卡名覆盖
	BridgeName     string // 桥接名覆盖
	MgmtIP         string // mgmt 网 IP 覆盖（不传 = 按 pub IP 末位推算）
	CephPubIP      string // Ceph public 网 IP 覆盖
	CephClusterIP  string // Ceph cluster 网 IP 覆盖
	SkipNetwork    bool   // 跳过 do_network 阶段（运维已预配 IP / 路由 / 桥）
}
