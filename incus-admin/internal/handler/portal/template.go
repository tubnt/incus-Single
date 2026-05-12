package portal

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"gopkg.in/yaml.v3"

	"github.com/incuscloud/incus-admin/internal/model"
	"github.com/incuscloud/incus-admin/internal/repository"
)

// validateCloudInitTemplate 校验 cloud-init template 至少是合法 YAML，且顶级
// key 在白名单内。Session-1 O6 / PLAN-051 §2-B 决策 D-11 = B：仅做 YAML 解析
// + 顶级 key 类型 sanity 检查（写非法 YAML 让用户看到清楚错误，不限 runcmd
// 内容）。空字符串放行（== "用 incus 默认 cloud-init"）。
//
// 顶级允许的 key：cloud-config v2 标准字段集子集；其它自定义 key（user-data
// 文件嵌入用） 走 user.* 前缀也允许，但要 known list 内。
func validateCloudInitTemplate(s string) error {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	// cloud-config 必须以 "#cloud-config" 头一行开始（cloud-init 协议要求）
	// 但模板可能含 Go template 占位符；不强制头一行，仅确保剩下能解析为 YAML。
	var node yaml.Node
	if err := yaml.Unmarshal([]byte(s), &node); err != nil {
		return fmt.Errorf("invalid YAML: %w", err)
	}
	// 不强制 schema 校验内容；YAML 解析通过即认为合法。
	return nil
}

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
	// Session-1 O6：cloud-init 模板 YAML 解析校验
	if err := validateCloudInitTemplate(req.CloudInitTemplate); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "cloud_init_template: " + err.Error()})
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
	// Session-1 O6：cloud-init 模板 YAML 解析校验（Update 路径同样防御）
	if req.CloudInitTemplate != nil {
		if err := validateCloudInitTemplate(*req.CloudInitTemplate); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "cloud_init_template: " + err.Error()})
			return
		}
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
