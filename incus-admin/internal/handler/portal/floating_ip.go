package portal

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/incuscloud/incus-admin/internal/cluster"
	"github.com/incuscloud/incus-admin/internal/model"
	"github.com/incuscloud/incus-admin/internal/repository"
	"github.com/incuscloud/incus-admin/internal/service"
)

type FloatingIPHandler struct {
	repo        *repository.FloatingIPRepo
	svc         *service.FloatingIPService
	vmRepo      *repository.VMRepo
	clusterRepo *repository.ClusterRepo
	clusters    *cluster.Manager
}

func NewFloatingIPHandler(repo *repository.FloatingIPRepo, svc *service.FloatingIPService, vmRepo *repository.VMRepo, clusterRepo *repository.ClusterRepo, clusters *cluster.Manager) *FloatingIPHandler {
	return &FloatingIPHandler{repo: repo, svc: svc, vmRepo: vmRepo, clusterRepo: clusterRepo, clusters: clusters}
}

// lookupClusterID resolves a cluster *name* to its DB id. Callers take the
// name from the frontend (which doesn't expose internal ids); this keeps the
// wire format stable even if rows are re-inserted.
func (h *FloatingIPHandler) lookupClusterID(ctx context.Context, name string) (int64, error) {
	cl, err := h.clusterRepo.GetByName(ctx, name)
	if err != nil {
		return 0, err
	}
	if cl == nil {
		return 0, fmt.Errorf("cluster %q not found", name)
	}
	return cl.ID, nil
}

func (h *FloatingIPHandler) AdminRoutes(r chi.Router) {
	r.Get("/floating-ips", h.List)
	r.Post("/floating-ips", h.Allocate)
	r.Delete("/floating-ips/{id}", h.Release)
	r.Post("/floating-ips/{id}/attach", h.Attach)
	r.Post("/floating-ips/{id}/detach", h.Detach)
}

func (h *FloatingIPHandler) List(w http.ResponseWriter, r *http.Request) {
	ips, err := h.repo.List(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"floating_ips": ips})
}

type allocateFloatingIPReq struct {
	// Cluster accepts the cluster *name* (frontend doesn't see DB IDs).
	// Back-compat: callers that send cluster_id still work.
	Cluster     string `json:"cluster"     validate:"omitempty,safename"`
	ClusterID   int64  `json:"cluster_id"  validate:"omitempty,gt=0"`
	IP          string `json:"ip"          validate:"required,ip"`
	Description string `json:"description" validate:"omitempty,max=256"`
}

func (h *FloatingIPHandler) Allocate(w http.ResponseWriter, r *http.Request) {
	var req allocateFloatingIPReq
	if !decodeAndValidate(w, r, &req) {
		return
	}

	clusterID := req.ClusterID
	if clusterID == 0 {
		if req.Cluster == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "cluster or cluster_id required"})
			return
		}
		id, err := h.lookupClusterID(r.Context(), req.Cluster)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
			return
		}
		clusterID = id
	}

	created, err := h.repo.Allocate(r.Context(), clusterID, req.IP, req.Description)
	if err != nil {
		if errors.Is(err, repository.ErrIPAlreadyAllocated) {
			writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "floating_ip.allocate", "floating_ip", created.ID, map[string]any{
		"ip":         created.IP,
		"cluster_id": created.ClusterID,
	})
	writeJSON(w, http.StatusCreated, map[string]any{"floating_ip": created})
}

func (h *FloatingIPHandler) Release(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	existing, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if existing == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "floating_ip not found"})
		return
	}
	if err := h.repo.Release(r.Context(), id); err != nil {
		// Repo surfaces an error when the row is still attached; reflect as 409.
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "floating_ip.release", "floating_ip", id, map[string]any{"ip": existing.IP})
	writeJSON(w, http.StatusOK, map[string]any{"released": id, "ip": existing.IP})
}

type attachFloatingIPReq struct {
	VMID int64 `json:"vm_id" validate:"required,gt=0"`
}

func (h *FloatingIPHandler) Attach(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	var req attachFloatingIPReq
	if !decodeAndValidate(w, r, &req) {
		return
	}
	fip, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if fip == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "floating_ip not found"})
		return
	}
	if fip.Status != repository.FloatingIPAvailable {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "floating_ip already attached; detach first"})
		return
	}

	vm, err := h.vmRepo.GetByID(r.Context(), req.VMID)
	if err != nil || vm == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "vm not found"})
		return
	}
	clusterName := findClusterName(h.clusters, vm.ClusterID)
	cc, _ := h.clusters.ConfigByName(clusterName)
	project := cc.DefaultProject
	if project == "" {
		project = "customers"
	}

	// Atomic DB update first — if someone else raced us the row will no
	// longer be 'available' and the Incus mutation never happens.
	ok, err := h.repo.Attach(r.Context(), id, req.VMID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if !ok {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "race: floating_ip state changed"})
		return
	}

	hint, attachErr := h.svc.AttachToVM(r.Context(), clusterName, project, vm.Name, fip.IP)
	if attachErr != nil {
		// Best-effort rollback: undo the DB attach so we don't lie about state.
		if _, rollbackErr := h.repo.Detach(r.Context(), id); rollbackErr != nil {
			// Rollback failed — surface both in the response so the admin
			// has enough context to reconcile by hand.
			writeJSON(w, http.StatusInternalServerError, map[string]any{
				"error":       attachErr.Error(),
				"rollback_err": rollbackErr.Error(),
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": attachErr.Error()})
		return
	}

	audit(r.Context(), r, "floating_ip.attach", "floating_ip", id, map[string]any{
		"ip":      fip.IP,
		"vm_id":   req.VMID,
		"vm_name": vm.Name,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"status":        "attached",
		"ip":            fip.IP,
		"vm_id":         req.VMID,
		"vm_name":       vm.Name,
		"runbook_hint":  hint,
		"runbook_note":  "Run this inside the VM so the guest OS serves the floating IP.",
	})
}

func (h *FloatingIPHandler) Detach(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	fip, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if fip == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "floating_ip not found"})
		return
	}
	if fip.Status != repository.FloatingIPAttached || fip.BoundVMID == nil {
		// Idempotent: detaching an already-detached IP returns success so
		// retries don't error.
		writeJSON(w, http.StatusOK, map[string]any{"status": "already_detached", "id": id})
		return
	}

	vm, err := h.vmRepo.GetByID(r.Context(), *fip.BoundVMID)
	var hint string
	if err == nil && vm != nil {
		clusterName := findClusterName(h.clusters, vm.ClusterID)
		cc, _ := h.clusters.ConfigByName(clusterName)
		project := cc.DefaultProject
		if project == "" {
			project = "customers"
		}
		hint, _ = h.svc.DetachFromVM(r.Context(), clusterName, project, vm.Name, fip.IP)
		// Swallow detach errors from Incus — the DB transition is what users
		// see. If the VM was already deleted the Incus call would fail
		// benignly.
	}

	if _, err := h.repo.Detach(r.Context(), id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "floating_ip.detach", "floating_ip", id, map[string]any{
		"ip":      fip.IP,
		"vm_id":   fip.BoundVMID,
		"vm_name": vmNameOrEmpty(vm),
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"status":       "detached",
		"id":           id,
		"ip":           fip.IP,
		"runbook_hint": hint,
	})
}

func vmNameOrEmpty(vm *model.VM) string {
	if vm == nil {
		return ""
	}
	return vm.Name
}
