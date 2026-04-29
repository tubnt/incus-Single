package portal

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/incuscloud/incus-admin/internal/model"
	"github.com/incuscloud/incus-admin/internal/repository"
)

type OSTemplateHandler struct {
	repo *repository.OSTemplateRepo
}

func NewOSTemplateHandler(repo *repository.OSTemplateRepo) *OSTemplateHandler {
	return &OSTemplateHandler{repo: repo}
}

func (h *OSTemplateHandler) PortalRoutes(r chi.Router) {
	r.Get("/os-templates", h.ListEnabled)
}

func (h *OSTemplateHandler) AdminRoutes(r chi.Router) {
	r.Get("/os-templates", h.ListAll)
	r.Get("/os-templates/{id}", h.GetByID)
	r.Post("/os-templates", h.Create)
	r.Put("/os-templates/{id}", h.Update)
	r.Delete("/os-templates/{id}", h.Delete)
}

func (h *OSTemplateHandler) ListEnabled(w http.ResponseWriter, r *http.Request) {
	templates, err := h.repo.ListEnabled(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to list templates"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"templates": templates})
}

func (h *OSTemplateHandler) ListAll(w http.ResponseWriter, r *http.Request) {
	templates, err := h.repo.ListAll(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to list templates"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"templates": templates})
}

func (h *OSTemplateHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	t, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if t == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "template not found"})
		return
	}
	writeJSON(w, http.StatusOK, t)
}

type createOSTemplateReq struct {
	Slug              string `json:"slug"                validate:"required,safename,max=64"`
	Name              string `json:"name"                validate:"required,min=1,max=128"`
	Source            string `json:"source"              validate:"required,min=1,max=256"`
	Protocol          string `json:"protocol"            validate:"omitempty,oneof=simplestreams incus"`
	ServerURL         string `json:"server_url"          validate:"omitempty,url,max=512"`
	DefaultUser       string `json:"default_user"        validate:"omitempty,max=64"`
	CloudInitTemplate string `json:"cloud_init_template" validate:"omitempty,max=8192"`
	SupportsRescue    bool   `json:"supports_rescue"`
	Enabled           bool   `json:"enabled"`
	SortOrder         int    `json:"sort_order"          validate:"gte=0,lte=100000"`
}

func (h *OSTemplateHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createOSTemplateReq
	if !decodeAndValidate(w, r, &req) {
		return
	}
	t := model.OSTemplate{
		Slug:              req.Slug,
		Name:              req.Name,
		Source:            req.Source,
		Protocol:          req.Protocol,
		ServerURL:         req.ServerURL,
		DefaultUser:       req.DefaultUser,
		CloudInitTemplate: req.CloudInitTemplate,
		SupportsRescue:    req.SupportsRescue,
		Enabled:           req.Enabled,
		SortOrder:         req.SortOrder,
	}
	created, err := h.repo.Create(r.Context(), &t)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "os_template.create", "os_template", created.ID, map[string]any{
		"slug":    created.Slug,
		"name":    created.Name,
		"source":  created.Source,
		"enabled": created.Enabled,
	})
	writeJSON(w, http.StatusCreated, map[string]any{"template": created})
}

type updateOSTemplateReq struct {
	Slug              *string `json:"slug"                validate:"omitempty,safename,max=64"`
	Name              *string `json:"name"                validate:"omitempty,min=1,max=128"`
	Source            *string `json:"source"              validate:"omitempty,min=1,max=256"`
	Protocol          *string `json:"protocol"            validate:"omitempty,oneof=simplestreams incus"`
	ServerURL         *string `json:"server_url"          validate:"omitempty,url,max=512"`
	DefaultUser       *string `json:"default_user"        validate:"omitempty,max=64"`
	CloudInitTemplate *string `json:"cloud_init_template" validate:"omitempty,max=8192"`
	SupportsRescue    *bool   `json:"supports_rescue"`
	Enabled           *bool   `json:"enabled"`
	SortOrder         *int    `json:"sort_order"          validate:"omitempty,gte=0,lte=100000"`
}

func applyOSTemplatePatch(t *model.OSTemplate, req updateOSTemplateReq) {
	if req.Slug != nil {
		t.Slug = *req.Slug
	}
	if req.Name != nil {
		t.Name = *req.Name
	}
	if req.Source != nil {
		t.Source = *req.Source
	}
	if req.Protocol != nil {
		t.Protocol = *req.Protocol
	}
	if req.ServerURL != nil {
		t.ServerURL = *req.ServerURL
	}
	if req.DefaultUser != nil {
		t.DefaultUser = *req.DefaultUser
	}
	if req.CloudInitTemplate != nil {
		t.CloudInitTemplate = *req.CloudInitTemplate
	}
	if req.SupportsRescue != nil {
		t.SupportsRescue = *req.SupportsRescue
	}
	if req.Enabled != nil {
		t.Enabled = *req.Enabled
	}
	if req.SortOrder != nil {
		t.SortOrder = *req.SortOrder
	}
}

func (h *OSTemplateHandler) Update(w http.ResponseWriter, r *http.Request) {
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
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "template not found"})
		return
	}

	var req updateOSTemplateReq
	if !decodeAndValidate(w, r, &req) {
		return
	}
	applyOSTemplatePatch(existing, req)
	existing.ID = id
	if err := h.repo.Update(r.Context(), existing); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "os_template.update", "os_template", id, map[string]any{
		"slug":    existing.Slug,
		"name":    existing.Name,
		"enabled": existing.Enabled,
	})
	writeJSON(w, http.StatusOK, map[string]any{"template": existing})
}

func (h *OSTemplateHandler) Delete(w http.ResponseWriter, r *http.Request) {
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
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "template not found"})
		return
	}
	if err := h.repo.Delete(r.Context(), id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "os_template.delete", "os_template", id, map[string]any{
		"slug": existing.Slug,
		"name": existing.Name,
	})
	writeJSON(w, http.StatusOK, map[string]any{"deleted": id})
}
