package portal

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/incuscloud/incus-admin/internal/cluster"
	"github.com/incuscloud/incus-admin/internal/middleware"
	"github.com/incuscloud/incus-admin/internal/model"
	"github.com/incuscloud/incus-admin/internal/repository"
	"github.com/incuscloud/incus-admin/internal/service"
)

// PR #17 code review P2 修复：admin 共享组 slug 不允许 ^u\d+- 前缀，否则会与
// 用户私有组 ACL 命名（fwg-u<id>-<slug>）在 Incus 命名空间撞名。例如 admin
// 创建 slug="u1-myapp" → ACL "fwg-u1-myapp" ↔ 用户1 私有 slug="myapp" → 同名 ACL，
// 双方 EnsureACL PUT 互相覆盖。
var adminReservedSlugPrefix = regexp.MustCompile(`^u\d+-`)

type FirewallHandler struct {
	repo     *repository.FirewallRepo
	svc      *service.FirewallService
	vmRepo   *repository.VMRepo
	quotas   *repository.QuotaRepo // PLAN-035 portal CRUD quota check
	clusters *cluster.Manager
}

func NewFirewallHandler(repo *repository.FirewallRepo, svc *service.FirewallService, vmRepo *repository.VMRepo, clusters *cluster.Manager) *FirewallHandler {
	return &FirewallHandler{repo: repo, svc: svc, vmRepo: vmRepo, clusters: clusters}
}

// WithQuotas 注入 quota repo（PLAN-035）。portal 端 CreateGroup / ReplaceRules 用其
// 校验 max_firewall_groups / max_firewall_rules_per_group。无 quota repo 时跳过校验。
func (h *FirewallHandler) WithQuotas(q *repository.QuotaRepo) *FirewallHandler {
	h.quotas = q
	return h
}

func (h *FirewallHandler) AdminRoutes(r chi.Router) {
	r.Get("/firewall/groups", h.ListGroups)
	r.Post("/firewall/groups", h.CreateGroup)
	r.Get("/firewall/groups/{id}", h.GetGroup)
	r.Put("/firewall/groups/{id}", h.UpdateGroup)
	r.Delete("/firewall/groups/{id}", h.DeleteGroup)
	r.Put("/firewall/groups/{id}/rules", h.ReplaceRules)
	// Admin can bind/unbind any VM's firewall (no owner check). Uses the same
	// service-layer cold-modify path as portal so behaviour is identical
	// other than the audit `via` field.
	r.Get("/vms/{id}/firewall", h.AdminGetVMBindings)
	r.Post("/vms/{id}/firewall", h.AdminBindVM)
	r.Delete("/vms/{id}/firewall/{groupID}", h.AdminUnbindVM)
}

func (h *FirewallHandler) PortalRoutes(r chi.Router) {
	// User-facing：列出 admin 共享 + 自己的私有组；用户私有组完整 CRUD（PLAN-035）。
	r.Get("/firewall/groups", h.PortalListGroups)
	r.Post("/firewall/groups", h.PortalCreateGroup)
	r.Put("/firewall/groups/{id}", h.PortalUpdateGroup)
	r.Delete("/firewall/groups/{id}", h.PortalDeleteGroup)
	r.Put("/firewall/groups/{id}/rules", h.PortalReplaceRules)
	r.Get("/services/{id}/firewall", h.GetVMBindings)
	r.Post("/services/{id}/firewall", h.BindVM)
	r.Delete("/services/{id}/firewall/{groupID}", h.UnbindVM)
}

// --- groups ---

type firewallGroupDTO struct {
	model.FirewallGroup
	Rules []model.FirewallRule `json:"rules"`
}

