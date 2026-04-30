package portal

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/incuscloud/incus-admin/internal/handler/batchutil"
	"github.com/incuscloud/incus-admin/internal/model"
	"github.com/incuscloud/incus-admin/internal/repository"
)

// PLAN-023 Phase B: Floating IP 批量操作端点 POST /api/admin/floating-ips:batch
//
// 请求：
//
//	{
//	  "ids":     [1, 2, 3],     // 必填，FIP 主键
//	  "action":  "release",      // release | detach
//	  "options": {}              // 预留
//	}
//
// 响应（batchutil.Response[int64]）：
//
//	{
//	  "total":     3,
//	  "succeeded": [1, 2],
//	  "failed":    [{"key": 3, "error": "still attached"}]
//	}
//
// step-up：路由整体走 step-up（middleware/stepup.go 中已注册 floating-ips:batch）。
//
// 审计：父事件 floating_ip.batch_<action>；子事件 floating_ip.<action> 每条单子操作发出。
//
// 注意：transfer（"把 IP 从 VM A 挪到 VM B"）当前没有单实体路由，且语义需要 (id, target_vm) 二元组，
//       不适合用统一 batch 通道。后续如需支持，新增 /admin/floating-ips:transfer 单独端点。

const (
	fipBatchActionRelease = "release"
	fipBatchActionDetach  = "detach"
)

var fipBatchAllowedActions = []string{fipBatchActionRelease, fipBatchActionDetach}

type batchFIPRequest struct {
	IDs     []int64        `json:"ids"`
	Action  string         `json:"action"`
	Options map[string]any `json:"options,omitempty"`
}

// BatchFloatingIPs 批量执行 FIP 动作。
func (h *FloatingIPHandler) BatchFloatingIPs(w http.ResponseWriter, r *http.Request) {
	var req batchFIPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json: " + err.Error()})
		return
	}
	if verr := batchutil.Validate(len(req.IDs), req.Action, fipBatchAllowedActions); verr != nil {
		writeJSON(w, verr.Status, verr.Body)
		return
	}

	resp := batchutil.New[int64]()
	resp.Total = len(req.IDs)

	for _, id := range req.IDs {
		if err := h.runFIPBatchOp(r, id, req.Action); err != nil {
			resp.Fail(id, err)
		} else {
			resp.OK(id)
		}
	}

	audit(r.Context(), r, "floating_ip.batch_"+req.Action, "floating_ip", 0, map[string]any{
		"requested_ids":   req.IDs,
		"succeeded_count": len(resp.Succeeded),
		"failed_count":    len(resp.Failed),
	})

	writeJSON(w, resp.Status(), resp)
}

// runFIPBatchOp 单条 FIP 动作。release 在仍 attached 时返回 409 语义的错误；
// 调用方可先批量 detach 再批量 release（两次请求）。
func (h *FloatingIPHandler) runFIPBatchOp(r *http.Request, id int64, action string) error {
	ctx := r.Context()

	fip, err := h.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if fip == nil {
		return errFIPNotFound
	}

	switch action {
	case fipBatchActionRelease:
		if err := h.repo.Release(ctx, id); err != nil {
			slog.Error("batch release failed", "fip_id", id, "ip", fip.IP, "error", err)
			return err
		}
		audit(ctx, r, "floating_ip.release", "floating_ip", id, map[string]any{
			"ip":     fip.IP,
			"source": "batch",
		})
		return nil

	case fipBatchActionDetach:
		// 已经 detach 的视为成功（幂等）。
		if fip.Status != repository.FloatingIPAttached || fip.BoundVMID == nil {
			audit(ctx, r, "floating_ip.detach", "floating_ip", id, map[string]any{
				"ip":     fip.IP,
				"source": "batch",
				"note":   "already_detached",
			})
			return nil
		}
		// 反查 VM 取 cluster/project，调 service 反向解绑。
		var vm *model.VM
		if h.vmRepo != nil {
			vm, _ = h.vmRepo.GetByID(ctx, *fip.BoundVMID)
		}
		if vm != nil {
			clusterName := findClusterName(h.clusters, vm.ClusterID)
			cc, _ := h.clusters.ConfigByName(clusterName)
			project := cc.DefaultProject
			if project == "" {
				project = "customers"
			}
			// 与单实体 detach 一致：吞掉 Incus 端错误，DB 状态以本地为准。
			_, _ = h.svc.DetachFromVM(ctx, clusterName, project, vm.Name, fip.IP)
		}
		if _, err := h.repo.Detach(ctx, id); err != nil {
			slog.Error("batch detach failed", "fip_id", id, "ip", fip.IP, "error", err)
			return err
		}
		audit(ctx, r, "floating_ip.detach", "floating_ip", id, map[string]any{
			"ip":      fip.IP,
			"vm_id":   fip.BoundVMID,
			"vm_name": vmNameOrEmpty(vm),
			"source":  "batch",
		})
		return nil
	}

	return errInvalidBatchAction
}

var errFIPNotFound = batchError("floating_ip not found")
