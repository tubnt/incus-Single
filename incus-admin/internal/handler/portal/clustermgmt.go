package portal

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/incuscloud/incus-admin/internal/cluster"
	"github.com/incuscloud/incus-admin/internal/config"
	"github.com/incuscloud/incus-admin/internal/middleware"
	"github.com/incuscloud/incus-admin/internal/model"
	"github.com/incuscloud/incus-admin/internal/repository"
	"github.com/incuscloud/incus-admin/internal/service/aiassist"
	"github.com/incuscloud/incus-admin/internal/service/jobs"
	"github.com/incuscloud/incus-admin/internal/service/rebalance"
	"github.com/incuscloud/incus-admin/internal/sshexec"
)

type ClusterMgmtHandler struct {
	mgr *cluster.Manager
	// PLAN-026 / INFRA-002：节点 add/remove 走 jobs runtime 异步流
	jobs           *jobs.Runtime
	jobRepo        *repository.ProvisioningJobRepo
	sshUser        string
	sshKeyFile     string
	knownHostsFile string
	// PLAN-027 / INFRA-003：cluster 持久化
	clusterRepo *repository.ClusterRepo
	// PLAN-033 / OPS-039：node credential store + probe cache + per-user
	// rate limiter for the wizard's discover step.
	nodeCredRepo *repository.NodeCredentialRepo
	probeCache   *probeCache
	probeRate    *rateLimiter
	// PLAN-037 / OPS-040：topology + 不均衡建议
	scheduler *cluster.Scheduler
	vmRepo    *repository.VMRepo
	// PLAN-039 / OPS-044：system_alerts CRUD
	alertRepo *repository.SystemAlertRepo
	// PLAN-038 / OPS-041 Phase B：Tier 2 LLM provider；nil 时 endpoint 503
	aiProvider aiassist.Provider
	// per-user 内存限流（10/h）：Tier 2 调用，与 Tier 3 隔离计数
	aiRateMu sync.Mutex
	aiRate   map[int64][]time.Time
}

func NewClusterMgmtHandler(mgr *cluster.Manager) *ClusterMgmtHandler {
	return &ClusterMgmtHandler{
		mgr:        mgr,
		probeCache: newProbeCache(),
		probeRate:  newRateLimiter(),
	}
}

// WithNodeCredentials injects the credential repo so the probe + add-node
// flows can resolve a saved credential by id (PLAN-033 / OPS-039).
func (h *ClusterMgmtHandler) WithNodeCredentials(repo *repository.NodeCredentialRepo) *ClusterMgmtHandler {
	h.nodeCredRepo = repo
	return h
}

// WithTopology 注入 scheduler + vmRepo 启用 PLAN-037 topology / 不均衡建议端点。
func (h *ClusterMgmtHandler) WithTopology(scheduler *cluster.Scheduler, vmRepo *repository.VMRepo) *ClusterMgmtHandler {
	h.scheduler = scheduler
	h.vmRepo = vmRepo
	return h
}

// WithAlerts 注入 system_alerts repo 启用 PLAN-039 / OPS-044 告警 CRUD。
func (h *ClusterMgmtHandler) WithAlerts(repo *repository.SystemAlertRepo) *ClusterMgmtHandler {
	h.alertRepo = repo
	return h
}

// WithAIProvider 注入 LLM provider 启用 PLAN-038 / OPS-041 Tier 2 角色推荐。
func (h *ClusterMgmtHandler) WithAIProvider(p aiassist.Provider) *ClusterMgmtHandler {
	h.aiProvider = p
	if h.aiRate == nil {
		h.aiRate = make(map[int64][]time.Time)
	}
	return h
}

// WithPersistence 注入 ClusterRepo 启用 add/remove 双写 DB（PLAN-027）。
// 不注入时退化为旧行为（in-memory only，重启即丢）。
func (h *ClusterMgmtHandler) WithPersistence(repo *repository.ClusterRepo) *ClusterMgmtHandler {
	h.clusterRepo = repo
	return h
}

// WithNodeOrchestration 注入节点编排所需依赖。nil jobs runtime 时 add/remove
// 路由返回 503，避免没异步运行时的环境跑爆。
func (h *ClusterMgmtHandler) WithNodeOrchestration(rt *jobs.Runtime, jobRepo *repository.ProvisioningJobRepo, sshUser, sshKeyFile, knownHostsFile string) *ClusterMgmtHandler {
	h.jobs = rt
	h.jobRepo = jobRepo
	h.sshUser = sshUser
	h.sshKeyFile = sshKeyFile
	h.knownHostsFile = knownHostsFile
	return h
}

func (h *ClusterMgmtHandler) AdminRoutes(r chi.Router) {
	r.Post("/clusters/add", h.AddCluster)
	r.Delete("/clusters/{name}/remove", h.RemoveCluster)
	r.Get("/nodes", h.ListNodes)
	r.Get("/nodes/{name}", h.NodeDetail)
	r.Post("/nodes/{name}/evacuate", h.EvacuateNode)
	r.Post("/nodes/{name}/restore", h.RestoreNode)
	// PLAN-026 节点 add/remove
	r.Post("/clusters/{name}/nodes", h.AddNode)
	r.Delete("/clusters/{name}/nodes/{node}", h.RemoveNode)
	// PLAN-033 / OPS-039：wizard 探测路径
	r.Post("/clusters/{name}/nodes/probe-host-key", h.ProbeHostKey)
	r.Post("/clusters/{name}/nodes/probe", h.ProbeNode)
	// OPS-024 D2 maintenance mode
	r.Post("/clusters/{name}/nodes/{node}/maintenance", h.SetMaintenance)
	// OPS-024 C2 cluster-env.sh 生成（step-up gated；middleware 配置）
	r.Get("/clusters/{name}/env-script", h.GenerateEnvScript)
	// PLAN-037 / OPS-040：节点拓扑 + 不均衡建议（admin/nodes 顶部条带 + RebalancePanel）
	r.Get("/clusters/{name}/nodes/topology", h.NodeTopology)
	r.Get("/clusters/{name}/imbalance-suggestions", h.ImbalanceSuggestions)
	// PLAN-039 / OPS-044：watchdog 告警
	r.Get("/system-alerts", h.ListSystemAlerts)
	r.Post("/system-alerts/{id}/dismiss", h.DismissSystemAlert)
	// PLAN-038 / OPS-041 Phase B Tier 2：AI 角色推荐（仅在低置信度时点用）
	r.Post("/clusters/{name}/nodes/ai-suggest", h.AISuggestRoles)
}