func (h *FirewallHandler) ListGroups(w http.ResponseWriter, r *http.Request) {
	groups, err := h.repo.ListGroups(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	out := make([]firewallGroupDTO, 0, len(groups))
	for _, g := range groups {
		rules, err := h.repo.ListRules(r.Context(), g.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		out = append(out, firewallGroupDTO{FirewallGroup: g, Rules: rules})
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": out})
}

func (h *FirewallHandler) GetGroup(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	g, err := h.repo.GetGroupByID(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if g == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "group not found"})
		return
	}
	rules, err := h.repo.ListRules(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, firewallGroupDTO{FirewallGroup: *g, Rules: rules})
}

type createFirewallGroupReq struct {
	Slug        string             `json:"slug"        validate:"required,safename,max=64"`
	Name        string             `json:"name"        validate:"required,min=1,max=128"`
	Description string             `json:"description" validate:"omitempty,max=512"`
	Rules       []firewallRuleBody `json:"rules"       validate:"omitempty,dive"`
}

type firewallRuleBody struct {
	// Direction defaults to "ingress" when omitted (back-compat: phase-E
	// shipped ingress-only). "egress" toggles outbound rules.
	Direction       string `json:"direction"        validate:"omitempty,oneof=ingress egress"`
	Action          string `json:"action"           validate:"required,oneof=allow reject drop"`
	Protocol        string `json:"protocol"         validate:"omitempty,oneof=tcp udp icmp4 icmp6"`
	DestinationPort string `json:"destination_port" validate:"omitempty,max=128"`
	SourceCIDR      string `json:"source_cidr"      validate:"omitempty,max=64"`
	Description     string `json:"description"      validate:"omitempty,max=256"`
	SortOrder       int    `json:"sort_order"       validate:"gte=0,lte=100000"`
}

func rulesFromBody(groupID int64, body []firewallRuleBody) []model.FirewallRule {
	out := make([]model.FirewallRule, 0, len(body))
	for _, r := range body {
		proto := r.Protocol
		if proto == "" {
			proto = "tcp"
		}
		dir := r.Direction
		if dir == "" {
			dir = "ingress"
		}
		out = append(out, model.FirewallRule{
			GroupID:         groupID,
			Direction:       dir,
			Action:          r.Action,
			Protocol:        proto,
			DestinationPort: r.DestinationPort,
			SourceCIDR:      r.SourceCIDR,
			Description:     r.Description,
			SortOrder:       r.SortOrder,
		})
	}
	return out
}

func (h *FirewallHandler) CreateGroup(w http.ResponseWriter, r *http.Request) {
	var req createFirewallGroupReq
	if !decodeAndValidate(w, r, &req) {
		return
	}
	if adminReservedSlugPrefix.MatchString(req.Slug) {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "admin slug must not start with 'u<number>-' (reserved for user-private ACL namespace)",
		})
		return
	}
	created, err := h.repo.CreateGroup(r.Context(), &model.FirewallGroup{
		Slug: req.Slug, Name: req.Name, Description: req.Description,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	rules := rulesFromBody(created.ID, req.Rules)
	if len(rules) > 0 {
		if err := h.repo.ReplaceRules(r.Context(), created.ID, rules); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
	}
	if err := h.svc.EnsureACL(r.Context(), created, rules); err != nil {
		// Soft-fail: the DB is authoritative and admin can retry the sync.
		// We don't roll back the DB row because Incus may be transiently
		// unreachable; a follow-up PUT /groups/{id}/rules will re-sync.
		writeJSON(w, http.StatusAccepted, map[string]any{
			"group":    firewallGroupDTO{FirewallGroup: *created, Rules: rules},
			"warning":  "group saved; Incus ACL sync failed — retry by editing rules",
			"sync_err": err.Error(),
		})
		audit(r.Context(), r, "firewall.create", "firewall_group", created.ID, map[string]any{
			"slug": created.Slug, "name": created.Name, "sync_ok": false,
		})
		return
	}
	audit(r.Context(), r, "firewall.create", "firewall_group", created.ID, map[string]any{
		"slug": created.Slug, "name": created.Name, "rule_count": len(rules), "sync_ok": true,
	})
	writeJSON(w, http.StatusCreated, map[string]any{
		"group": firewallGroupDTO{FirewallGroup: *created, Rules: rules},
	})
}

type updateFirewallGroupReq struct {
	Name        *string `json:"name"        validate:"omitempty,min=1,max=128"`
	Description *string `json:"description" validate:"omitempty,max=512"`
}

func (h *FirewallHandler) UpdateGroup(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	existing, err := h.repo.GetGroupByID(r.Context(), id)
	if err != nil || existing == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "group not found"})
		return
	}
	var req updateFirewallGroupReq
	if !decodeAndValidate(w, r, &req) {
		return
	}
	if req.Name != nil {
		existing.Name = *req.Name
	}
	if req.Description != nil {
		existing.Description = *req.Description
	}
	if err := h.repo.UpdateGroup(r.Context(), existing); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	rules, _ := h.repo.ListRules(r.Context(), id)
	if err := h.svc.EnsureACL(r.Context(), existing, rules); err != nil {
		writeJSON(w, http.StatusAccepted, map[string]any{
			"group":    firewallGroupDTO{FirewallGroup: *existing, Rules: rules},
			"warning":  "group saved; Incus ACL sync failed",
			"sync_err": err.Error(),
		})
		audit(r.Context(), r, "firewall.update", "firewall_group", id, map[string]any{"name": existing.Name, "sync_ok": false})
		return
	}
	audit(r.Context(), r, "firewall.update", "firewall_group", id, map[string]any{"name": existing.Name, "sync_ok": true})
	writeJSON(w, http.StatusOK, firewallGroupDTO{FirewallGroup: *existing, Rules: rules})
}

