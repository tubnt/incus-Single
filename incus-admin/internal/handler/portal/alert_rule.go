package portal

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/incuscloud/incus-admin/internal/repository"
)

// AlertRuleHandler admin-only 阈值规则 CRUD + 启停 + 历史送达（PLAN-041 / INFRA-009）。
//
// 内置规则（builtin=TRUE，如 imbalance）允许编辑 channel_ids / threshold / enabled，
// 但不允许删 + 不允许改 kind/scope（repo 层守护）。

type AlertRuleHandler struct {
	repo       *repository.AlertRuleRepo
	deliveries *repository.AlertDeliveryRepo
}

func NewAlertRuleHandler(repo *repository.AlertRuleRepo, deliveries *repository.AlertDeliveryRepo) *AlertRuleHandler {
	return &AlertRuleHandler{repo: repo, deliveries: deliveries}
}

func (h *AlertRuleHandler) AdminRoutes(r chi.Router) {
	r.Get("/alert-rules", h.List)
	r.Post("/alert-rules", h.Create)
	r.Get("/alert-rules/{id}", h.Get)
	r.Put("/alert-rules/{id}", h.Update)
	r.Delete("/alert-rules/{id}", h.Delete)
	r.Patch("/alert-rules/{id}/enabled", h.SetEnabled)
	r.Put("/alert-rules/{id}/enabled", h.SetEnabled) // 前端 http client 无 PATCH，用 PUT 兼容
	r.Get("/alert-rules/{id}/deliveries", h.ListDeliveries)
}

func (h *AlertRuleHandler) List(w http.ResponseWriter, r *http.Request) {
	rules, err := h.repo.List(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rules": rules})
}

type alertRuleCreateReq struct {
	Name          string   `json:"name"           validate:"required,min=1,max=128"`
	Kind          string   `json:"kind"           validate:"required,oneof=imbalance vm_cpu vm_mem vm_disk vm_down cluster_node_offline order_failed job_failed balance_low backup_failed"`
	ScopeKind     string   `json:"scope_kind"     validate:"required,oneof=global cluster vm user"`
	ScopeID       *int64   `json:"scope_id,omitempty"`
	Threshold     *float64 `json:"threshold,omitempty"`
	WindowSeconds int      `json:"window_seconds" validate:"min=30,max=86400"`
	Severity      string   `json:"severity"       validate:"required,oneof=info warning error critical"`
	ChannelIDs    []int64  `json:"channel_ids"`
	Enabled       *bool    `json:"enabled,omitempty"`
}

func (h *AlertRuleHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req alertRuleCreateReq
	if !decodeAndValidate(w, r, &req) {
		return
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	rule := &repository.AlertRule{
		Name:          req.Name,
		Kind:          req.Kind,
		ScopeKind:     req.ScopeKind,
		ScopeID:       req.ScopeID,
		Threshold:     req.Threshold,
		WindowSeconds: req.WindowSeconds,
		Severity:      req.Severity,
		ChannelIDs:    req.ChannelIDs,
		Enabled:       enabled,
		Builtin:       false,
	}
	id, err := h.repo.Create(r.Context(), rule)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "alert_rule.create", "alert_rule", id, map[string]any{
		"name": rule.Name, "kind": rule.Kind, "severity": rule.Severity,
	})
	writeJSON(w, http.StatusCreated, map[string]any{"id": id})
}

func (h *AlertRuleHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	rule, err := h.repo.Get(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rule": rule})
}

type alertRuleUpdateReq struct {
	Name          string   `json:"name"           validate:"required,min=1,max=128"`
	Threshold     *float64 `json:"threshold,omitempty"`
	WindowSeconds int      `json:"window_seconds" validate:"min=30,max=86400"`
	Severity      string   `json:"severity"       validate:"required,oneof=info warning error critical"`
	ChannelIDs    []int64  `json:"channel_ids"`
	Enabled       bool     `json:"enabled"`
}

func (h *AlertRuleHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	var req alertRuleUpdateReq
	if !decodeAndValidate(w, r, &req) {
		return
	}
	rule := &repository.AlertRule{
		ID:            id,
		Name:          req.Name,
		Threshold:     req.Threshold,
		WindowSeconds: req.WindowSeconds,
		Severity:      req.Severity,
		ChannelIDs:    req.ChannelIDs,
		Enabled:       req.Enabled,
	}
	if err := h.repo.Update(r.Context(), rule); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "alert_rule.update", "alert_rule", id, map[string]any{
		"name": rule.Name, "enabled": rule.Enabled,
	})
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (h *AlertRuleHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	if err := h.repo.Delete(r.Context(), id); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "alert_rule.delete", "alert_rule", id, nil)
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
}

type alertRuleEnabledReq struct {
	Enabled bool `json:"enabled"`
}

func (h *AlertRuleHandler) SetEnabled(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	var req alertRuleEnabledReq
	if !decodeAndValidate(w, r, &req) {
		return
	}
	if err := h.repo.SetEnabled(r.Context(), id, req.Enabled); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "alert_rule.set_enabled", "alert_rule", id, map[string]any{"enabled": req.Enabled})
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (h *AlertRuleHandler) ListDeliveries(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	rows, err := h.deliveries.ListByRule(r.Context(), id, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deliveries": rows})
}