func (h *ClusterMgmtHandler) AddCluster(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name           string                 `json:"name"            validate:"required,safename"`
		DisplayName    string                 `json:"display_name"    validate:"omitempty,max=200"`
		APIURL         string                 `json:"api_url"         validate:"required,url"`
		CertFile       string                 `json:"cert_file"       validate:"omitempty,max=512"`
		KeyFile        string                 `json:"key_file"        validate:"omitempty,max=512"`
		CAFile         string                 `json:"ca_file"         validate:"omitempty,max=512"`
		Kind           string                 `json:"kind"            validate:"omitempty,oneof=cluster standalone"`
		DefaultProject string                 `json:"default_project" validate:"omitempty,safename"`
		StoragePool    string                 `json:"storage_pool"    validate:"omitempty,safename"`
		Network        string                 `json:"network"         validate:"omitempty,safename"`
		IPPools        []config.IPPoolConfig  `json:"ip_pools"        validate:"omitempty,dive"`
	}
	if !decodeAndValidate(w, r, &req) {
		return
	}

	cc := config.ClusterConfig{
		Name:           req.Name,
		DisplayName:    req.DisplayName,
		APIURL:         req.APIURL,
		CertFile:       req.CertFile,
		KeyFile:        req.KeyFile,
		CAFile:         req.CAFile,
		DefaultProject: req.DefaultProject,
		StoragePool:    req.StoragePool,
		Network:        req.Network,
		IPPools:        req.IPPools,
	}

	if err := h.mgr.AddCluster(cc); err != nil {
		slog.Error("add cluster failed", "name", req.Name, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	// PLAN-027：双写 DB。Manager 已经成功，DB 失败时把 Manager 也回滚回去，
	// 保证两边一致 —— 否则下次重启会少这条 cluster 但内存里还有，状态漂移。
	if h.clusterRepo != nil {
		kind := req.Kind
		if kind == "" {
			kind = model.ClusterKindCluster
		}
		var pools any
		if len(req.IPPools) > 0 {
			pools = req.IPPools
		}
		row := &model.Cluster{
			Name:           req.Name,
			DisplayName:    req.DisplayName,
			APIURL:         req.APIURL,
			Kind:           kind,
			CertFile:       req.CertFile,
			KeyFile:        req.KeyFile,
			CAFile:         req.CAFile,
			DefaultProject: req.DefaultProject,
			StoragePool:    req.StoragePool,
			Network:        req.Network,
		}
		if id, perr := h.clusterRepo.CreateFull(r.Context(), row, pools); perr != nil {
			// rollback Manager-side add to keep state consistent
			_ = h.mgr.RemoveCluster(req.Name)
			slog.Error("persist cluster to DB failed; rolled back manager", "name", req.Name, "error", perr)
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "persist cluster: " + perr.Error()})
			return
		} else {
			h.mgr.SetID(req.Name, id)
		}
	}

	audit(r.Context(), r, "cluster.add", "cluster", 0, map[string]any{"name": req.Name, "url": req.APIURL, "kind": req.Kind})
	slog.Info("cluster added", "name", req.Name, "url", req.APIURL, "kind", req.Kind)
	writeJSON(w, http.StatusCreated, map[string]any{"status": "added", "name": req.Name})
}

func (h *ClusterMgmtHandler) RemoveCluster(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	if err := h.mgr.RemoveCluster(name); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}

	// PLAN-027：DB 删除。Manager 删除已成功，DB 失败仅记日志（重启会再次发现并清理）。
	if h.clusterRepo != nil {
		if _, derr := h.clusterRepo.DeleteByName(r.Context(), name); derr != nil {
			slog.Error("delete cluster row failed; will reappear on restart", "name", name, "error", derr)
		}
	}

	audit(r.Context(), r, "cluster.remove", "cluster", 0, map[string]any{"name": name})
	slog.Info("cluster removed", "name", name)
	writeJSON(w, http.StatusOK, map[string]any{"status": "removed", "name": name})
}

// ListNodes 返回所有集群的所有节点成员列表
func (h *ClusterMgmtHandler) ListNodes(w http.ResponseWriter, r *http.Request) {
	if h.mgr == nil || len(h.mgr.List()) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"nodes": []any{}})
		return
	}

	clusterFilter := r.URL.Query().Get("cluster")

	type nodeInfo struct {
		Cluster     string `json:"cluster"`
		ServerName  string `json:"server_name"`
		URL         string `json:"url"`
		Status      string `json:"status"`
		Message     string `json:"message"`
		Architecture string `json:"architecture"`
		Roles       []string `json:"roles"`
		Description string `json:"description"`
	}

	var nodes []nodeInfo
	for _, client := range h.mgr.List() {
		if clusterFilter != "" && client.Name != clusterFilter {
			continue
		}
		members, err := client.GetClusterMembers(r.Context())
		if err != nil {
			slog.Error("list cluster members failed", "cluster", client.Name, "error", err)
			continue
		}
		for _, raw := range members {
			var m struct {
				ServerName   string   `json:"server_name"`
				URL          string   `json:"url"`
				Status       string   `json:"status"`
				Message      string   `json:"message"`
				Architecture string   `json:"architecture"`
				Roles        []string `json:"roles"`
				Description  string   `json:"description"`
			}
			if err := json.Unmarshal(raw, &m); err != nil {
				continue
			}
			nodes = append(nodes, nodeInfo{
				Cluster:     client.Name,
				ServerName:  m.ServerName,
				URL:         m.URL,
				Status:      m.Status,
				Message:     m.Message,
				Architecture: m.Architecture,
				Roles:       m.Roles,
				Description: m.Description,
			})
		}
	}

	if nodes == nil {
		nodes = []nodeInfo{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"nodes": nodes})
}