type replaceRulesReq struct {
	Rules []firewallRuleBody `json:"rules" validate:"dive"`
}

func (h *FirewallHandler) ReplaceRules(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	existing, err := h.repo.GetGroupByID(r.Context(), id)
	if err != nil || existing == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "group not found"})
		return
	}
	var req replaceRulesReq
	if !decodeAndValidate(w, r, &req) {
		return
	}
	rules := rulesFromBody(id, req.Rules)
	if err := h.repo.ReplaceRules(r.Context(), id, rules); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if err := h.svc.EnsureACL(r.Context(), existing, rules); err != nil {
		writeJSON(w, http.StatusAccepted, map[string]any{
			"rules":    rules,
			"warning":  "rules saved; Incus ACL sync failed",
			"sync_err": err.Error(),
		})
		audit(r.Context(), r, "firewall.update", "firewall_group", id, map[string]any{"rule_count": len(rules), "sync_ok": false})
		return
	}
	audit(r.Context(), r, "firewall.update", "firewall_group", id, map[string]any{"rule_count": len(rules), "sync_ok": true})
	writeJSON(w, http.StatusOK, map[string]any{"rules": rules})
}

func (h *FirewallHandler) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	existing, err := h.repo.GetGroupByID(r.Context(), id)
	if err != nil || existing == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "group not found"})
		return
	}
	// Delete the Incus ACL first so orphans don't outlive the DB row. If it
	// fails we still proceed — the DB row is the source of truth for the UI,
	// and the admin can clean up the stale ACL by hand.
	syncErr := h.svc.DeleteACL(r.Context(), existing)
	if err := h.repo.DeleteGroup(r.Context(), id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "firewall.delete", "firewall_group", id, map[string]any{
		"slug":    existing.Slug,
		"sync_ok": syncErr == nil,
	})
	resp := map[string]any{"deleted": id}
	if syncErr != nil {
		resp["sync_warning"] = syncErr.Error()
	}
	writeJSON(w, http.StatusOK, resp)
}

// --- VM bindings (portal) ---

type bindFirewallReq struct {
	GroupID int64 `json:"group_id" validate:"required,gt=0"`
}

func (h *FirewallHandler) GetVMBindings(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)
	vmID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || vmID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	vm, err := h.vmRepo.GetByID(r.Context(), vmID)
	if err != nil || vm == nil || vm.UserID != userID {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "access denied"})
		return
	}
	groups, err := h.repo.ListBindingsByVM(r.Context(), vmID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": groups})
}

