package portal

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/incuscloud/incus-admin/internal/middleware"
	"github.com/incuscloud/incus-admin/internal/model"
	"github.com/incuscloud/incus-admin/internal/repository"
	"github.com/incuscloud/incus-admin/internal/service/jobs"
)

const (
	// 单用户同时 SSE 连接上限。每个浏览器 tab 占一个；4 已足够覆盖
	// "购买进行中 + 切到详情页" 的常见多 tab 用法，多余直接 429。
	maxSSEConnPerUser = 4
	// 心跳间隔：防止反代 idle 断线 + 客户端检测连接活性。
	sseKeepalive = 15 * time.Second
)

type JobsHandler struct {
	jobs    *repository.ProvisioningJobRepo
	vms     *repository.VMRepo
	runtime *jobs.Runtime

	connMu sync.Mutex
	conns  map[int64]int // userID → 当前活跃 SSE 连接数
}

func NewJobsHandler(jobRepo *repository.ProvisioningJobRepo, vms *repository.VMRepo, rt *jobs.Runtime) *JobsHandler {
	return &JobsHandler{
		jobs:    jobRepo,
		vms:     vms,
		runtime: rt,
		conns:   make(map[int64]int),
	}
}

func (h *JobsHandler) PortalRoutes(r chi.Router) {
	r.Get("/jobs/{id}", h.GetJob)
	r.Get("/jobs/{id}/stream", h.StreamJob)
}

// GetJob 返回单 job 详情：状态 + 全部 step + 完成时的 result（含密码 / IP）。
// 仅 owner 或 admin 可见。
func (h *JobsHandler) GetJob(w http.ResponseWriter, r *http.Request) {
	jobID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || jobID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid job id"})
		return
	}

	job, err := h.jobs.GetByID(r.Context(), jobID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if job == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "job not found"})
		return
	}

	if !h.canAccess(r, job) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "access denied"})
		return
	}

	resp := map[string]any{"job": job}
	// 终态成功时把 vm 凭据并入 result，让前端 SecretReveal 一次拿到
	if job.Status == model.JobStatusSucceeded && job.VMID != nil {
		vm, _ := h.vms.GetByID(r.Context(), *job.VMID)
		if vm != nil {
			result := map[string]any{
				"vm_id":   vm.ID,
				"vm_name": vm.Name,
				"node":    vm.Node,
				"ip":      vm.IP,
			}
			if vm.Password != nil {
				result["password"] = *vm.Password
				result["username"] = "ubuntu"
			}
			resp["result"] = result
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// StreamJob 是 SSE 端点。客户端可通过 Last-Event-ID header 重连续传。
//
// Headers：
//   - Content-Type: text/event-stream
//   - Cache-Control: no-cache
//   - X-Accel-Buffering: no（绕过 nginx / Caddy 默认 buffer）
//   - Connection: keep-alive
//
// 流控：
//   - per-user ≤ maxSSEConnPerUser，超出 429
//   - 每 15s 推一行注释 ":keepalive\n\n"，防 idle 关连接
//   - job 终态后 publish Terminal=true 事件 → handler 收到后写一条 event:done 关闭
func (h *JobsHandler) StreamJob(w http.ResponseWriter, r *http.Request) {
	jobID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || jobID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid job id"})
		return
	}

	job, err := h.jobs.GetByID(r.Context(), jobID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if job == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "job not found"})
		return
	}
	if !h.canAccess(r, job) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "access denied"})
		return
	}

	userID, _ := r.Context().Value(middleware.CtxUserID).(int64)
	if !h.acquireSlot(userID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":"too many SSE connections; close other tabs"}`))
		return
	}
	defer h.releaseSlot(userID)

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "streaming unsupported"})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	// pma-cr HIGH+MEDIUM：subscribe-FIRST 修两个 race window：
	//   1) ListSteps → terminal check 之间 job 完成 → terminal 推给空 subs → 客户端永远收不到 done
	//   2) ListSteps → Subscribe 之间 step N+1 通过 broker 推出 → 客户端漏掉
	// 先订阅再回放：broker 收到的事件全部留在 buffered channel；ListSteps 重复
	// 会推同一 seq，前端 reducer 已 upsert by seq 自然去重。
	ch, cancel := h.runtime.Broker().Subscribe(jobID)
	defer cancel()

	// 1) Last-Event-ID 重连：从 DB 重放该 seq 之后的所有 step，让客户端断线重连不丢事件
	lastSeq := -1
	if v := r.Header.Get("Last-Event-ID"); v != "" {
		if n, perr := strconv.Atoi(v); perr == nil && n >= 0 {
			lastSeq = n
		}
	}
	steps, err := h.jobs.ListSteps(r.Context(), jobID, lastSeq)
	if err != nil {
		slog.Error("list steps for replay failed", "job_id", jobID, "error", err)
	}
	for _, s := range steps {
		if !writeStepEvent(w, flusher, s) {
			return
		}
	}

	// 2) 重新拉一次 job 看是否在我们 Subscribe 之前已经终态。是就发 done 退出。
	jobNow, err := h.jobs.GetByID(r.Context(), jobID)
	if err == nil && jobNow != nil && isTerminalStatus(jobNow.Status) {
		writeDoneEvent(w, flusher, jobNow.Status)
		return
	}

	keep := time.NewTicker(sseKeepalive)
	defer keep.Stop()

	clientGone := r.Context().Done()
	for {
		select {
		case <-clientGone:
			return
		case <-keep.C:
			if _, werr := w.Write([]byte(":keepalive\n\n")); werr != nil {
				return
			}
			flusher.Flush()
		case ev, ok := <-ch:
			if !ok {
				return
			}
			if ev.Terminal {
				writeDoneEvent(w, flusher, ev.Status)
				return
			}
			// 普通 step 事件
			if !writeStepEvent(w, flusher, ev.Step) {
				return
			}
		}
	}
}