// NodeDetail 获取单个节点详情（含实例列表）
func (h *ClusterMgmtHandler) NodeDetail(w http.ResponseWriter, r *http.Request) {
	nodeName := chi.URLParam(r, "name")
	clusterName := r.URL.Query().Get("cluster")
	if clusterName == "" && len(h.mgr.List()) > 0 {
		clusterName = h.mgr.List()[0].Name
	}

	client, ok := h.mgr.Get(clusterName)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "cluster not found"})
		return
	}

	// 获取节点信息
	resp, err := client.APIGet(r.Context(), fmt.Sprintf("/1.0/cluster/members/%s", url.PathEscape(nodeName)))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to get node: " + err.Error()})
		return
	}

	// 获取该节点上的实例列表
	project := r.URL.Query().Get("project")
	if project == "" {
		project = "customers"
	}
	instances, _ := client.GetInstances(r.Context(), project)
	var nodeInstances []json.RawMessage
	for _, inst := range instances {
		var brief struct {
			Name     string `json:"name"`
			Location string `json:"location"`
			Status   string `json:"status"`
			Type     string `json:"type"`
		}
		if err := json.Unmarshal(inst, &brief); err == nil && brief.Location == nodeName {
			nodeInstances = append(nodeInstances, inst)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"node":      resp.Metadata,
		"instances": redactInstanceList(nodeInstances),
	})
}

// EvacuateNode 将节点设为维护模式（evacuate 迁移实例到其他节点）
func (h *ClusterMgmtHandler) EvacuateNode(w http.ResponseWriter, r *http.Request) {
	nodeName := chi.URLParam(r, "name")
	clusterName := r.URL.Query().Get("cluster")
	if clusterName == "" && len(h.mgr.List()) > 0 {
		clusterName = h.mgr.List()[0].Name
	}

	client, ok := h.mgr.Get(clusterName)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "cluster not found"})
		return
	}

	// PLAN-020 Phase D: double-write healing_events. The row is created
	// before we touch Incus so a crash between insert + API call still
	// shows up as in_progress → ExpireStale → partial. Completed once
	// the Incus evacuate operation returns (or Fail'd on error).
	var healingID int64
	if healingRepo != nil {
		clusterID := h.mgr.IDByName(clusterName)
		if clusterID > 0 {
			actorID, _ := r.Context().Value(middleware.CtxUserID).(int64)
			if a, _ := r.Context().Value(middleware.CtxActorID).(int64); a > 0 {
				// Under shadow session the "operator" is the admin behind it.
				actorID = a
			}
			var actorPtr *int64
			if actorID > 0 {
				actorPtr = &actorID
			}
			if id, hErr := healingRepo.Create(r.Context(), clusterID, nodeName, "manual", actorPtr); hErr == nil {
				healingID = id
			} else {
				slog.Warn("healing event create failed", "node", nodeName, "error", hErr)
			}
		}
	}

	evacuateBody := strings.NewReader(`{"action":"evacuate"}`)
	resp, err := client.APIPost(r.Context(), fmt.Sprintf("/1.0/cluster/members/%s/state", url.PathEscape(nodeName)), evacuateBody)
	if err != nil {
		if healingID > 0 && healingRepo != nil {
			_ = healingRepo.Fail(r.Context(), healingID, err.Error())
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "evacuate failed: " + err.Error()})
		return
	}

	if resp != nil && resp.Type == "async" && resp.Operation != "" {
		opID := extractOperationID(resp.Operation)
		if opID != "" {
			if waitErr := client.WaitForOperation(r.Context(), opID); waitErr != nil {
				if healingID > 0 && healingRepo != nil {
					_ = healingRepo.Fail(r.Context(), healingID, waitErr.Error())
				}
				slog.Warn("evacuate operation wait failed", "node", nodeName, "error", waitErr)
			}
		}
	}

	if healingID > 0 && healingRepo != nil {
		_ = healingRepo.Complete(r.Context(), healingID)
	}

	audit(r.Context(), r, "node.evacuate", "node", 0, map[string]any{
		"node": nodeName, "cluster": clusterName, "healing_event_id": healingID,
	})
	slog.Info("node evacuated", "node", nodeName, "cluster", clusterName, "healing_event_id", healingID)
	writeJSON(w, http.StatusOK, map[string]any{"status": "evacuated", "node": nodeName})
}

// RestoreNode 恢复节点（evacuate 反向操作）
func (h *ClusterMgmtHandler) RestoreNode(w http.ResponseWriter, r *http.Request) {
	nodeName := chi.URLParam(r, "name")
	clusterName := r.URL.Query().Get("cluster")
	if clusterName == "" && len(h.mgr.List()) > 0 {
		clusterName = h.mgr.List()[0].Name
	}

	client, ok := h.mgr.Get(clusterName)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "cluster not found"})
		return
	}

	restoreBody := strings.NewReader(`{"action":"restore"}`)
	resp, err := client.APIPost(r.Context(), fmt.Sprintf("/1.0/cluster/members/%s/state", url.PathEscape(nodeName)), restoreBody)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "restore failed: " + err.Error()})
		return
	}

	if resp != nil && resp.Type == "async" && resp.Operation != "" {
		opID := extractOperationID(resp.Operation)
		if opID != "" {
			_ = client.WaitForOperation(r.Context(), opID)
		}
	}

	audit(r.Context(), r, "node.restore", "node", 0, map[string]any{
		"node": nodeName, "cluster": clusterName,
	})
	slog.Info("node restored", "node", nodeName, "cluster", clusterName)
	writeJSON(w, http.StatusOK, map[string]any{"status": "restored", "node": nodeName})
}

// extractOperationID 从 "/1.0/operations/<uuid>" 中提取 uuid
func extractOperationID(opPath string) string {
	parts := strings.Split(opPath, "/")
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}
	return ""
}

