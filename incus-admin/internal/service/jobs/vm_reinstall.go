package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"

	"github.com/incuscloud/incus-admin/internal/model"
	"github.com/incuscloud/incus-admin/internal/service"
)

// vmReinstallExecutor 执行一次 vm.reinstall 的步骤。前置假设（handler 已同步）：
//   - probe + prePullImage 通过 —— 镜像服务可达且镜像已落本地缓存
//     （这一步必须保留 sync 在 handler 里以保护用户原有 VM 数据）
type vmReinstallExecutor struct{}

const (
	stepFetchInstance = "fetch_instance"
	stepStop          = "stop"
	stepDelete        = "delete"
	stepRecreate      = "recreate"
	stepWaitRecreate  = "wait_recreate"
	stepStartReinstall = "start_after_reinstall"
)

func (e *vmReinstallExecutor) Run(ctx context.Context, rt *Runtime, job *model.ProvisioningJob) error {
	params := rt.peekParams(job.ID)
	if params == nil {
		return fmt.Errorf("params missing for job %d", job.ID)
	}

	clusterName := rt.clusterName(job.ClusterID)
	client, ok := rt.deps.Clusters.Get(clusterName)
	if !ok {
		return fmt.Errorf("cluster %q not registered", clusterName)
	}

	// step 0: 拉原 instance config（保留 devices 配置，避免重装后 IP / 磁盘消失）
	rt.step(ctx, job.ID, 0, stepFetchInstance, model.StepStatusRunning, "读取原实例配置")
	instData, err := client.GetInstance(ctx, params.Project, job.TargetName)
	if err != nil {
		rt.finishStep(ctx, job.ID, 0, stepFetchInstance, model.StepStatusFailed, err.Error())
		return fmt.Errorf("get instance: %w", err)
	}
	var inst struct {
		Config   map[string]string         `json:"config"`
		Devices  map[string]map[string]any `json:"devices"`
		Location string                    `json:"location"`
	}
	if err := json.Unmarshal(instData, &inst); err != nil {
		rt.finishStep(ctx, job.ID, 0, stepFetchInstance, model.StepStatusFailed, err.Error())
		return fmt.Errorf("parse instance: %w", err)
	}
	rt.finishStep(ctx, job.ID, 0, stepFetchInstance, model.StepStatusSucceeded, "")

	// step 1: stop（best-effort，已 stopped 不报错）
	rt.step(ctx, job.ID, 1, stepStop, model.StepStatusRunning, "停止当前实例")
	stopBody, _ := json.Marshal(map[string]any{"action": "stop", "timeout": 30, "force": true})
	if _, err := client.APIPut(ctx, fmt.Sprintf("/1.0/instances/%s/state?project=%s", job.TargetName, params.Project), bytes.NewReader(stopBody)); err != nil {
		// 已 stop / 不存在 → 继续；详细原因写到 step detail
		rt.finishStep(ctx, job.ID, 1, stepStop, model.StepStatusSkipped, err.Error())
	} else {
		rt.finishStep(ctx, job.ID, 1, stepStop, model.StepStatusSucceeded, "")
	}

	// step 2: delete + 等删完
	rt.step(ctx, job.ID, 2, stepDelete, model.StepStatusRunning, "删除原实例")
	delResp, err := client.APIDelete(ctx, fmt.Sprintf("/1.0/instances/%s?project=%s", job.TargetName, params.Project))
	if err != nil {
		rt.finishStep(ctx, job.ID, 2, stepDelete, model.StepStatusFailed, err.Error())
		return fmt.Errorf("delete instance: %w", err)
	}
	if delResp != nil && delResp.Type == "async" {
		var op struct{ ID string }
		_ = json.Unmarshal(delResp.Metadata, &op)
		if op.ID != "" {
			if werr := client.WaitForOperation(ctx, op.ID); werr != nil {
				rt.finishStep(ctx, job.ID, 2, stepDelete, model.StepStatusFailed, werr.Error())
				return fmt.Errorf("wait delete: %w", werr)
			}
		}
	}
	rt.finishStep(ctx, job.ID, 2, stepDelete, model.StepStatusSucceeded, "")

	// step 3: recreate（生成新密码 / cloud-init）
	password := service.GeneratePassword()
	cloudInit := service.BuildCloudInit(password, nil)
	service.StripVolatileConfig(inst.Config)
	inst.Config["user.cloud-init"] = cloudInit

	body := map[string]any{
		"name": job.TargetName,
		"type": "virtual-machine",
		"source": map[string]any{
			"type":     "image",
			"alias":    params.ImageSource,
			"server":   params.ServerURL,
			"protocol": params.Protocol,
		},
		"config":  inst.Config,
		"devices": inst.Devices,
	}
	bodyJSON, _ := json.Marshal(body)

	rt.step(ctx, job.ID, 3, stepRecreate, model.StepStatusRunning, "重建实例")
	createPath := fmt.Sprintf("/1.0/instances?project=%s&target=%s", params.Project, inst.Location)
	resp, err := client.APIPost(ctx, createPath, bytes.NewReader(bodyJSON))
	if err != nil {
		rt.finishStep(ctx, job.ID, 3, stepRecreate, model.StepStatusFailed, err.Error())
		return fmt.Errorf("recreate: %w", err)
	}
	rt.finishStep(ctx, job.ID, 3, stepRecreate, model.StepStatusSucceeded, "")

	if resp.Type == "async" {
		var op struct{ ID string }
		_ = json.Unmarshal(resp.Metadata, &op)
		if op.ID != "" {
			rt.step(ctx, job.ID, 4, stepWaitRecreate, model.StepStatusRunning, "等待镜像与磁盘就绪")
			if werr := client.WaitForOperation(ctx, op.ID); werr != nil {
				rt.finishStep(ctx, job.ID, 4, stepWaitRecreate, model.StepStatusFailed, werr.Error())
				return fmt.Errorf("wait recreate: %w", werr)
			}
			rt.finishStep(ctx, job.ID, 4, stepWaitRecreate, model.StepStatusSucceeded, "")
		}
	}

	// step 5: start
	rt.step(ctx, job.ID, 5, stepStartReinstall, model.StepStatusRunning, "启动新实例")
	startBody, _ := json.Marshal(map[string]any{"action": "start", "timeout": 60})
	startResp, err := client.APIPut(ctx, fmt.Sprintf("/1.0/instances/%s/state?project=%s", job.TargetName, params.Project), bytes.NewReader(startBody))
	if err != nil {
		rt.finishStep(ctx, job.ID, 5, stepStartReinstall, model.StepStatusFailed, err.Error())
		return fmt.Errorf("start after reinstall: %w", err)
	}
	if startResp.Type == "async" {
		var op struct{ ID string }
		_ = json.Unmarshal(startResp.Metadata, &op)
		if op.ID != "" {
			if werr := client.WaitForOperation(ctx, op.ID); werr != nil {
				rt.finishStep(ctx, job.ID, 5, stepStartReinstall, model.StepStatusFailed, werr.Error())
				return fmt.Errorf("wait start after reinstall: %w", werr)
			}
		}
	}
	rt.finishStep(ctx, job.ID, 5, stepStartReinstall, model.StepStatusSucceeded, "")

	// 写新密码（reinstall 用户最关心的产物）
	if job.VMID != nil {
		_ = rt.deps.VMs.UpdatePassword(ctx, *job.VMID, password)
	}

	rt.takeParams(job.ID)
	return nil
}

// Reinstall 失败的 rollback 比 vm.create 弱：原 VM 已经被删除，无法"恢复"。
// 我们能做的：vm row 标 error，让用户走客服 / admin 介入。不退款（reinstall 不走订单）。
//
// OPS-008/012/016 数据保护已经把"上游挂掉但没拉到镜像"挡在 handler 同步阶段了，
// 走到这里失败的概率应该很低；真发生时是 VM 状态破坏，DB 标 error 配合 audit。
func (e *vmReinstallExecutor) Rollback(ctx context.Context, rt *Runtime, job *model.ProvisioningJob, reason string) {
	if job.VMID != nil {
		_ = rt.deps.VMs.UpdateStatus(ctx, *job.VMID, model.VMStatusError)
	}
	rt.takeParams(job.ID)
}