func (h *FirewallHandler) BindVM(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)
	vmID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || vmID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	vm, err := h.vmRepo.GetByID(r.Context(), vmID)
	if err != nil || vm == nil || vm.UserID != userID {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "access denied"})
		return
	}
	var req bindFirewallReq
	if !decodeAndValidate(w, r, &req) {
		return
	}
	group, err := h.repo.GetGroupByID(r.Context(), req.GroupID)
	if err != nil || group == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "group not found"})
		return
	}
	// PLAN-035：绑别人的私有组 → 404 隐藏存在性。仅 admin 共享组（owner=nil）
	// 或自己的私有组（owner==userID）允许绑定。
	if group.OwnerID != nil && *group.OwnerID != userID {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "group not found"})
		return
	}
	clusterName, project := h.resolveVMLocation(vm)
	if err := h.svc.AttachACLToVM(r.Context(), clusterName, project, vm.Name, group); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "attach ACL: " + err.Error()})
		return
	}
	if err := h.repo.Bind(r.Context(), vmID, group.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "firewall.bind", "vm", vmID, map[string]any{
		"group_id":   group.ID,
		"group_slug": group.Slug,
	})
	writeJSON(w, http.StatusOK, map[string]any{"status": "bound", "group": group})
}

func (h *FirewallHandler) UnbindVM(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)
	vmID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || vmID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	groupID, err := strconv.ParseInt(chi.URLParam(r, "groupID"), 10, 64)
	if err != nil || groupID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid group id"})
		return
	}
	vm, err := h.vmRepo.GetByID(r.Context(), vmID)
	if err != nil || vm == nil || vm.UserID != userID {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "access denied"})
		return
	}
	group, err := h.repo.GetGroupByID(r.Context(), groupID)
	if err != nil || group == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "group not found"})
		return
	}
	clusterName, project := h.resolveVMLocation(vm)
	if err := h.svc.DetachACLFromVM(r.Context(), clusterName, project, vm.Name, group); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "detach ACL: " + err.Error()})
		return
	}
	if err := h.repo.Unbind(r.Context(), vmID, groupID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "firewall.unbind", "vm", vmID, map[string]any{
		"group_id":   group.ID,
		"group_slug": group.Slug,
	})
	writeJSON(w, http.StatusOK, map[string]any{"status": "unbound"})
}

// --- VM bindings (admin) ---
//
// Admin path mirrors the portal handlers but skips the owner check so support
// can bind/unbind a customer VM without going through shadow-login.

func (h *FirewallHandler) AdminGetVMBindings(w http.ResponseWriter, r *http.Request) {
	vmID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || vmID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	vm, err := h.vmRepo.GetByID(r.Context(), vmID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if vm == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "vm not found"})
		return
	}
	groups, err := h.repo.ListBindingsByVM(r.Context(), vmID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": groups})
}

func (h *FirewallHandler) AdminBindVM(w http.ResponseWriter, r *http.Request) {
	vmID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || vmID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	vm, err := h.vmRepo.GetByID(r.Context(), vmID)
	if err != nil || vm == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "vm not found"})
		return
	}
	var req bindFirewallReq
	if !decodeAndValidate(w, r, &req) {
		return
	}
	group, err := h.repo.GetGroupByID(r.Context(), req.GroupID)
	if err != nil || group == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "group not found"})
		return
	}
	clusterName, project := h.resolveVMLocation(vm)
	if err := h.svc.AttachACLToVM(r.Context(), clusterName, project, vm.Name, group); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "attach ACL: " + err.Error()})
		return
	}
	if err := h.repo.Bind(r.Context(), vmID, group.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "firewall.bind", "vm", vmID, map[string]any{
		"group_id":   group.ID,
		"group_slug": group.Slug,
		"via":        "admin",
	})
	writeJSON(w, http.StatusOK, map[string]any{"status": "bound", "group": group})
}

func (h *FirewallHandler) AdminUnbindVM(w http.ResponseWriter, r *http.Request) {
	vmID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || vmID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	groupID, err := strconv.ParseInt(chi.URLParam(r, "groupID"), 10, 64)
	if err != nil || groupID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid group id"})
		return
	}
	vm, err := h.vmRepo.GetByID(r.Context(), vmID)
	if err != nil || vm == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "vm not found"})
		return
	}
	group, err := h.repo.GetGroupByID(r.Context(), groupID)
	if err != nil || group == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "group not found"})
		return
	}
	clusterName, project := h.resolveVMLocation(vm)
	if err := h.svc.DetachACLFromVM(r.Context(), clusterName, project, vm.Name, group); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "detach ACL: " + err.Error()})
		return
	}
	if err := h.repo.Unbind(r.Context(), vmID, groupID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "firewall.unbind", "vm", vmID, map[string]any{
		"group_id":   group.ID,
		"group_slug": group.Slug,
		"via":        "admin",
	})
	writeJSON(w, http.StatusOK, map[string]any{"status": "unbound"})
}