// AddNode 入队 cluster.node.add job：通过 Incus API 生成 join token，
// SSH 到目标节点上传 join-node.sh 套件并流式跑 7 步加入流程。
//
// 路由：POST /api/admin/clusters/{name}/nodes
// 请求体：{node_name, public_ip, ssh_user?, ssh_key_file?, role?}
// 响应：202 + {job_id, vm_id?=null, status:"provisioning"}
func (h *ClusterMgmtHandler) AddNode(w http.ResponseWriter, r *http.Request) {
	clusterName := chi.URLParam(r, "name")
	if h.jobs == nil || h.jobRepo == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "jobs runtime not configured"})
		return
	}

	var req struct {
		NodeName     string `json:"node_name"      validate:"required,safename,max=63"`
		PublicIP     string `json:"public_ip"      validate:"required,ip"`
		SSHUser      string `json:"ssh_user"       validate:"omitempty,safename,max=64"`
		SSHKeyFile   string `json:"ssh_key_file"   validate:"omitempty,max=512"`
		Role         string `json:"role"           validate:"omitempty,oneof=osd mon-mgr-osd"`
		// OPS-026 / PLAN-028：拓扑覆盖（可选；不传走 cluster-env.sh 默认）
		// OPS-028 L1：safename 双重防御 —— shellQuote 已防 injection，safename
		// 限制 charset 让奇怪输入早死于 422 而不是远端脚本失败
		NICPrimary    string `json:"nic_primary"      validate:"omitempty,safename,max=64"`
		NICCluster    string `json:"nic_cluster"      validate:"omitempty,safename,max=64"`
		BridgeName    string `json:"bridge_name"      validate:"omitempty,safename,max=64"`
		MgmtIP        string `json:"mgmt_ip"          validate:"omitempty,ip"`
		CephPubIP     string `json:"ceph_pub_ip"      validate:"omitempty,ip"`
		CephClusterIP string `json:"ceph_cluster_ip"  validate:"omitempty,ip"`
		SkipNetwork   bool   `json:"skip_network"`

		// PLAN-033 / OPS-039：wizard 可选字段
		ProbeID                string `json:"probe_id"                    validate:"omitempty,startswith=p_,max=64"`
		AcceptedHostKeySHA256  string `json:"accepted_host_key_sha256"    validate:"omitempty,startswith=SHA256:,max=80"`
		CredentialID           int64  `json:"credential_id"               validate:"omitempty,min=1"`
		InlineKind             string `json:"inline_kind"                 validate:"omitempty,oneof=password private_key"`
		InlinePassword         string `json:"inline_password"             validate:"omitempty,max=2048"`
		InlineKeyData          string `json:"inline_key_data"             validate:"omitempty,max=32768"`
	}
	if !decodeAndValidate(w, r, &req) {
		return
	}
	if _, ok := h.mgr.Get(clusterName); !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "cluster not found"})
		return
	}
	clusterID := h.mgr.IDByName(clusterName)
	if clusterID == 0 {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "cluster id resolve failed"})
		return
	}

	sshUser := req.SSHUser
	if sshUser == "" {
		sshUser = h.sshUser
	}
	if sshUser == "" {
		sshUser = "root"
	}

	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)

	// PLAN-033 / OPS-039：凭据解析优先级
	//   probe_id  -> 查 cache，复用 wizard 已确认的 cred + host key
	//   credential_id / inline_* -> wizard 提交时直接传
	//   都不传   -> 退化到 sshKeyFile 全局 default（兼容老调用方）
	var cred *sshexec.Credential
	var keyFile string
	var acceptedHK string

	if req.ProbeID != "" && h.probeCache != nil {
		rec, ok := h.probeCache.get(req.ProbeID)
		if !ok {
			writeJSON(w, http.StatusGone, map[string]any{"error": "probe_id expired or unknown"})
			return
		}
		if rec.host != req.PublicIP {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "probe host does not match public_ip"})
			return
		}
		acceptedHK = rec.hostKeySHA256
		// 重新解出 credential（cache 不持有明文）
		c, _, cerr := h.resolveCredential(r, userID, rec.credentialID, req.InlineKind, req.InlinePassword, req.InlineKeyData)
		if cerr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": cerr.Error()})
			return
		}
		cred = c
	} else if req.CredentialID > 0 || req.InlineKind != "" {
		c, _, cerr := h.resolveCredential(r, userID, req.CredentialID, req.InlineKind, req.InlinePassword, req.InlineKeyData)
		if cerr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": cerr.Error()})
			return
		}
		cred = c
	} else {
		keyFile = req.SSHKeyFile
		if keyFile == "" {
			keyFile = h.sshKeyFile
		}
		if keyFile == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "ssh_key_file or credential_id / inline credential required"})
			return
		}
	}

	if req.AcceptedHostKeySHA256 != "" {
		acceptedHK = req.AcceptedHostKeySHA256
	}

	// Wipe-on-error guard: cred 在成功 Enqueue 之前的任意失败路径都要清零，
	// 避免 inline 密码 / 私钥在 handler scope 直到 GC。Enqueue 成功后凭据
	// 转给 worker，由 executor 终态时 Wipe（cluster_node_add.go takeParams 路径）。
	enqueued := false
	defer func() {
		if !enqueued && cred != nil {
			cred.Wipe()
		}
	}()

	// 在异步 job 跑起来之前把 host key 写入 known_hosts，避免严格校验把
	// 第一次 add 直接挡掉。re-fetch host key 是因为 probe 后 add 之间有
	// TTL 间隙，且对应 endpoint 已要求 admin step-up。
	if acceptedHK != "" && h.knownHostsFile != "" {
		probeRunner := sshexec.NewWithCredential(req.PublicIP, sshUser, sshexec.Credential{Kind: sshexec.CredKindKeyFile, KeyFile: ""}).WithDialTimeout(5 * time.Second)
		hkCtx, hkCancel := context.WithTimeout(r.Context(), 5*time.Second)
		hk, hkErr := probeRunner.FetchHostKey(hkCtx)
		hkCancel()
		probeRunner.Close()
		if hkErr != nil {
			if cred != nil {
				cred.Wipe()
			}
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": "host key recheck failed: " + hkErr.Error()})
			return
		}
		if hk.SHA256 != acceptedHK {
			if cred != nil {
				cred.Wipe()
			}
			writeJSON(w, http.StatusConflict, map[string]any{
				"error":   "host key changed since confirmation",
				"current": hk.SHA256,
			})
			return
		}
		if err := sshexec.AppendHostKey(h.knownHostsFile, hk); err != nil {
			slog.Warn("known_hosts append failed", "host", req.PublicIP, "error", err)
		}
	}

	job, err := h.jobRepo.Create(r.Context(), model.JobKindClusterNodeAdd, userID, clusterID, nil, nil, req.NodeName)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "create job: " + err.Error()})
		return
	}

	role := req.Role
	if role == "" {
		role = "osd"
	}
	if err := h.jobs.Enqueue(r.Context(), job.ID, jobs.Params{
		NodeName:       req.NodeName,
		NodePublicIP:   req.PublicIP,
		NodeRole:       role,
		SSHUser:        sshUser,
		SSHKeyFile:     keyFile,
		KnownHostsFile: h.knownHostsFile,
		// OPS-026 / PLAN-028 拓扑覆盖
		NICPrimary:    req.NICPrimary,
		NICCluster:    req.NICCluster,
		BridgeName:    req.BridgeName,
		MgmtIP:        req.MgmtIP,
		CephPubIP:     req.CephPubIP,
		CephClusterIP: req.CephClusterIP,
		SkipNetwork:   req.SkipNetwork,
		// PLAN-033 凭据
		Credential:            cred,
		AcceptedHostKeySHA256: acceptedHK,
	}); err != nil {
		_ = h.jobRepo.Finish(r.Context(), job.ID, model.JobStatusFailed, "enqueue: "+err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "enqueue: " + err.Error()})
		return
	}
	enqueued = true

	audit(r.Context(), r, "cluster.node.add", "node", 0, map[string]any{
		"cluster":   clusterName,
		"node_name": req.NodeName,
		"public_ip": req.PublicIP,
		"role":      role,
		"job_id":    job.ID,
	})
	slog.Info("cluster node add enqueued", "cluster", clusterName, "node", req.NodeName, "job_id", job.ID)
	writeJSON(w, http.StatusAccepted, map[string]any{
		"status":  "provisioning",
		"job_id":  job.ID,
		"node":    req.NodeName,
	})
}

