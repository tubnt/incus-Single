package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/incuscloud/incus-admin/internal/cluster"
	"github.com/incuscloud/incus-admin/internal/model"
	"github.com/incuscloud/incus-admin/internal/service"
)

// vmCreateExecutor 执行一次 vm.create 的全部步骤。前置假设：
//   - handler 已同步完成 IP 分配 + INSERT vms row(status='creating')，并把 vm_id 回写 job
//   - handler 已 PayWithBalance 把订单推到 paid → provisioning，余额已扣
// executor 只负责"提交 Incus → 等创建 → 等启动 → 写终态"。
type vmCreateExecutor struct{}

const (
	stepSubmit  = "submit_instance"
	stepWaitCreate = "wait_create"
	stepStart   = "start_instance"
	stepWaitStart = "wait_start"
	stepFinalize = "finalize"
)

func (e *vmCreateExecutor) Run(ctx context.Context, rt *Runtime, job *model.ProvisioningJob) error {
	params := rt.peekParams(job.ID)
	if params == nil {
		return fmt.Errorf("params missing for job %d (process restart?)", job.ID)
	}

	clusterName := rt.clusterName(job.ClusterID)
	client, ok := rt.deps.Clusters.Get(clusterName)
	if !ok {
		return fmt.Errorf("cluster %q not registered", clusterName)
	}

	password := service.GeneratePassword()
	cloudInit := service.BuildCloudInit(password, params.SSHKeys)
	netCfg := service.BuildNetworkConfig(params.IP, params.SubnetCIDR, params.Gateway)

	imageAlias := params.OSImage
	if len(imageAlias) > 7 && imageAlias[:7] == "images:" {
		imageAlias = imageAlias[7:]
	}

	body := map[string]any{
		"name": job.TargetName,
		"type": "virtual-machine",
		"source": map[string]any{
			"type":     "image",
			"alias":    imageAlias,
			"server":   "https://images.linuxcontainers.org",
			"protocol": "simplestreams",
		},
		"config": map[string]any{
			"limits.cpu":                fmt.Sprintf("%d", params.CPU),
			"limits.memory":             fmt.Sprintf("%dMiB", params.MemoryMB),
			"user.cloud-init":           cloudInit,
			"cloud-init.network-config": netCfg,
			"security.secureboot":       "false",
			"migration.stateful":        "true",
		},
		"devices": map[string]any{
			"root": map[string]any{
				"type": "disk",
				"pool": params.StoragePool,
				"path": "/",
				"size": fmt.Sprintf("%dGiB", params.DiskGB),
			},
			"eth0": map[string]any{
				"type":                    "nic",
				"nictype":                 "bridged",
				"parent":                  params.Network,
				"ipv4.address":            params.IP,
				"security.ipv4_filtering": "true",
				"security.mac_filtering":  "true",
			},
		},
	}

	bodyJSON, _ := json.Marshal(body)

	// Step submit_instance
	rt.step(ctx, job.ID, 0, stepSubmit, model.StepStatusRunning, "提交 VM 创建请求")
	resp, err := client.APIPost(ctx, fmt.Sprintf("/1.0/instances?project=%s", params.Project), bytes.NewReader(bodyJSON))
	if err != nil {
		rt.finishStep(ctx, job.ID, 0, stepSubmit, model.StepStatusFailed, err.Error())
		return fmt.Errorf("submit instance: %w", err)
	}
	rt.finishStep(ctx, job.ID, 0, stepSubmit, model.StepStatusSucceeded, "")

	// Step wait_create — 真正的镜像拉取 + 创建发生在这里，可能 30s–5min
	if resp.Type == "async" {
		var op struct{ ID string }
		_ = json.Unmarshal(resp.Metadata, &op)
		if op.ID != "" {
			rt.step(ctx, job.ID, 1, stepWaitCreate, model.StepStatusRunning, "等待镜像拉取与实例创建")
			if werr := client.WaitForOperation(ctx, op.ID); werr != nil {
				rt.finishStep(ctx, job.ID, 1, stepWaitCreate, model.StepStatusFailed, werr.Error())
				return fmt.Errorf("wait create: %w", werr)
			}
			rt.finishStep(ctx, job.ID, 1, stepWaitCreate, model.StepStatusSucceeded, "")
		} else {
			rt.step(ctx, job.ID, 1, stepWaitCreate, model.StepStatusSkipped, "no operation id")
		}
	} else {
		rt.step(ctx, job.ID, 1, stepWaitCreate, model.StepStatusSkipped, "sync response")
	}

	// Step start_instance
	rt.step(ctx, job.ID, 2, stepStart, model.StepStatusRunning, "启动实例")
	startBody, _ := json.Marshal(map[string]any{"action": "start", "timeout": 60})
	startResp, err := client.APIPut(ctx, fmt.Sprintf("/1.0/instances/%s/state?project=%s", job.TargetName, params.Project), bytes.NewReader(startBody))
	if err != nil {
		rt.finishStep(ctx, job.ID, 2, stepStart, model.StepStatusFailed, err.Error())
		return fmt.Errorf("start instance: %w", err)
	}
	rt.finishStep(ctx, job.ID, 2, stepStart, model.StepStatusSucceeded, "")

	// Step wait_start
	if startResp.Type == "async" {
		var op struct{ ID string }
		_ = json.Unmarshal(startResp.Metadata, &op)
		if op.ID != "" {
			rt.step(ctx, job.ID, 3, stepWaitStart, model.StepStatusRunning, "等待 boot 完成")
			if werr := client.WaitForOperation(ctx, op.ID); werr != nil {
				rt.finishStep(ctx, job.ID, 3, stepWaitStart, model.StepStatusFailed, werr.Error())
				return fmt.Errorf("wait start: %w", werr)
			}
			rt.finishStep(ctx, job.ID, 3, stepWaitStart, model.StepStatusSucceeded, "")
		} else {
			rt.step(ctx, job.ID, 3, stepWaitStart, model.StepStatusSkipped, "no operation id")
		}
	} else {
		rt.step(ctx, job.ID, 3, stepWaitStart, model.StepStatusSkipped, "sync response")
	}

	// Step finalize：拉 instance 元数据取 node 名，写回 vm row + 写密码
	rt.step(ctx, job.ID, 4, stepFinalize, model.StepStatusRunning, "记录运行节点与凭据")
	node := ""
	if instanceData, gerr := client.GetInstance(ctx, params.Project, job.TargetName); gerr == nil {
		var inst struct{ Location string }
		_ = json.Unmarshal(instanceData, &inst)
		node = inst.Location
	}

	if job.VMID != nil {
		if err := rt.deps.VMs.UpdateAfterProvision(ctx, *job.VMID, node, password); err != nil {
			rt.finishStep(ctx, job.ID, 4, stepFinalize, model.StepStatusFailed, err.Error())
			return fmt.Errorf("update vm row: %w", err)
		}
	}
	// 订单状态推到 active
	if job.OrderID != nil {
		if err := rt.deps.Orders.UpdateStatus(ctx, *job.OrderID, model.OrderActive); err != nil {
			slog.Error("order activate failed", "job_id", job.ID, "order_id", *job.OrderID, "error", err)
		}
	}
	rt.finishStep(ctx, job.ID, 4, stepFinalize, model.StepStatusSucceeded, "")

	// PLAN-036 默认 firewall_groups 软失败应用：读用户 default 列表，
	// 串行 attach。任一失败仅 log + audit，不阻塞 finalize。VM 已 active，
	// 用户事后可通过 /firewall 集中管理页或 vm-detail 手动补绑。
	if rt.deps.Firewall != nil && job.VMID != nil {
		applyUserDefaultFirewallGroups(ctx, rt, job, rt.clusterName(job.ClusterID), params.Project, job.TargetName)
	}

	// 消费 params
	rt.takeParams(job.ID)
	return nil
}