func (h *JobsHandler) canAccess(r *http.Request, job *model.ProvisioningJob) bool {
	role, _ := r.Context().Value(middleware.CtxUserRole).(string)
	if role == model.RoleAdmin {
		return true
	}
	uid, _ := r.Context().Value(middleware.CtxUserID).(int64)
	return uid > 0 && uid == job.UserID
}

func (h *JobsHandler) acquireSlot(userID int64) bool {
	if userID <= 0 {
		return false
	}
	h.connMu.Lock()
	defer h.connMu.Unlock()
	if h.conns[userID] >= maxSSEConnPerUser {
		return false
	}
	h.conns[userID]++
	return true
}

func (h *JobsHandler) releaseSlot(userID int64) {
	if userID <= 0 {
		return
	}
	h.connMu.Lock()
	defer h.connMu.Unlock()
	if h.conns[userID] > 0 {
		h.conns[userID]--
	}
	if h.conns[userID] == 0 {
		delete(h.conns, userID)
	}
}

func writeStepEvent(w http.ResponseWriter, flusher http.Flusher, s model.ProvisioningJobStep) bool {
	payload, err := json.Marshal(s)
	if err != nil {
		return true // 跳过坏事件继续流
	}
	if _, werr := fmt.Fprintf(w, "id: %d\nevent: step\ndata: %s\n\n", s.Seq, payload); werr != nil {
		return false
	}
	flusher.Flush()
	return true
}

func writeDoneEvent(w http.ResponseWriter, flusher http.Flusher, status string) {
	payload, _ := json.Marshal(map[string]any{"status": status})
	_, _ = fmt.Fprintf(w, "event: done\ndata: %s\n\n", payload)
	flusher.Flush()
}

func isTerminalStatus(s string) bool {
	switch s {
	case model.JobStatusSucceeded, model.JobStatusFailed, model.JobStatusPartial:
		return true
	}
	return false
}