// RemoveNode 入队 cluster.node.remove job：SSH 到 leader 跑
// scale-node.sh --remove 完成 evacuate / Ceph OSD 移除 / Incus member 退出。
//
// 路由：DELETE /api/admin/clusters/{name}/nodes/{node}
// query 参数：?leader=hostOrIP（可选，未指定时取 cluster manager.List() 的第一个 client API URL 解析出 host）
func (h *ClusterMgmtHandler) RemoveNode(w http.ResponseWriter, r *http.Request) {
	clusterName := chi.URLParam(r, "name")
	nodeName := chi.URLParam(r, "node")
	if h.jobs == nil || h.jobRepo == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "jobs runtime not configured"})
		return
	}
	if !isValidName(nodeName) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid node name"})
		return
	}
	client, ok := h.mgr.Get(clusterName)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "cluster not found"})
		return
	}
	clusterID := h.mgr.IDByName(clusterName)

	leaderHost := r.URL.Query().Get("leader")
	if leaderHost == "" {
		leaderHost = parseHostFromAPIURL(client.APIURL)
	}
	if leaderHost == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "leader host not resolvable from cluster api_url; pass ?leader=<host>"})
		return
	}

	keyFile := h.sshKeyFile
	if keyFile == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "ssh_key_file not configured (CEPH_SSH_KEY)"})
		return
	}

	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)

	job, err := h.jobRepo.Create(r.Context(), model.JobKindClusterNodeRemove, userID, clusterID, nil, nil, nodeName)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "create job: " + err.Error()})
		return
	}

	sshUser := h.sshUser
	if sshUser == "" {
		sshUser = "root"
	}

	if err := h.jobs.Enqueue(r.Context(), job.ID, jobs.Params{
		NodeName:       nodeName,
		LeaderHost:     leaderHost,
		SSHUser:        sshUser,
		SSHKeyFile:     keyFile,
		KnownHostsFile: h.knownHostsFile,
	}); err != nil {
		_ = h.jobRepo.Finish(r.Context(), job.ID, model.JobStatusFailed, "enqueue: "+err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "enqueue: " + err.Error()})
		return
	}

	audit(r.Context(), r, "cluster.node.remove", "node", 0, map[string]any{
		"cluster": clusterName,
		"node":    nodeName,
		"leader":  leaderHost,
		"job_id":  job.ID,
	})
	slog.Info("cluster node remove enqueued", "cluster", clusterName, "node", nodeName, "job_id", job.ID)
	writeJSON(w, http.StatusAccepted, map[string]any{
		"status": "provisioning",
		"job_id": job.ID,
		"node":   nodeName,
	})
}

// parseHostFromAPIURL 把 https://10.0.20.1:8443 抽出 10.0.20.1。SSH 会回到 22 端口。
func parseHostFromAPIURL(apiURL string) string {
	// 不引入 net/url 整体解析；做轻量字符串操作
	s := apiURL
	if i := strings.Index(s, "://"); i >= 0 {
		s = s[i+3:]
	}
	if i := strings.Index(s, "/"); i >= 0 {
		s = s[:i]
	}
	if i := strings.LastIndex(s, ":"); i >= 0 {
		// 仅去 :port 后缀；IPv6 含 : 需要用方括号语义，这里简化忽略
		if _, err := strconv.Atoi(s[i+1:]); err == nil {
			s = s[:i]
		}
	}
	return s
}

