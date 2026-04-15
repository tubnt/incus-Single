package portal

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/incuscloud/incus-admin/internal/cluster"
	"github.com/incuscloud/incus-admin/internal/config"
)

type ClusterMgmtHandler struct {
	mgr *cluster.Manager
}

func NewClusterMgmtHandler(mgr *cluster.Manager) *ClusterMgmtHandler {
	return &ClusterMgmtHandler{mgr: mgr}
}

func (h *ClusterMgmtHandler) AdminRoutes(r chi.Router) {
	r.Post("/clusters/add", h.AddCluster)
	r.Delete("/clusters/{name}/remove", h.RemoveCluster)
}

func (h *ClusterMgmtHandler) AddCluster(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string `json:"name"`
		DisplayName string `json:"display_name"`
		APIURL      string `json:"api_url"`
		CertFile    string `json:"cert_file"`
		KeyFile     string `json:"key_file"`
		CAFile      string `json:"ca_file"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid body"})
		return
	}
	if req.Name == "" || req.APIURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "name and api_url required"})
		return
	}

	cc := config.ClusterConfig{
		Name:        req.Name,
		DisplayName: req.DisplayName,
		APIURL:      req.APIURL,
		CertFile:    req.CertFile,
		KeyFile:     req.KeyFile,
		CAFile:      req.CAFile,
	}

	if err := h.mgr.AddCluster(cc); err != nil {
		slog.Error("add cluster failed", "name", req.Name, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	audit(r.Context(), r, "cluster.add", "cluster", 0, map[string]any{"name": req.Name, "url": req.APIURL})
	slog.Info("cluster added", "name", req.Name, "url", req.APIURL)
	writeJSON(w, http.StatusCreated, map[string]any{"status": "added", "name": req.Name})
}

func (h *ClusterMgmtHandler) RemoveCluster(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	if err := h.mgr.RemoveCluster(name); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}

	audit(r.Context(), r, "cluster.remove", "cluster", 0, map[string]any{"name": name})
	slog.Info("cluster removed", "name", name)
	writeJSON(w, http.StatusOK, map[string]any{"status": "removed", "name": name})
}
