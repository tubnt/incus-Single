package portal

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/incuscloud/incus-admin/internal/middleware"
	"github.com/incuscloud/incus-admin/internal/service"
)

type VMHandler struct {
	vmSvc *service.VMService
}

func NewVMHandler(vmSvc *service.VMService) *VMHandler {
	return &VMHandler{vmSvc: vmSvc}
}

func (h *VMHandler) Routes(r chi.Router) {
	r.Get("/services", h.ListServices)
	r.Get("/services/{id}", h.GetService)
	r.Post("/services/{id}/actions/{action}", h.VMAction)
}

func (h *VMHandler) ListServices(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)
	_ = userID
	// TODO: query DB for user's VMs, join with Incus state
	writeJSON(w, http.StatusOK, map[string]any{"services": []any{}})
}

func (h *VMHandler) GetService(w http.ResponseWriter, r *http.Request) {
	_ = chi.URLParam(r, "id")
	// TODO: query DB for VM, verify ownership, get Incus state
	writeJSON(w, http.StatusOK, map[string]any{"service": nil})
}

func (h *VMHandler) VMAction(w http.ResponseWriter, r *http.Request) {
	action := chi.URLParam(r, "action")
	_ = chi.URLParam(r, "id")

	switch action {
	case "start", "stop", "restart":
		// TODO: lookup VM from DB, verify ownership, call vmSvc.ChangeState
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "action": action})
	default:
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "unknown action"})
	}
}

type AdminVMHandler struct {
	vmSvc     *service.VMService
}

func NewAdminVMHandler(vmSvc *service.VMService) *AdminVMHandler {
	return &AdminVMHandler{vmSvc: vmSvc}
}

func (h *AdminVMHandler) Routes(r chi.Router) {
	r.Get("/clusters", h.ListClusters)
	r.Get("/clusters/{name}/nodes", h.ListNodes)
	r.Get("/vms", h.ListAllVMs)
	r.Put("/vms/{id}/state", h.ChangeVMState)
	r.Delete("/vms/{id}", h.DeleteVM)
}

func (h *AdminVMHandler) ListClusters(w http.ResponseWriter, r *http.Request) {
	// TODO: return cluster list from manager
	writeJSON(w, http.StatusOK, map[string]any{"clusters": []any{}})
}

func (h *AdminVMHandler) ListNodes(w http.ResponseWriter, r *http.Request) {
	_ = chi.URLParam(r, "name")
	// TODO: return nodes from scheduler cache
	writeJSON(w, http.StatusOK, map[string]any{"nodes": []any{}})
}

func (h *AdminVMHandler) ListAllVMs(w http.ResponseWriter, r *http.Request) {
	// TODO: query all VMs from DB
	writeJSON(w, http.StatusOK, map[string]any{"vms": []any{}})
}

func (h *AdminVMHandler) ChangeVMState(w http.ResponseWriter, r *http.Request) {
	_ = chi.URLParam(r, "id")
	var req struct {
		Action string `json:"action"`
		Force  bool   `json:"force"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid body"})
		return
	}
	slog.Info("admin vm state change", "action", req.Action)
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (h *AdminVMHandler) DeleteVM(w http.ResponseWriter, r *http.Request) {
	_ = chi.URLParam(r, "id")
	// TODO: lookup VM, call vmSvc.Delete, update DB
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