// SetMaintenance 把 cluster member 的 scheduler.instance 设为 manual（防新放置）
// 或 all（恢复）。OPS-024 D2。
//
// 不调用 incus cluster evacuate（保留现有 VM）；只通过 PATCH /1.0/cluster/members
// 改 config.scheduler.instance。Incus 将在新建 instance 调度时跳过 manual 节点。
func (h *ClusterMgmtHandler) SetMaintenance(w http.ResponseWriter, r *http.Request) {
	clusterName := chi.URLParam(r, "name")
	nodeName := chi.URLParam(r, "node")
	if !isValidName(nodeName) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid node name"})
		return
	}
	client, ok := h.mgr.Get(clusterName)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "cluster not found"})
		return
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if !decodeAndValidate(w, r, &req) {
		return
	}

	target := "all"
	if req.Enabled {
		target = "manual"
	}
	body, _ := json.Marshal(map[string]any{
		"config": map[string]string{
			"scheduler.instance": target,
		},
	})
	resp, err := client.APIPatch(r.Context(), fmt.Sprintf("/1.0/cluster/members/%s", url.PathEscape(nodeName)), strings.NewReader(string(body)))
	if err != nil {
		slog.Error("set maintenance failed", "node", nodeName, "enabled", req.Enabled, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if resp != nil && resp.Type == "async" && resp.Operation != "" {
		opID := extractOperationID(resp.Operation)
		if opID != "" {
			_ = client.WaitForOperation(r.Context(), opID)
		}
	}

	audit(r.Context(), r, "node.maintenance", "node", 0, map[string]any{
		"cluster": clusterName, "node": nodeName, "enabled": req.Enabled, "scheduler": target,
	})
	slog.Info("node maintenance toggled", "node", nodeName, "enabled", req.Enabled, "scheduler", target)
	writeJSON(w, http.StatusOK, map[string]any{
		"status":             "ok",
		"node":               nodeName,
		"maintenance":        req.Enabled,
		"scheduler.instance": target,
	})
}

// GenerateEnvScript 生成 cluster-env.sh 内容供运维下载（OPS-024 C2）。
//
// 安全：路由本身被 step-up 中间件保护（admin + 最近重新认证）；返回的脚本里
// 包含集群拓扑（mgmt/ceph IP），所以非 admin / 未 step-up 一律拒绝。
//
// 数据来源：
//   - 当前 cluster's `incus cluster members` API → server_name + member URL
//   - URL 解析出 mgmt IP（cluster.https_address，与 join-node.sh 一致约定）
//   - mgmt IP 末位 → 推算 pub IP（202.151.179.X，与 5ok.co 拓扑约定）
//   - role：默认前 3 个 server_name 排序后是 mon-mgr-osd，其余 osd（启发式，
//     ops 应当在交付到运维机前手工核对一次）
//
// 不在范围 V1：跨拓扑通用、ip_pool 配置、VLAN 等仅由 ops 在生成模板上手工填。
func (h *ClusterMgmtHandler) GenerateEnvScript(w http.ResponseWriter, r *http.Request) {
	clusterName := chi.URLParam(r, "name")
	client, ok := h.mgr.Get(clusterName)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "cluster not found"})
		return
	}

	rawMembers, err := client.GetClusterMembers(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "list members: " + err.Error()})
		return
	}

	type member struct {
		ServerName string `json:"server_name"`
		URL        string `json:"url"`
	}
	var members []member
	for _, raw := range rawMembers {
		var m member
		if err := json.Unmarshal(raw, &m); err == nil && m.ServerName != "" {
			members = append(members, m)
		}
	}
	// 按 server_name 排序，前 3 标 mon-mgr-osd（启发式）
	for i := 0; i < len(members); i++ {
		for j := i + 1; j < len(members); j++ {
			if members[j].ServerName < members[i].ServerName {
				members[i], members[j] = members[j], members[i]
			}
		}
	}

	var b strings.Builder
	// pma-cr fix：原版用 r.Context().Value("request_id") 没设这个 key，会被
	// fmt 渲染成 "<nil>"。改用 ISO-8601 时间戳；ops 一眼能看出文件什么时候生成的。
	fmt.Fprintf(&b, "#!/bin/bash\n# Auto-generated by IncusAdmin (OPS-024 C2) for cluster %q at %s\n",
		clusterName, time.Now().UTC().Format(time.RFC3339))
	b.WriteString("# WARN: ops should hand-verify role / ip_pools / VLAN values before deployment.\n")
	b.WriteString("# topology assumption: mgmt 10.0.10.X, ceph_pub 10.0.20.X, ceph_cluster 10.0.30.X,\n")
	b.WriteString("# pub 202.151.179.X — all using last octet of mgmt IP.\n\n")
	b.WriteString("CLUSTER_NODES=(\n")
	for i, m := range members {
		mgmt := strings.TrimPrefix(strings.TrimPrefix(m.URL, "https://"), "http://")
		if h := strings.LastIndex(mgmt, ":"); h > 0 {
			mgmt = mgmt[:h]
		}
		// 提取 mgmt IP 末位
		octet := ""
		if dot := strings.LastIndex(mgmt, "."); dot > 0 {
			octet = mgmt[dot+1:]
		}
		role := "osd"
		if i < 3 {
			role = "mon-mgr-osd"
		}
		// 5ok.co 约定的反推（无法 100% 自动，需 ops 核）
		pub := "202.151.179." + octet
		cephPub := "10.0.20." + octet
		cephClu := "10.0.30." + octet
		fmt.Fprintf(&b, "  %q  # role=%s; mgmt=%s\n",
			fmt.Sprintf("%s:%s:%s:%s:%s:%s", m.ServerName, pub, mgmt, cephPub, cephClu, role),
			role, mgmt,
		)
	}
	b.WriteString(")\n\n# 其余字段（PUBLIC_NETWORK / VLAN / Ceph 池 / OSD 加密等）保持手写于源文件。\n")
	b.WriteString("# Pull canonical cluster-env.sh from cluster/configs/cluster-env.sh in repo.\n")

	audit(r.Context(), r, "cluster.env_script_generate", "cluster", h.mgr.IDByName(clusterName), map[string]any{
		"cluster": clusterName, "members": len(members),
	})
	w.Header().Set("Content-Type", "text/x-shellscript; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\"cluster-env.sh\"")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(b.String()))
}

// memberMaintFlags 取每个 member 的 scheduler.instance / status，给 NodeTopology
// 与 ImbalanceSuggestions 共用。返回 map[server_name] -> (maintenance, evacuated)。
func memberMaintFlags(ctx context.Context, client *cluster.Client) (map[string]nodeFlags, error) {
	raws, err := client.GetClusterMembers(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[string]nodeFlags, len(raws))
	for _, raw := range raws {
		var m struct {
			ServerName string            `json:"server_name"`
			Status     string            `json:"status"`
			Config     map[string]string `json:"config"`
		}
		if err := json.Unmarshal(raw, &m); err != nil {
			continue
		}
		flags := nodeFlags{}
		if v, ok := m.Config["scheduler.instance"]; ok {
			flags.Maintenance = strings.EqualFold(v, "manual")
		}
		flags.Evacuated = strings.EqualFold(m.Status, "Evacuated")
		flags.Online = strings.EqualFold(m.Status, "Online")
		flags.Status = m.Status
		out[m.ServerName] = flags
	}
	return out, nil
}

type nodeFlags struct {
	Maintenance bool
	Evacuated   bool
	Online      bool
	Status      string
}

