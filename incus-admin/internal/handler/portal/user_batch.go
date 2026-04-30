package portal

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/incuscloud/incus-admin/internal/handler/batchutil"
	"github.com/incuscloud/incus-admin/internal/middleware"
)

// PLAN-023 Phase C: User 批量操作端点 POST /api/admin/users:batch
//
// 当前 User 模型仅支持 role 字段做角色变更（无 enabled / disabled 字段；删用户走单实体软删）。
// 因此当前 batch 仅暴露 change_role；扩展时只需在 allowedActions 加 case + opts 解析。
//
// 请求：
//
//	{
//	  "ids":     [1, 2, 3],          // 必填，user 主键
//	  "action":  "change_role",       // change_role
//	  "options": { "role": "admin" }  // change_role 必填
//	}
//
// 响应（batchutil.Response[int64]）。
//
// step-up：路由整体走 step-up（middleware/stepup.go 中已注册 users:batch）。
//
// 审计：父事件 user.batch_<action>；子事件 user.<action> 每条单子操作发出。

const userBatchActionChangeRole = "change_role"

var userBatchAllowedActions = []string{userBatchActionChangeRole}

type batchUserRequest struct {
	IDs     []int64        `json:"ids"`
	Action  string         `json:"action"`
	Options map[string]any `json:"options,omitempty"`
}

// BatchUsers 批量执行用户动作。
func (h *UserHandler) BatchUsers(w http.ResponseWriter, r *http.Request) {
	var req batchUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json: " + err.Error()})
		return
	}
	if verr := batchutil.Validate(len(req.IDs), req.Action, userBatchAllowedActions); verr != nil {
		writeJSON(w, verr.Status, verr.Body)
		return
	}

	// 防自降级：识别当前 actor，禁止把自己包含在 change_role admin→customer 列表里。
	actorID, _ := r.Context().Value(middleware.CtxUserID).(int64)
	for _, id := range req.IDs {
		if id == actorID {
			writeJSON(w, http.StatusForbidden, map[string]any{
				"error":   "cannot batch change_role on self",
				"user_id": id,
			})
			return
		}
	}

	// change_role 需要在 options.role 里指定目标角色
	role, _ := req.Options["role"].(string)
	if req.Action == userBatchActionChangeRole {
		if role != "admin" && role != "customer" {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error":   "options.role required for change_role",
				"allowed": []string{"admin", "customer"},
			})
			return
		}
	}

	resp := batchutil.New[int64]()
	resp.Total = len(req.IDs)

	for _, id := range req.IDs {
		if err := h.runUserBatchOp(r, id, req.Action, role); err != nil {
			resp.Fail(id, err)
		} else {
			resp.OK(id)
		}
	}

	audit(r.Context(), r, "user.batch_"+req.Action, "user", 0, map[string]any{
		"requested_ids":   req.IDs,
		"options":         req.Options,
		"succeeded_count": len(resp.Succeeded),
		"failed_count":    len(resp.Failed),
	})

	writeJSON(w, resp.Status(), resp)
}

// runUserBatchOp 单条用户动作。
func (h *UserHandler) runUserBatchOp(r *http.Request, id int64, action, role string) error {
	ctx := r.Context()

	switch action {
	case userBatchActionChangeRole:
		if err := h.repo.UpdateRole(ctx, id, role); err != nil {
			slog.Error("batch update role failed", "user_id", id, "role", role, "error", err)
			return err
		}
		audit(ctx, r, "user.update_role", "user", id, map[string]any{
			"role":   role,
			"source": "batch",
		})
		return nil
	}

	return errInvalidBatchAction
}