// Rollback 释放 IP / 删 instance / 退款 / 取消订单 / 标 vm row error。每步幂等：
//   - MarkRefunded 用 refund_done_at IS NULL guard 保证只退一次
//   - 释放 IP 用 IP 字符串幂等（已 cooldown 状态再 Release 不报错）
//   - 删 instance 在 Incus 不存在时也忽略 404
//
// pma-cr MEDIUM：进程崩溃 / sweeper 路径下 params 已丢失，必须从 DB 兜底
// 读 IP（vms.ip）+ amount（orders.amount）。否则 stale recovery 会"finalize
// 但不退款"，跟 CRITICAL 同一根因。
func (e *vmCreateExecutor) Rollback(ctx context.Context, rt *Runtime, job *model.ProvisioningJob, reason string) {
	params := rt.peekParams(job.ID)
	clusterName := rt.clusterName(job.ClusterID)

	// 兜底从 DB 复原 project / IP / amount。params 在线时这些字段会被覆盖
	// 它的值（更准确，因 params 是 handler 当时的事实）。
	project := ""
	ip := ""
	amount := 0.0
	if params != nil {
		project = params.Project
		ip = params.IP
		amount = params.OrderAmount
	}
	if job.VMID != nil {
		if vm, _ := rt.deps.VMs.GetByID(ctx, *job.VMID); vm != nil {
			if ip == "" && vm.IP != nil {
				ip = *vm.IP
			}
		}
	}
	if amount == 0 && job.OrderID != nil {
		if order, _ := rt.deps.Orders.GetByID(ctx, *job.OrderID); order != nil {
			amount = order.Amount
		}
	}
	if project == "" {
		project = "customers" // 与 OrderHandler.Pay 默认一致
	}

	// 1) 删 Incus 上可能残留的 instance（幂等：404 忽略）
	if client, ok := rt.deps.Clusters.Get(clusterName); ok {
		_ = e.bestEffortDeleteInstance(ctx, client, project, job.TargetName)
	}

	// 2) 释放 IP（cooldown）
	if ip != "" {
		if err := rt.deps.IPAddrs.Release(ctx, ip); err != nil {
			slog.Warn("rollback release IP failed", "job_id", job.ID, "ip", ip, "error", err)
		}
	}

	// 3) 退款（原子幂等）—— RefundOnce 在单事务内完成 mark + balance + transactions，
	//    任一步失败整体回滚，下次重试。返回 (false, nil) 说明已退过 → no-op。
	if job.OrderID != nil && amount > 0 {
		desc := fmt.Sprintf("订单 #%d 失败退款: %s", *job.OrderID, reason)
		if _, err := rt.deps.Jobs.RefundOnce(ctx, job.ID, job.UserID, amount, desc); err != nil {
			slog.Error("rollback refund failed; will retry on next sweep", "job_id", job.ID, "error", err)
		}
	}

	// 4) 订单 cancelled
	if job.OrderID != nil {
		if err := rt.deps.Orders.UpdateStatus(ctx, *job.OrderID, model.OrderCancelled); err != nil {
			slog.Error("rollback cancel order failed", "job_id", job.ID, "error", err)
		}
	}

	// 5) vm row 标 error（保留行供 admin 调查；reverse-sync worker 后续可清理）
	if job.VMID != nil {
		if err := rt.deps.VMs.UpdateStatus(ctx, *job.VMID, model.VMStatusError); err != nil {
			slog.Error("rollback mark vm error failed", "job_id", job.ID, "vm_id", *job.VMID, "error", err)
		}
	}

	rt.takeParams(job.ID)
}

