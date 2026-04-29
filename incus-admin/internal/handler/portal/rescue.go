package portal

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/incuscloud/incus-admin/internal/cluster"
	"github.com/incuscloud/incus-admin/internal/middleware"
	"github.com/incuscloud/incus-admin/internal/model"
	"github.com/incuscloud/incus-admin/internal/repository"
	"github.com/incuscloud/incus-admin/internal/service"
)

// RescueHandler drives PLAN-021 Phase D safe-mode. The state machine is
// simple: normal → rescue (enter takes a snapshot + stops the VM) → normal
// (exit optionally restores the snapshot + starts the VM). No device swap,
// no bootloader changes — the risk surface is the snapshot + stop/start
// actions which are well-proven through existing handlers.
type RescueHandler struct {
	repo     *repository.VMRepo
	svc      *service.RescueService
	clusters *cluster.Manager
}

func NewRescueHandler(repo *repository.VMRepo, svc *service.RescueService, clusters *cluster.Manager) *RescueHandler {
	return &RescueHandler{repo: repo, svc: svc, clusters: clusters}
}

func (h *RescueHandler) AdminRoutes(r chi.Router) {
	// Support both id-keyed (stable, matches portal/api contract for
	// ownership checks) and name-keyed (matches the existing Incus-centric
	// admin endpoints like reinstall / migrate / evacuate). The handler
	// logic is identical after the initial lookup.
	r.Post("/vms/{id}/rescue/enter", h.Enter)
	r.Post("/vms/{id}/rescue/exit", h.Exit)
	r.Post("/vms/by-name/{name}/rescue/enter", h.EnterByName)
	r.Post("/vms/by-name/{name}/rescue/exit", h.ExitByName)
}

// PortalRoutes exposes rescue mode to end users on their own VMs. The
// ownership check lives here (not in service) to stay consistent with the
// other portal handlers (VMHandler.Reinstall / ResetPassword).
func (h *RescueHandler) PortalRoutes(r chi.Router) {
	r.Post("/services/{id}/rescue/enter", h.PortalEnter)
	r.Post("/services/{id}/rescue/exit", h.PortalExit)
}

func (h *RescueHandler) PortalEnter(w http.ResponseWriter, r *http.Request) {
	vm := h.vmForPortal(w, r)
	if vm == nil {
		return
	}
	if h.doEnter(w, r, vm) {
		audit(r.Context(), r, "vm.rescue.enter", "vm", vm.ID, map[string]any{"via": "portal", "name": vm.Name})
	}
}

func (h *RescueHandler) PortalExit(w http.ResponseWriter, r *http.Request) {
	vm := h.vmForPortal(w, r)
	if vm == nil {
		return
	}
	if h.doExit(w, r, vm) {
		audit(r.Context(), r, "vm.rescue.exit", "vm", vm.ID, map[string]any{"via": "portal", "name": vm.Name})
	}
}

// vmForPortal looks up the VM by id and returns it only if the requesting
// user owns it. 403 on mismatch / 404 on missing — same shape as the other
// portal vm actions (VMHandler.Reinstall / ResetPassword).
func (h *RescueHandler) vmForPortal(w http.ResponseWriter, r *http.Request) *model.VM {
	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return nil
	}
	vm, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return nil
	}
	if vm == nil || vm.UserID != userID {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "access denied"})
		return nil
	}
	return vm
}

func (h *RescueHandler) EnterByName(w http.ResponseWriter, r *http.Request) {
	vm := h.vmByName(w, r)
	if vm == nil {
		return
	}
	if h.doEnter(w, r, vm) {
		audit(r.Context(), r, "vm.rescue.enter", "vm", vm.ID, map[string]any{"via": "admin-by-name", "name": vm.Name})
	}
}

func (h *RescueHandler) ExitByName(w http.ResponseWriter, r *http.Request) {
	vm := h.vmByName(w, r)
	if vm == nil {
		return
	}
	if h.doExit(w, r, vm) {
		audit(r.Context(), r, "vm.rescue.exit", "vm", vm.ID, map[string]any{"via": "admin-by-name", "name": vm.Name})
	}
}

func (h *RescueHandler) vmByName(w http.ResponseWriter, r *http.Request) *model.VM {
	name := chi.URLParam(r, "name")
	if !isValidName(name) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid vm name"})
		return nil
	}
	vm, err := h.repo.GetByName(r.Context(), name)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return nil
	}
	if vm == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "vm not found"})
		return nil
	}
	return vm
}

