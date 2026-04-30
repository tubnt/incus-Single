package portal

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/incuscloud/incus-admin/internal/cluster"
	"github.com/incuscloud/incus-admin/internal/config"
	"github.com/incuscloud/incus-admin/internal/middleware"
	"github.com/incuscloud/incus-admin/internal/model"
	"github.com/incuscloud/incus-admin/internal/repository"
	"github.com/incuscloud/incus-admin/internal/service/jobs"
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
}

func NewClusterMgmtHandler(mgr *cluster.Manager) *ClusterMgmtHandler {
	return &ClusterMgmtHandler{mgr: mgr}
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
	// OPS-024 D2 maintenance mode
	r.Post("/clusters/{name}/nodes/{node}/maintenance", h.SetMaintenance)
	// OPS-024 C2 cluster-env.sh 生成（step-up gated；middleware 配置）
	r.Get("/clusters/{name}/env-script", h.GenerateEnvScript)
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
	resp, err := client.APIGet(r.Context(), fmt.Sprintf("/1.0/cluster/members/%s", nodeName))
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
		"instances": nodeInstances,
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
	resp, err := client.APIPost(r.Context(), fmt.Sprintf("/1.0/cluster/members/%s/state", nodeName), evacuateBody)
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
	resp, err := client.APIPost(r.Context(), fmt.Sprintf("/1.0/cluster/members/%s/state", nodeName), restoreBody)
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
	keyFile := req.SSHKeyFile
	if keyFile == "" {
		keyFile = h.sshKeyFile
	}
	if keyFile == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "ssh_key_file required (or configure server-wide CEPH_SSH_KEY)"})
		return
	}

	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)

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
	}); err != nil {
		_ = h.jobRepo.Finish(r.Context(), job.ID, model.JobStatusFailed, "enqueue: "+err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "enqueue: " + err.Error()})
		return
	}

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
	resp, err := client.APIPatch(r.Context(), fmt.Sprintf("/1.0/cluster/members/%s", nodeName), strings.NewReader(string(body)))
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
	fmt.Fprintf(&b, "#!/bin/bash\n# Auto-generated by IncusAdmin (OPS-024 C2) for cluster %q at %s\n", clusterName, r.Context().Value("request_id"))
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