// NodeTopology 返回某 cluster 的节点分布快照：每节点 mem 利用率 + VM 计数 +
// 维护 / 疏散态。供 admin/nodes 顶部 strip 与 RebalancePanel 同源。
//
// 路由：GET /api/admin/clusters/{name}/nodes/topology
//
// 数据组合：scheduler 缓存（mem/cpu，60s 刷新）+ DB 聚合（VM 计数）+ Incus
// member raw（maintenance / evacuated）。
func (h *ClusterMgmtHandler) NodeTopology(w http.ResponseWriter, r *http.Request) {
	if h.scheduler == nil || h.vmRepo == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "topology not configured"})
		return
	}
	clusterName := chi.URLParam(r, "name")
	client, ok := h.mgr.Get(clusterName)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "cluster not found"})
		return
	}

	nodes := h.scheduler.GetNodes(clusterName)
	flags, _ := memberMaintFlags(r.Context(), client)

	clusterID := h.mgr.IDByName(clusterName)
	stats, err := h.vmRepo.CountVMsByNode(r.Context(), clusterID)
	if err != nil {
		slog.Warn("topology: count vms by node failed", "cluster", clusterName, "error", err)
		stats = nil
	}
	statsByNode := make(map[string]repository.NodeVMStat, len(stats))
	for _, s := range stats {
		statsByNode[s.Node] = s
	}

	type nodeOut struct {
		ServerName      string  `json:"server_name"`
		Status          string  `json:"status"`
		Message         string  `json:"message"`
		CPUTotal        int     `json:"cpu_total"`
		MemTotal        int64   `json:"mem_total"`
		MemUsed         int64   `json:"mem_used"`
		MemFree         int64   `json:"mem_free"`
		FreeRatio       float64 `json:"free_ratio"`
		LoadAverage5Min float64 `json:"load_5min"`        // PLAN-039 / OPS-042
		CPUFreeRatio    float64 `json:"cpu_free_ratio"`   // PLAN-039 / OPS-042
		DiskFreeRatio   float64 `json:"disk_free_ratio"`  // PLAN-039 / OPS-042（cluster-wide）
		Score           float64 `json:"score"`            // PLAN-039 / OPS-042
		VMCount         int     `json:"vm_count"`
		VMRunning       int     `json:"vm_running"`
		VMStopped       int     `json:"vm_stopped"`
		VMOther         int     `json:"vm_other"`
		Maintenance     bool    `json:"maintenance"`
		Evacuated       bool    `json:"evacuated"`
	}
	out := make([]nodeOut, 0, len(nodes))
	seen := make(map[string]struct{}, len(nodes))
	for _, n := range nodes {
		f := flags[n.Name]
		s := statsByNode[n.Name]
		// scheduler 已经写过 Maintenance/Evacuated；以 scheduler 为主，flags 兜底。
		maint := n.Maintenance || f.Maintenance
		evac := n.Evacuated || f.Evacuated
		out = append(out, nodeOut{
			ServerName:      n.Name,
			Status:          n.Status,
			Message:         n.Message,
			CPUTotal:        n.CPUTotal,
			MemTotal:        n.MemTotal,
			MemUsed:         n.MemUsed,
			MemFree:         n.MemFree,
			FreeRatio:       n.FreeRatio,
			LoadAverage5Min: n.LoadAverage5Min,
			CPUFreeRatio:    n.CPUFreeRatio,
			DiskFreeRatio:   n.DiskFreeRatio,
			Score:           n.Score,
			VMCount:         s.Total,
			VMRunning:       s.Running,
			VMStopped:       s.Stopped,
			VMOther:         s.Other,
			Maintenance:     maint,
			Evacuated:       evac,
		})
		seen[n.Name] = struct{}{}
	}
	// DB 里有 VM 但 scheduler 没缓存的 node（节点新加入或缓存未刷新）也补出来。
	for _, s := range stats {
		if s.Node == "" {
			continue
		}
		if _, ok := seen[s.Node]; ok {
			continue
		}
		f := flags[s.Node]
		out = append(out, nodeOut{
			ServerName:  s.Node,
			Status:      f.Status,
			VMCount:     s.Total,
			VMRunning:   s.Running,
			VMStopped:   s.Stopped,
			VMOther:     s.Other,
			Maintenance: f.Maintenance,
			Evacuated:   f.Evacuated,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"cluster": clusterName,
		"nodes":   out,
	})
}

// ImbalanceSuggestions 调 rebalance 包给出"建议迁移条目"列表。
//
// 路由：GET /api/admin/clusters/{name}/imbalance-suggestions
//
// 仅返建议 + stats，不执行迁移；前端 RebalancePanel 拿到后用户决定是否
// 一键提交到 /vms:migrate-batch。
func (h *ClusterMgmtHandler) ImbalanceSuggestions(w http.ResponseWriter, r *http.Request) {
	if h.scheduler == nil || h.vmRepo == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "rebalance not configured"})
		return
	}
	clusterName := chi.URLParam(r, "name")
	client, ok := h.mgr.Get(clusterName)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "cluster not found"})
		return
	}
	clusterID := h.mgr.IDByName(clusterName)

	rawNodes := h.scheduler.GetNodes(clusterName)
	flags, _ := memberMaintFlags(r.Context(), client)
	caps := make([]rebalance.NodeCapacity, 0, len(rawNodes))
	for _, n := range rawNodes {
		f := flags[n.Name]
		caps = append(caps, rebalance.NodeCapacity{
			Name:        n.Name,
			MemTotal:    n.MemTotal,
			MemUsed:     n.MemUsed,
			Maintenance: f.Maintenance,
			Online:      f.Online || n.Status == "Online",
		})
	}

	// pma-cr F3：与 watchdog 同源用 ListActiveForRebalance（专用最小投影），
	// 避免 ImbalanceSuggestions 与 watchdog 计算的 imbalance 不一致。
	dbVMs, err := h.vmRepo.ListActiveForRebalance(r.Context(), clusterID)
	if err != nil {
		slog.Warn("imbalance: list vms failed", "cluster", clusterName, "error", err)
		dbVMs = nil
	}
	vms := make([]rebalance.VM, 0, len(dbVMs))
	for _, v := range dbVMs {
		vms = append(vms, rebalance.VM{
			Name:     v.Name,
			Project:  v.Project,
			Node:     v.Node,
			MemoryMB: v.MemoryMB,
		})
	}

	plan := rebalance.Compute(caps, vms, rebalance.Default())
	writeJSON(w, http.StatusOK, plan)
}

