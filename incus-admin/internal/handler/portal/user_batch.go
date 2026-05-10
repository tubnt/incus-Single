package portal

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

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

const (
	userBatchActionChangeRole = "change_role"
	// Session-2 F-66 / PLAN-051 §2-D 决策 D-15 = A：原子批量充值。
	// 后端单 endpoint 串行执行，每条单 SQL 事务（TopUpWithDailyCap 内部已加锁）；
	// 前端 useBatchTopUpMutation 包装，invalidate 完成前禁用对话框。
	userBatchActionTopup = "topup"
)

var userBatchAllowedActions = []string{userBatchActionChangeRole, userBatchActionTopup}

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

	// 防自降级 / 防自充：识别当前 actor，禁止把自己包含在 change_role 或 topup 列表里。
	actorID, _ := r.Context().Value(middleware.CtxUserID).(int64)
	for _, id := range req.IDs {
		if id == actorID {
			writeJSON(w, http.StatusForbidden, map[string]any{
				"error":   "cannot batch " + req.Action + " on self",
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

	// topup 需要 options.amount > 0 且 ≤ MaxTopUpPerRequest
	var amount float64
	var description string
	if req.Action == userBatchActionTopup {
		// JSON 数字解析为 float64；options 校验上下限避免单笔越权
		if v, ok := req.Options["amount"].(float64); ok {
			amount = v
		}
		if amount <= 0 || amount > MaxTopUpPerRequest {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error":   "options.amount required (0, " + strconv.FormatFloat(MaxTopUpPerRequest, 'f', -1, 64) + "] for topup",
				"limit":   MaxTopUpPerRequest,
			})
			return
		}
		description, _ = req.Options["description"].(string)
		if description == "" {
			description = "Admin batch top-up"
		}
	}

	resp := batchutil.New[int64]()
	resp.Total = len(req.IDs)

	for _, id := range req.IDs {
		if err := h.runUserBatchOp(r, id, req.Action, role, amount, description); err != nil {
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
func (h *UserHandler) runUserBatchOp(r *http.Request, id int64, action, role string, amount float64, description string) error {
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
	case userBatchActionTopup:
		// 走与单条 TopUpBalance 同样的 daily cap + 内部事务路径
		used, _, ok, err := h.repo.TopUpWithDailyCap(
			ctx, id, amount, description, nil, topUpWindow, MaxTopUpPerDay,
		)
		if err != nil {
			slog.Error("batch topup failed", "user_id", id, "amount", amount, "error", err)
			return err
		}
		if !ok {
			return fmt.Errorf("daily quota exceeded: used=%.2f limit=%.2f", used, MaxTopUpPerDay)
		}
		audit(ctx, r, "user.topup", "user", id, map[string]any{
			"amount": amount,
			"source": "batch",
		})
		return nil
	}

	return errInvalidBatchAction
}
