package portal

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/ssh"

	"github.com/incuscloud/incus-admin/internal/auth"
	"github.com/incuscloud/incus-admin/internal/middleware"
	"github.com/incuscloud/incus-admin/internal/model"
	"github.com/incuscloud/incus-admin/internal/repository"
)

// NodeCredentialHandler exposes admin CRUD for SSH credentials used to
// bootstrap new cluster nodes (PLAN-033 / OPS-039).
//
// Routes are mounted under /api/admin and protected by step-up (see
// middleware.sensitiveRoutes).
type NodeCredentialHandler struct {
	repo *repository.NodeCredentialRepo
}

func NewNodeCredentialHandler(repo *repository.NodeCredentialRepo) *NodeCredentialHandler {
	return &NodeCredentialHandler{repo: repo}
}

func (h *NodeCredentialHandler) AdminRoutes(r chi.Router) {
	r.Get("/node-credentials", h.List)
	r.Post("/node-credentials", h.Create)
	r.Delete("/node-credentials/{id}", h.Delete)
}

type nodeCredentialView struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	Kind        string  `json:"kind"`
	Fingerprint *string `json:"fingerprint,omitempty"`
	CreatedBy   int64   `json:"created_by"`
	CreatedAt   string  `json:"created_at"`
	LastUsedAt  *string `json:"last_used_at,omitempty"`
}

func toView(c *repository.NodeCredential) nodeCredentialView {
	v := nodeCredentialView{
		ID:        c.ID,
		Name:      c.Name,
		Kind:      c.Kind,
		CreatedBy: c.CreatedBy,
		CreatedAt: c.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	}
	if c.Fingerprint.Valid {
		s := c.Fingerprint.String
		v.Fingerprint = &s
	}
	if c.LastUsedAt.Valid {
		s := c.LastUsedAt.Time.UTC().Format("2006-01-02T15:04:05Z")
		v.LastUsedAt = &s
	}
	return v
}

func (h *NodeCredentialHandler) List(w http.ResponseWriter, r *http.Request) {
	ownerID, role := actor(r)
	if ownerID == 0 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	scope := r.URL.Query().Get("scope") // "all" for super-admin all-rows view
	var (
		rows []repository.NodeCredential
		err  error
	)
	if scope == "all" && role == model.RoleAdmin {
		rows, err = h.repo.ListAll(r.Context())
	} else {
		rows, err = h.repo.ListByOwner(r.Context(), ownerID)
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	out := make([]nodeCredentialView, 0, len(rows))
	for i := range rows {
		out = append(out, toView(&rows[i]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"credentials": out})
}

func (h *NodeCredentialHandler) Create(w http.ResponseWriter, r *http.Request) {
	ownerID, _ := actor(r)
	if ownerID == 0 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var req struct {
		Name     string `json:"name"     validate:"required,max=120"`
		Kind     string `json:"kind"     validate:"required,oneof=password private_key"`
		Password string `json:"password" validate:"omitempty,max=2048"`
		KeyData  string `json:"key_data" validate:"omitempty,max=32768"`
	}
	if !decodeAndValidate(w, r, &req) {
		return
	}

	var (
		plaintext   string
		fingerprint *string
	)
	switch req.Kind {
	case "password":
		if req.Password == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "password is required"})
			return
		}
		plaintext = req.Password
	case "private_key":
		if req.KeyData == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "key_data is required"})
			return
		}
		signer, perr := ssh.ParsePrivateKey([]byte(req.KeyData))
		if perr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid private key: " + perr.Error()})
			return
		}
		fp := sshFingerprintSHA256(signer.PublicKey())
		fingerprint = &fp
		plaintext = req.KeyData
	}

	ciphertext, err := auth.EncryptPassword(plaintext)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "encrypt: " + err.Error()})
		return
	}

	cred, err := h.repo.Create(r.Context(), ownerID, strings.TrimSpace(req.Name), req.Kind, ciphertext, fingerprint)
	if err != nil {
		// unique violation surfaces as a generic error from pq; map to 409
		if isUniqueViolation(err) {
			writeJSON(w, http.StatusConflict, map[string]any{"error": "credential name already used"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	audit(r.Context(), r, "node.credential.create", "node_credential", cred.ID, map[string]any{
		"name": cred.Name, "kind": cred.Kind,
	})
	slog.Info("node credential created", "id", cred.ID, "name", cred.Name, "kind", cred.Kind, "owner", ownerID)
	writeJSON(w, http.StatusCreated, map[string]any{"credential": toView(cred)})
}

func (h *NodeCredentialHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ownerID, role := actor(r)
	if ownerID == 0 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid id"})
		return
	}
	requireOwner := role != model.RoleAdmin
	if err := h.repo.Delete(r.Context(), id, requireOwner, ownerID); err != nil {
		if errors.Is(err, repository.ErrNodeCredentialNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	audit(r.Context(), r, "node.credential.delete", "node_credential", id, nil)
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted", "id": id})
}

func actor(r *http.Request) (int64, string) {
	uid, _ := r.Context().Value(middleware.CtxUserID).(int64)
	role, _ := r.Context().Value(middleware.CtxUserRole).(string)
	return uid, role
}

// sshFingerprintSHA256 mirrors `ssh-keygen -lf` output: "SHA256:<base64-no-padding>".
func sshFingerprintSHA256(pub ssh.PublicKey) string {
	sum := sha256.Sum256(pub.Marshal())
	return "SHA256:" + strings.TrimRight(base64.StdEncoding.EncodeToString(sum[:]), "=")
}

// isUniqueViolation pattern-matches Postgres' SQLSTATE 23505 without pulling
// pq just for the constant.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "23505") || strings.Contains(s, "duplicate key")
}
