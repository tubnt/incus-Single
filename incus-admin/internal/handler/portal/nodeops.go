package portal

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/incuscloud/incus-admin/internal/sshexec"
)

type NodeOpsHandler struct {
	defaultUser   string
	defaultKeyFile string
}

func NewNodeOpsHandler(defaultUser, defaultKeyFile string) *NodeOpsHandler {
	return &NodeOpsHandler{defaultUser: defaultUser, defaultKeyFile: defaultKeyFile}
}

func (h *NodeOpsHandler) AdminRoutes(r chi.Router) {
	r.Post("/nodes/test-ssh", h.TestSSH)
	r.Post("/nodes/exec", h.ExecCommand)
}

func (h *NodeOpsHandler) TestSSH(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Host    string `json:"host"`
		User    string `json:"user"`
		KeyFile string `json:"key_file"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid body"})
		return
	}
	if req.Host == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "host required"})
		return
	}
	if req.User == "" { req.User = h.defaultUser }
	if req.KeyFile == "" { req.KeyFile = h.defaultKeyFile }

	runner := sshexec.New(req.Host, req.User, req.KeyFile)
	out, err := runner.Run(r.Context(), "hostname && uname -r && uptime")
	if err != nil {
		slog.Error("SSH test failed", "host", req.Host, "error", err)
		writeJSON(w, http.StatusOK, map[string]any{
			"status": "failed",
			"error":  err.Error(),
			"output": out,
		})
		return
	}

	audit(r.Context(), r, "node.ssh_test", "node", 0, map[string]any{"host": req.Host})
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"output": out,
	})
}

func (h *NodeOpsHandler) ExecCommand(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Host    string `json:"host"`
		User    string `json:"user"`
		KeyFile string `json:"key_file"`
		Command string `json:"command"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid body"})
		return
	}
	if req.Host == "" || req.Command == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "host and command required"})
		return
	}
	if req.User == "" { req.User = h.defaultUser }
	if req.KeyFile == "" { req.KeyFile = h.defaultKeyFile }

	if !isValidCommand(req.Command) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "command not allowed"})
		return
	}

	runner := sshexec.New(req.Host, req.User, req.KeyFile)
	out, err := runner.Run(r.Context(), req.Command)

	audit(r.Context(), r, "node.exec", "node", 0, map[string]any{
		"host": req.Host, "command": req.Command, "error": fmt.Sprint(err),
	})

	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"status": "error", "output": out, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "output": out})
}

func isValidCommand(cmd string) bool {
	allowed := []string{
		"hostname", "uname", "uptime", "free", "df", "lsblk",
		"incus", "ceph", "systemctl status", "ip addr", "cat /etc/os-release",
	}
	for _, a := range allowed {
		if len(cmd) >= len(a) && cmd[:len(a)] == a {
			return true
		}
	}
	return false
}