func (h *FirewallHandler) resolveVMLocation(vm *model.VM) (clusterName, project string) {
	clusterName = findClusterName(h.clusters, vm.ClusterID)
	cc, _ := h.clusters.ConfigByName(clusterName)
	project = cc.DefaultProject
	if project == "" {
		project = "customers"
	}
	return
}

// ============================================================================
// PLAN-035: portal-side firewall group CRUD（用户私有组 + 共享组只读）
// ============================================================================

// portalRequireOwnedGroup 取 group 并校验当前用户是该组 owner。
// 共享组（OwnerID == nil）不允许用户编辑；非自己的私有组返 404 隐藏存在性。
func (h *FirewallHandler) portalRequireOwnedGroup(r *http.Request, w http.ResponseWriter, groupID, userID int64) (*model.FirewallGroup, bool) {
	g, err := h.repo.GetGroupByID(r.Context(), groupID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return nil, false
	}
	if g == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "group not found"})
		return nil, false
	}
	if g.OwnerID == nil {
		// 共享组对用户只读
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "shared group is read-only for users"})
		return nil, false
	}
	if *g.OwnerID != userID {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "group not found"})
		return nil, false
	}
	return g, true
}

// PortalListGroups —— 用户视角列出 admin 共享组 + 自己的私有组（含 rules）。
func (h *FirewallHandler) PortalListGroups(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)
	groups, err := h.repo.ListGroupsForUser(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	out := make([]firewallGroupDTO, 0, len(groups))
	for _, g := range groups {
		rules, err := h.repo.ListRules(r.Context(), g.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		out = append(out, firewallGroupDTO{FirewallGroup: g, Rules: rules})
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": out})
}

// PortalCreateGroup —— 用户创建私有 firewall group。owner 强制为 current user，
// quota 校验 max_firewall_groups + max_firewall_rules_per_group。
func (h *FirewallHandler) PortalCreateGroup(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)
	if userID <= 0 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var req createFirewallGroupReq
	if !decodeAndValidate(w, r, &req) {
		return
	}

	// quota 校验：组数 + 单组规则数
	if h.quotas != nil {
		q, err := h.quotas.GetByUserID(r.Context(), userID)
		if err == nil && q != nil {
			if q.MaxFirewallGroups > 0 {
				cnt, _ := h.repo.CountGroupsByUser(r.Context(), userID)
				if cnt >= q.MaxFirewallGroups {
					writeJSON(w, http.StatusForbidden, map[string]any{
						"error": fmt.Sprintf("firewall group quota exceeded: %d/%d", cnt, q.MaxFirewallGroups),
					})
					return
				}
			}
			if q.MaxFirewallRulesPerGroup > 0 && len(req.Rules) > q.MaxFirewallRulesPerGroup {
				writeJSON(w, http.StatusForbidden, map[string]any{
					"error": fmt.Sprintf("rule count exceeds per-group quota: %d/%d", len(req.Rules), q.MaxFirewallRulesPerGroup),
				})
				return
			}
		}
	}

	owner := userID
	created, err := h.repo.CreateGroup(r.Context(), &model.FirewallGroup{
		Slug: req.Slug, Name: req.Name, Description: req.Description, OwnerID: &owner,
	})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	rules := rulesFromBody(created.ID, req.Rules)
	if len(rules) > 0 {
		if err := h.repo.ReplaceRules(r.Context(), created.ID, rules); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
	}
	if err := h.svc.EnsureACL(r.Context(), created, rules); err != nil {
		audit(r.Context(), r, "firewall.create", "firewall_group", created.ID, map[string]any{
			"slug": created.Slug, "name": created.Name, "owner_id": owner, "sync_ok": false,
		})
		writeJSON(w, http.StatusAccepted, map[string]any{
			"group":    firewallGroupDTO{FirewallGroup: *created, Rules: rules},
			"warning":  "group saved; Incus ACL sync failed — retry by editing rules",
			"sync_err": err.Error(),
		})
		return
	}
	audit(r.Context(), r, "firewall.create", "firewall_group", created.ID, map[string]any{
		"slug": created.Slug, "name": created.Name, "owner_id": owner, "rule_count": len(rules), "sync_ok": true,
	})
	writeJSON(w, http.StatusCreated, map[string]any{
		"group": firewallGroupDTO{FirewallGroup: *created, Rules: rules},
	})
}

// PortalUpdateGroup —— 用户改自己组的 name/description（slug 不可改）。
func (h *FirewallHandler) PortalUpdateGroup(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	existing, ok := h.portalRequireOwnedGroup(r, w, id, userID)
	if !ok {
		return
	}
	var req updateFirewallGroupReq
	if !decodeAndValidate(w, r, &req) {
		return
	}
	if req.Name != nil {
		existing.Name = *req.Name
	}
	if req.Description != nil {
		existing.Description = *req.Description
	}
	if err := h.repo.UpdateGroup(r.Context(), existing); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	rules, _ := h.repo.ListRules(r.Context(), id)
	syncErr := h.svc.EnsureACL(r.Context(), existing, rules)
	audit(r.Context(), r, "firewall.update", "firewall_group", id, map[string]any{
		"name": existing.Name, "owner_id": userID, "sync_ok": syncErr == nil,
	})
	if syncErr != nil {
		writeJSON(w, http.StatusAccepted, map[string]any{
			"group":    firewallGroupDTO{FirewallGroup: *existing, Rules: rules},
			"warning":  "group saved; Incus ACL sync failed",
			"sync_err": syncErr.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, firewallGroupDTO{FirewallGroup: *existing, Rules: rules})
}

// PortalDeleteGroup —— 删自己的私有组。仍被 VM 绑定时 409 而不删。
func (h *FirewallHandler) PortalDeleteGroup(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	existing, ok := h.portalRequireOwnedGroup(r, w, id, userID)
	if !ok {
		return
	}
	bindings, err := h.repo.CountBindingsForGroup(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if bindings > 0 {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":         fmt.Sprintf("group still bound by %d VM(s); unbind first", bindings),
			"binding_count": bindings,
		})
		return
	}
	syncErr := h.svc.DeleteACL(r.Context(), existing)
	if err := h.repo.DeleteGroup(r.Context(), id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "firewall.delete", "firewall_group", id, map[string]any{
		"slug": existing.Slug, "owner_id": userID, "sync_ok": syncErr == nil,
	})
	resp := map[string]any{"deleted": id}
	if syncErr != nil {
		resp["sync_warning"] = syncErr.Error()
	}
	writeJSON(w, http.StatusOK, resp)
}

// PortalReplaceRules —— 用户替换自己组的全部规则。受 max_firewall_rules_per_group 限制。
func (h *FirewallHandler) PortalReplaceRules(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	existing, ok := h.portalRequireOwnedGroup(r, w, id, userID)
	if !ok {
		return
	}
	var req replaceRulesReq
	if !decodeAndValidate(w, r, &req) {
		return
	}
	if h.quotas != nil {
		q, err := h.quotas.GetByUserID(r.Context(), userID)
		if err == nil && q != nil && q.MaxFirewallRulesPerGroup > 0 && len(req.Rules) > q.MaxFirewallRulesPerGroup {
			writeJSON(w, http.StatusForbidden, map[string]any{
				"error": fmt.Sprintf("rule count exceeds per-group quota: %d/%d", len(req.Rules), q.MaxFirewallRulesPerGroup),
			})
			return
		}
	}
	rules := rulesFromBody(id, req.Rules)
	if err := h.repo.ReplaceRules(r.Context(), id, rules); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	syncErr := h.svc.EnsureACL(r.Context(), existing, rules)
	audit(r.Context(), r, "firewall.update", "firewall_group", id, map[string]any{
		"rule_count": len(rules), "owner_id": userID, "sync_ok": syncErr == nil,
	})
	if syncErr != nil {
		writeJSON(w, http.StatusAccepted, map[string]any{
			"rules":    rules,
			"warning":  "rules saved; Incus ACL sync failed",
			"sync_err": syncErr.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rules": rules})
}
