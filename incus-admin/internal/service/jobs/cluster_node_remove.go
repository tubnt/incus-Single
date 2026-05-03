package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"sync"

	"github.com/incuscloud/incus-admin/internal/model"
	"github.com/incuscloud/incus-admin/internal/sshexec"
)

// clusterNodeRemoveExecutor 编排"从 Incus + Ceph 集群移除节点"。
//
// 不同于 add-node 在新节点跑脚本，remove 是在 leader（已存在的集群成员）跑
// `scale-node.sh --remove <name>`，它内部完成：
//
//	1/7 安全检查（法定人数）
//	2/7 检查节点上 VM
//	3/7 疏散 VM
//	4/7 移除 Ceph OSD
//	5/7 移除 Incus 集群成员
//	6/7 更新监控配置和防火墙
//	7/7 发送通知
//
// scale-node.sh 输出形如 "[STEP] N/7 描述"（去 ANSI 颜色后），按此 marker 推进。
type clusterNodeRemoveExecutor struct{}

const (
	stepPrecheck      = "precheck"
	stepCheckVMs      = "check_vms"
	stepEvacuate      = "evacuate_vms"
	stepRemoveOSD     = "remove_ceph_osd"
	stepLeaveIncus    = "remove_incus_member"
	stepUpdateMonitor = "update_monitoring"
	stepNotify        = "notify"
)

// stripANSI 去 \033[...m 序列；scale-node.sh 输出带颜色码影响 marker 解析。
var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// removeNodeStepRe 匹配 `[STEP] N/7 <desc>` 模式。
var removeNodeStepRe = regexp.MustCompile(`\[STEP\][^\d]*(\d)/7\s+(.+)`)

func removeNodeStepBySection(section int) (int, string) {
	switch section {
	case 1:
		return 0, stepPrecheck
	case 2:
		return 1, stepCheckVMs
	case 3:
		return 2, stepEvacuate
	case 4:
		return 3, stepRemoveOSD
	case 5:
		return 4, stepLeaveIncus
	case 6:
		return 5, stepUpdateMonitor
	case 7:
		return 6, stepNotify
	}
	return -1, ""
}

func (e *clusterNodeRemoveExecutor) Run(ctx context.Context, rt *Runtime, job *model.ProvisioningJob) error {
	params := rt.peekParams(job.ID)
	if params == nil {
		return fmt.Errorf("params missing for job %d", job.ID)
	}
	if params.NodeName == "" {
		return fmt.Errorf("NodeName required")
	}
	if params.LeaderHost == "" {
		return fmt.Errorf("LeaderHost required for remove (要在已有集群成员上跑 scale-node.sh)")
	}
	sshUser := params.SSHUser
	if sshUser == "" {
		sshUser = "root"
	}
	scriptDir := params.ScriptDir
	if scriptDir == "" {
		scriptDir = "/tmp/incus-admin-cluster-remove"
	}

	// 上传 scripts/scale-node.sh + configs/cluster-env.sh + update-monitoring-targets.sh 到 leader
	if err := uploadEmbeddedScripts(ctx, params.LeaderHost, sshUser, nil, params.SSHKeyFile, params.KnownHostsFile, scriptDir); err != nil {
		return fmt.Errorf("upload scripts to leader: %w", err)
	}

	runner := sshexec.New(params.LeaderHost, sshUser, params.SSHKeyFile).WithKnownHosts(params.KnownHostsFile)
	cmd := fmt.Sprintf(
		"bash %s/scripts/scale-node.sh --remove %s --force --no-notify",
		shellQuote(scriptDir), shellQuote(params.NodeName),
	)

	var (
		mu          sync.Mutex
		currentSeq  = -1
		currentName = ""
		lastError   string
	)
	finishCurrent := func(status, detail string) {
		if currentSeq < 0 {
			return
		}
		rt.finishStep(ctx, job.ID, currentSeq, currentName, status, detail)
	}

	onLine := func(line string) {
		mu.Lock()
		defer mu.Unlock()
		clean := ansiRe.ReplaceAllString(line, "")
		if m := removeNodeStepRe.FindStringSubmatch(clean); m != nil {
			finishCurrent(model.StepStatusSucceeded, "")
			seq, name := removeNodeStepBySection(parseSection(m[1]))
			if seq < 0 {
				slog.Warn("unexpected scale-node section", "section", m[1])
				return
			}
			currentSeq, currentName = seq, name
			rt.step(ctx, job.ID, seq, name, model.StepStatusRunning, strings.TrimSpace(m[2]))
			return
		}
		if strings.Contains(clean, "[ERR]") || strings.Contains(clean, "[ERROR]") {
			lastError = clean
		}
		if currentSeq >= 0 {
			truncated := clean
			if len(truncated) > 160 {
				truncated = truncated[:160] + "…"
			}
			_ = rt.deps.Jobs.UpdateStep(ctx, job.ID, currentSeq, model.StepStatusRunning, truncated)
		}
	}

	streamErr := runner.RunStream(ctx, cmd, onLine)

	mu.Lock()
	defer mu.Unlock()
	if streamErr != nil {
		detail := lastError
		if detail == "" {
			detail = streamErr.Error()
		}
		finishCurrent(model.StepStatusFailed, detail)
		return fmt.Errorf("remote scale-node.sh: %w", streamErr)
	}
	finishCurrent(model.StepStatusSucceeded, "")

	rt.takeParams(job.ID)
	return nil
}

// Rollback：remove 失败时不做自动恢复 —— evacuate 可能已部分完成、OSD 可能已 out。
// 仅记录 audit + 标 partial，admin 介入决定是否回滚 evacuate / 重加 OSD。
func (e *clusterNodeRemoveExecutor) Rollback(ctx context.Context, rt *Runtime, job *model.ProvisioningJob, reason string) {
	rt.takeParams(job.ID)
}