func (h *RescueHandler) Enter(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	vm, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if vm == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "vm not found"})
		return
	}
	if h.doEnter(w, r, vm) {
		audit(r.Context(), r, "vm.rescue.enter", "vm", vm.ID, map[string]any{"via": "admin-by-id", "name": vm.Name})
	}
}

// doEnter performs the rescue-enter state machine + writes the success or
// failure response. Returns true on success so the caller can audit at the
// entry-point level (preserves "via" context: admin-by-id / by-name / portal).
func (h *RescueHandler) doEnter(w http.ResponseWriter, r *http.Request, vm *model.VM) bool {
	id := vm.ID
	if vm.RescueState != "normal" {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "vm is already in rescue mode"})
		return false
	}

	clusterName, project := h.resolveVM(vm)
	snapshotName, err := h.svc.EnterRescue(r.Context(), clusterName, project, vm.Name)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return false
	}

	if ok, dbErr := h.repo.SetRescueState(r.Context(), id, snapshotName); dbErr != nil || !ok {
		// Incus side already has a snapshot and the VM is stopped, but the
		// DB didn't transition (race or constraint failure). Surface both
		// so the admin knows to reconcile.
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error":    "db state update failed; manually clear rescue_state or retry exit",
			"snapshot": snapshotName,
			"db_err":   dbErrOrRace(dbErr),
		})
		return false
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "entered_rescue",
		"vm_id":    id,
		"vm_name":  vm.Name,
		"snapshot": snapshotName,
		"note":     "VM is stopped with a rescue snapshot. Exit with restore=true to roll back, or restore=false to resume.",
	})
	return true
}

type exitRescueReq struct {
	// Restore, when true, applies the rescue snapshot before restarting;
	// the VM resumes from the pre-rescue state. false simply starts the VM
	// as it was when the admin last left it in rescue.
	Restore bool `json:"restore"`

	// DeleteSnapshot, when true, removes the rescue snapshot after a
	// successful exit. Defaults false so the admin still has an escape
	// hatch if something blows up on boot.
	DeleteSnapshot bool `json:"delete_snapshot"`
}

func (h *RescueHandler) Exit(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	vm, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if vm == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "vm not found"})
		return
	}
	if h.doExit(w, r, vm) {
		audit(r.Context(), r, "vm.rescue.exit", "vm", vm.ID, map[string]any{"via": "admin-by-id", "name": vm.Name})
	}
}

// doExit performs the rescue-exit state machine. Returns true on success so
// the caller (entry-point handler) can audit with its own "via" context.
func (h *RescueHandler) doExit(w http.ResponseWriter, r *http.Request, vm *model.VM) bool {
	id := vm.ID
	if vm.RescueState != "rescue" {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "vm is not in rescue mode"})
		return false
	}

	var req exitRescueReq
	if !decodeAndValidate(w, r, &req) {
		return false
	}

	clusterName, project := h.resolveVM(vm)
	snapshotName := ""
	if vm.RescueSnapshotName != nil {
		snapshotName = *vm.RescueSnapshotName
	}

	if err := h.svc.ExitRescue(r.Context(), clusterName, project, vm.Name, snapshotName, req.Restore); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return false
	}
	if _, err := h.repo.ClearRescueState(r.Context(), id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return false
	}

	deleted := false
	if req.DeleteSnapshot && snapshotName != "" {
		if err := h.svc.DeleteRescueSnapshot(r.Context(), clusterName, project, vm.Name, snapshotName); err == nil {
			deleted = true
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":           "exited_rescue",
		"vm_id":            id,
		"vm_name":          vm.Name,
		"restored":         req.Restore,
		"snapshot_deleted": deleted,
	})
	return true
}

func (h *RescueHandler) resolveVM(vm *model.VM) (clusterName, project string) {
	clusterName = findClusterName(h.clusters, vm.ClusterID)
	cc, _ := h.clusters.ConfigByName(clusterName)
	project = cc.DefaultProject
	if project == "" {
		project = "customers"
	}
	return
}

func dbErrOrRace(err error) string {
	if err == nil {
		return "race: rescue_state transitioned concurrently"
	}
	return err.Error()
}