// ListSystemAlerts 返当前 active 告警（PLAN-039 / OPS-044）。
// 路由：GET /api/admin/system-alerts
func (h *ClusterMgmtHandler) ListSystemAlerts(w http.ResponseWriter, r *http.Request) {
	if h.alertRepo == nil {
		writeJSON(w, http.StatusOK, map[string]any{"alerts": []any{}})
		return
	}
	alerts, err := h.alertRepo.ListActive(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if alerts == nil {
		alerts = []repository.SystemAlert{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"alerts": alerts})
}

// DismissSystemAlert admin 手工 dismiss 告警（step-up gated）。
// 路由：POST /api/admin/system-alerts/{id}/dismiss
func (h *ClusterMgmtHandler) DismissSystemAlert(w http.ResponseWriter, r *http.Request) {
	if h.alertRepo == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "alerts not configured"})
		return
	}
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)
	if err := h.alertRepo.Dismiss(r.Context(), id, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "system_alert.dismiss", "system_alert", id, nil)
	writeJSON(w, http.StatusOK, map[string]any{"status": "dismissed", "id": id})
}

// AISuggestRoles PLAN-038 / OPS-041 Phase B Tier 2 — LLM 角色推荐。
//
// 输入：probe_id（10min 缓存的探测结果引用）+ expected_role
// 输出：4 角色 ranked 推荐 + 理由 + warnings
//
// 路由：POST /api/admin/clusters/{name}/nodes/ai-suggest（admin only + step-up）
func (h *ClusterMgmtHandler) AISuggestRoles(w http.ResponseWriter, r *http.Request) {
	if h.aiProvider == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "ai disabled"})
		return
	}
	clusterName := chi.URLParam(r, "name")
	var req struct {
		ProbeID      string `json:"probe_id"      validate:"required"`
		ExpectedRole string `json:"expected_role" validate:"omitempty,oneof=osd mon-mgr-osd"`
	}
	if !decodeAndValidate(w, r, &req) {
		return
	}
	if req.ExpectedRole == "" {
		req.ExpectedRole = "osd"
	}
	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)
	if !h.allowAIRequest(userID) {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "ai rate limit (10/h) exceeded"})
		return
	}
	rec, ok := h.probeCache.get(req.ProbeID)
	if !ok || rec.info == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "probe_id expired or unknown"})
		return
	}

	// Tier 1 排序结果一并送 LLM 作 hint
	tier1 := aiassist.RankNICRoles(rec.info)

	// 集群上下文（暂用项目硬编码 CIDR；后续可从 cluster-env.sh 读）
	cc := aiassist.ClusterContext{
		NodeCount:       len(h.scheduler.GetNodes(clusterName)),
		MgmtCIDR:        "10.0.10.0/24",
		CephPublicCIDR:  "10.0.20.0/24",
		CephClusterCIDR: "10.0.30.0/24",
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	resp, sug, err := aiassist.SuggestRoleMapping(ctx, h.aiProvider, rec.info, cc, req.ExpectedRole, tier1.Roles)
	provider, model := "", ""
	if sug != nil {
		provider, model = sug.Provider, sug.Model
	}
	auditDetails := map[string]any{
		"cluster":  clusterName,
		"probe_id": req.ProbeID,
		"role":     req.ExpectedRole,
		"provider": provider,
		"model":    model,
	}
	if sug != nil {
		auditDetails["input_tokens"] = sug.UsageInputTokens
		auditDetails["output_tokens"] = sug.UsageOutputTokens
	}

	if err != nil {
		auditDetails["error"] = err.Error()
		audit(r.Context(), r, "ai.role_mapping.failed", "cluster", h.mgr.IDByName(clusterName), auditDetails)
		slog.Warn("ai role-mapping failed", "cluster", clusterName, "error", err)
		switch {
		case err == aiassist.ErrAIDisabled:
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "ai disabled"})
		case err == aiassist.ErrAITimeout:
			writeJSON(w, http.StatusGatewayTimeout, map[string]any{"error": "ai timeout"})
		default:
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		}
		return
	}
	audit(r.Context(), r, "ai.role_mapping.ok", "cluster", h.mgr.IDByName(clusterName), auditDetails)
	writeJSON(w, http.StatusOK, map[string]any{
		"recommendations": resp.Recommendations,
		"warnings":        resp.Warnings,
		"tier1":           tier1, // 让前端能 diff 显示 Tier1 vs LLM
		"provider":        provider,
		"model":           model,
	})
}

// allowAIRequest 简单内存限流（10/h/user）。
func (h *ClusterMgmtHandler) allowAIRequest(userID int64) bool {
	if userID == 0 {
		return false
	}
	now := time.Now()
	cutoff := now.Add(-time.Hour)
	h.aiRateMu.Lock()
	defer h.aiRateMu.Unlock()
	hist := h.aiRate[userID]
	keep := hist[:0]
	for _, t := range hist {
		if t.After(cutoff) {
			keep = append(keep, t)
		}
	}
	if len(keep) >= 10 {
		h.aiRate[userID] = keep
		return false
	}
	keep = append(keep, now)
	h.aiRate[userID] = keep
	return true
}

// StartProbeCacheGC 让 main 触发 probeCache 后台 GC（Session-2 F-14）。
func (h *ClusterMgmtHandler) StartProbeCacheGC(ctx context.Context, interval time.Duration) {
	if h.probeCache != nil {
		h.probeCache.StartGC(ctx, interval)
	}
}

// StartAIRateGC 在 main 启动时调一次：每 30min 清理 aiRate map 里"窗口内全空"的
// 用户 entry。Session-2 F-13 / PLAN-051 §2-K：原版只在 allowAIRequest 触发时才
// 清自己 entry，未访问的旧用户 entry 永远留 → map 单调增长。
func (h *ClusterMgmtHandler) StartAIRateGC(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 30 * time.Minute
	}
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				h.gcAIRate()
			}
		}
	}()
}

func (h *ClusterMgmtHandler) gcAIRate() {
	cutoff := time.Now().Add(-time.Hour)
	h.aiRateMu.Lock()
	defer h.aiRateMu.Unlock()
	for uid, hist := range h.aiRate {
		keep := hist[:0]
		for _, ts := range hist {
			if ts.After(cutoff) {
				keep = append(keep, ts)
			}
		}
		if len(keep) == 0 {
			delete(h.aiRate, uid)
		} else if len(keep) != len(hist) {
			h.aiRate[uid] = keep
		}
	}
}
