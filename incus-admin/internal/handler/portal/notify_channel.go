package portal

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/incuscloud/incus-admin/internal/repository"
	"github.com/incuscloud/incus-admin/internal/service/notify"
)

// NotifyChannelHandler 提供 admin-only 通道 CRUD + 测试发送（PLAN-041 / INFRA-009）。
//
// 设计：
//   - List 不返回解密 config（敏感）；
//   - GetWithConfig 仅在内部 Send/Test 路径用；
//   - 测试发送同步调 sender，立即把结果（成功/失败 + 报错）返给前端，方便配通道时立刻调试。

type NotifyChannelHandler struct {
	repo     *repository.NotifyChannelRepo
	registry *notify.Registry
}

func NewNotifyChannelHandler(repo *repository.NotifyChannelRepo, registry *notify.Registry) *NotifyChannelHandler {
	return &NotifyChannelHandler{repo: repo, registry: registry}
}

func (h *NotifyChannelHandler) AdminRoutes(r chi.Router) {
	r.Get("/notify-channels", h.List)
	r.Post("/notify-channels", h.Create)
	r.Put("/notify-channels/{id}", h.Update)
	r.Delete("/notify-channels/{id}", h.Delete)
	r.Post("/notify-channels/{id}/test", h.Test)
}

func (h *NotifyChannelHandler) List(w http.ResponseWriter, r *http.Request) {
	list, err := h.repo.List(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"channels": list})
}

type notifyChannelCreateReq struct {
	Name    string          `json:"name"   validate:"required,min=1,max=128"`
	Kind    string          `json:"kind"   validate:"required,oneof=dingtalk feishu wecom webhook smtp"`
	Config  json.RawMessage `json:"config" validate:"required"`
	Enabled *bool           `json:"enabled,omitempty"`
}

func (h *NotifyChannelHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req notifyChannelCreateReq
	if !decodeAndValidate(w, r, &req) {
		return
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	row, err := h.repo.Create(r.Context(), req.Name, req.Kind, req.Config, enabled)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "notify_channel.create", "notify_channel", row.ID, map[string]any{
		"name": row.Name, "kind": row.Kind,
	})
	writeJSON(w, http.StatusCreated, map[string]any{"channel": row})
}

type notifyChannelUpdateReq struct {
	Name    *string         `json:"name,omitempty"`
	Config  json.RawMessage `json:"config,omitempty"`
	Enabled *bool           `json:"enabled,omitempty"`
}

func (h *NotifyChannelHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	var req notifyChannelUpdateReq
	if !decodeAndValidate(w, r, &req) {
		return
	}
	if err := h.repo.Update(r.Context(), id, req.Name, req.Config, req.Enabled); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "notify_channel.update", "notify_channel", id, map[string]any{
		"id": id, "config_changed": req.Config != nil,
	})
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (h *NotifyChannelHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	if err := h.repo.Delete(r.Context(), id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "notify_channel.delete", "notify_channel", id, nil)
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
}

func (h *NotifyChannelHandler) Test(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	ch, err := h.repo.GetWithConfig(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if ch == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "channel not found"})
		return
	}
	sender, err := h.registry.Get(ch.Kind)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	ev := notify.AlertEvent{
		GroupKey: "test:" + ch.Name,
		Kind:     "test",
		Severity: "info",
		Phase:    "firing",
		Title:    "测试告警 from incus-admin",
		Message:  "这是一条来自 incus-admin 的测试通知。如果你看到这条消息，通道配置正常。\n\nTime: " + time.Now().Format(time.RFC3339),
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if err := sender.Send(ctx, ch.Config, ev); err != nil {
		audit(r.Context(), r, "notify_channel.test", "notify_channel", id, map[string]any{
			"result": "failed", "error": err.Error(),
		})
		writeJSON(w, http.StatusOK, map[string]any{"status": "failed", "error": err.Error()})
		return
	}
	audit(r.Context(), r, "notify_channel.test", "notify_channel", id, map[string]any{"result": "ok"})
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}