func (e *vmCreateExecutor) bestEffortDeleteInstance(ctx context.Context, client *cluster.Client, project, name string) error {
	stopCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// 先 force stop（已 stopped 不报错）
	stopBody, _ := json.Marshal(map[string]any{"action": "stop", "timeout": 10, "force": true})
	_, _ = client.APIPut(stopCtx, fmt.Sprintf("/1.0/instances/%s/state?project=%s", name, project), bytes.NewReader(stopBody))

	delResp, err := client.APIDelete(stopCtx, fmt.Sprintf("/1.0/instances/%s?project=%s", name, project))
	if err != nil {
		return err
	}
	if delResp != nil && delResp.Type == "async" {
		var op struct{ ID string }
		_ = json.Unmarshal(delResp.Metadata, &op)
		if op.ID != "" {
			_ = client.WaitForOperation(stopCtx, op.ID)
		}
	}
	return nil
}

// clusterName 反查 cluster_id → name。runtime 集中放这里供 executor 复用。
func (r *Runtime) clusterName(clusterID int64) string {
	if r.deps.Clusters == nil {
		return ""
	}
	return r.deps.Clusters.NameByID(clusterID)
}

// applyUserDefaultFirewallGroups 在 vm.create finalize 后串行 attach 用户的
// 默认 firewall_groups（PLAN-036 D3 软失败口径）。任一失败 log + audit，但
// 整体不阻塞——VM 已 active，用户事后可补绑。
func applyUserDefaultFirewallGroups(
	ctx context.Context,
	rt *Runtime,
	job *model.ProvisioningJob,
	clusterName, project, vmName string,
) {
	groups, err := rt.deps.Firewall.ListDefaultGroups(ctx, job.UserID)
	if err != nil {
		slog.Error("default firewall: list failed", "job_id", job.ID, "user_id", job.UserID, "error", err)
		rt.deps.Audit.Log(ctx, &job.UserID, "firewall.default_apply_failed", "vm", *job.VMID,
			map[string]any{"reason": "list_failed", "error": err.Error()}, "")
		return
	}
	if len(groups) == 0 {
		return
	}
	if clusterName == "" || vmName == "" {
		slog.Warn("default firewall: missing cluster/vm name", "job_id", job.ID)
		return
	}
	failed := []map[string]any{}
	ok := 0
	for i := range groups {
		g := &groups[i]
		if err := rt.deps.Firewall.Attach(ctx, clusterName, project, vmName, g); err != nil {
			failed = append(failed, map[string]any{"group_id": g.ID, "slug": g.Slug, "error": err.Error()})
			continue
		}
		if err := rt.deps.Firewall.Bind(ctx, *job.VMID, g.ID); err != nil {
			failed = append(failed, map[string]any{"group_id": g.ID, "slug": g.Slug, "error": "bind: " + err.Error()})
			continue
		}
		ok++
	}
	if len(failed) > 0 {
		slog.Warn("default firewall: partial apply", "vm_id", *job.VMID, "ok", ok, "failed", len(failed))
		rt.deps.Audit.Log(ctx, &job.UserID, "firewall.default_apply_failed", "vm", *job.VMID,
			map[string]any{"ok": ok, "failed_count": len(failed), "failed": failed}, "")
	} else {
		rt.deps.Audit.Log(ctx, &job.UserID, "firewall.default_apply_ok", "vm", *job.VMID,
			map[string]any{"group_count": ok}, "")
	}
}
