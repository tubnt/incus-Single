package portal

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/incuscloud/incus-admin/internal/auth"
	"github.com/incuscloud/incus-admin/internal/middleware"
	"github.com/incuscloud/incus-admin/internal/service/nodeprobe"
	"github.com/incuscloud/incus-admin/internal/sshexec"
)

// Phase B3 (PLAN-033 / OPS-039) — TOFU host-key probe + inventory probe.
// Both routes are mounted by ClusterMgmtHandler.AdminRoutes; this file owns
// the implementation, the per-user rate limiter, and the probe_id cache.

const (
	probeIDTTL          = 10 * time.Minute
	probeRatePerMin     = 6
	probeRateBurst      = 6
	hostKeyProbeTimeout = 5 * time.Second
	probeTimeout        = 15 * time.Second
)

// probeRecord is what we cache across the wizard's "explore → confirm →
// submit" hops so AddNode can validate the user really saw the same data.
type probeRecord struct {
	createdAt     time.Time
	host          string
	port          int
	sshUser       string
	credentialID  int64 // 0 if inline
	hostKeySHA256 string
	info          *nodeprobe.NodeInfo
}

// probeCache is a tiny TTL map. We rely on the wizard finishing within 10
// minutes; otherwise the operator re-probes (which is cheap and explicit).
type probeCache struct {
	mu      sync.Mutex
	records map[string]probeRecord
}

func newProbeCache() *probeCache { return &probeCache{records: make(map[string]probeRecord)} }

func (c *probeCache) put(rec probeRecord) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.gcLocked()
	id := newProbeID()
	c.records[id] = rec
	return id
}

func (c *probeCache) get(id string) (probeRecord, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.gcLocked()
	rec, ok := c.records[id]
	return rec, ok
}

func (c *probeCache) gcLocked() {
	cutoff := time.Now().Add(-probeIDTTL)
	for k, v := range c.records {
		if v.createdAt.Before(cutoff) {
			delete(c.records, k)
		}
	}
}

func newProbeID() string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return "p_" + hex.EncodeToString(b[:])
}

// rateLimiter is a per-user token bucket; tokens replenish at probeRatePerMin
// per minute up to probeRateBurst.
type rateLimiter struct {
	mu     sync.Mutex
	tokens map[int64]rateState
}

type rateState struct {
	count    float64
	lastSeen time.Time
}

func newRateLimiter() *rateLimiter { return &rateLimiter{tokens: make(map[int64]rateState)} }

func (l *rateLimiter) allow(userID int64) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	st, ok := l.tokens[userID]
	if !ok {
		st = rateState{count: float64(probeRateBurst), lastSeen: now}
	}
	elapsed := now.Sub(st.lastSeen).Seconds()
	st.count = minF(float64(probeRateBurst), st.count+elapsed*float64(probeRatePerMin)/60.0)
	st.lastSeen = now
	if st.count < 1 {
		l.tokens[userID] = st
		return false
	}
	st.count--
	l.tokens[userID] = st
	return true
}

func minF(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// ProbeHostKey TCP-dials the target and captures its SSH host key without
// authenticating. Returns SHA256 fingerprint for operator confirmation.
//
// Route: POST /api/admin/clusters/{name}/nodes/probe-host-key (step-up gated)
func (h *ClusterMgmtHandler) ProbeHostKey(w http.ResponseWriter, r *http.Request) {
	uid, _ := r.Context().Value(middleware.CtxUserID).(int64)
	if uid == 0 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if !h.probeRate.allow(uid) {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "probe rate limit exceeded"})
		return
	}
	var req struct {
		Host string `json:"host" validate:"required,hostname_rfc1123|ip"`
		Port int    `json:"port" validate:"omitempty,min=1,max=65535"`
		User string `json:"user" validate:"omitempty,max=64"`
	}
	if !decodeAndValidate(w, r, &req) {
		return
	}
	hostPort := req.Host
	if req.Port > 0 {
		hostPort = fmt.Sprintf("%s:%d", req.Host, req.Port)
	}
	user := req.User
	if user == "" {
		user = "root"
	}

	runner := sshexec.NewWithCredential(hostPort, user, sshexec.Credential{Kind: sshexec.CredKindKeyFile, KeyFile: ""}).
		WithDialTimeout(hostKeyProbeTimeout)
	defer runner.Close()

	ctx, cancel := contextTimeout(r, hostKeyProbeTimeout)
	defer cancel()
	info, err := runner.FetchHostKey(ctx)
	if err != nil {
		audit(r.Context(), r, "node.probe.host_key.failed", "node", 0, map[string]any{
			"host": req.Host, "error": err.Error(),
		})
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "host key probe failed: " + err.Error()})
		return
	}
	audit(r.Context(), r, "node.probe.host_key", "node", 0, map[string]any{
		"host": req.Host, "fingerprint": info.SHA256, "key_type": info.Type,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"host":         req.Host,
		"port":         portOrDefault(req.Port),
		"key_type":     info.Type,
		"fingerprint":  info.SHA256,
	})
}

// ProbeNode runs probe-node.sh on the target after the user accepted the host
// key fingerprint. Caches the result by probe_id for the AddNode submission.
//
// Route: POST /api/admin/clusters/{name}/nodes/probe (step-up gated)
func (h *ClusterMgmtHandler) ProbeNode(w http.ResponseWriter, r *http.Request) {
	uid, _ := r.Context().Value(middleware.CtxUserID).(int64)
	if uid == 0 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if !h.probeRate.allow(uid) {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "probe rate limit exceeded"})
		return
	}
	var req struct {
		Host                 string `json:"host"                       validate:"required,hostname_rfc1123|ip"`
		Port                 int    `json:"port"                       validate:"omitempty,min=1,max=65535"`
		User                 string `json:"user"                       validate:"omitempty,max=64"`
		CredentialID         int64  `json:"credential_id"              validate:"omitempty,min=1"`
		InlineKind           string `json:"inline_kind"                validate:"omitempty,oneof=password private_key"`
		InlinePassword       string `json:"inline_password"            validate:"omitempty,max=2048"`
		InlineKeyData        string `json:"inline_key_data"            validate:"omitempty,max=32768"`
		AcceptedHostKeySHA   string `json:"accepted_host_key_sha256"   validate:"required,startswith=SHA256:"`
	}
	if !decodeAndValidate(w, r, &req) {
		return
	}

	cred, credID, err := h.resolveCredential(r, uid, req.CredentialID, req.InlineKind, req.InlinePassword, req.InlineKeyData)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	defer cred.Wipe()

	hostPort := req.Host
	if req.Port > 0 {
		hostPort = fmt.Sprintf("%s:%d", req.Host, req.Port)
	}
	user := req.User
	if user == "" {
		user = "root"
	}

	// Re-verify host key matches what the user accepted earlier (TOCTOU
	// guard). One extra TCP round-trip is cheap relative to the probe itself.
	verifyRunner := sshexec.NewWithCredential(hostPort, user, sshexec.Credential{Kind: sshexec.CredKindKeyFile, KeyFile: ""}).
		WithDialTimeout(hostKeyProbeTimeout)
	verifyCtx, verifyCancel := contextTimeout(r, hostKeyProbeTimeout)
	defer verifyCancel()
	hk, err := verifyRunner.FetchHostKey(verifyCtx)
	verifyRunner.Close()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "host key recheck failed: " + err.Error()})
		return
	}
	if hk.SHA256 != req.AcceptedHostKeySHA {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":           "host key changed since confirmation",
			"current":         hk.SHA256,
			"previously_seen": req.AcceptedHostKeySHA,
		})
		return
	}

	runner := sshexec.NewWithCredential(hostPort, user, *cred).WithDialTimeout(probeTimeout)
	defer runner.Close()

	ctx, cancel := contextTimeout(r, probeTimeout)
	defer cancel()
	info, err := nodeprobe.Probe(ctx, runner)
	if err != nil {
		audit(r.Context(), r, "node.probe.failed", "node", 0, map[string]any{
			"host": req.Host, "error": err.Error(),
		})
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "probe failed: " + err.Error()})
		return
	}

	if credID > 0 {
		_ = h.nodeCredRepo.TouchUsed(r.Context(), credID)
	}

	rec := probeRecord{
		createdAt:     time.Now(),
		host:          req.Host,
		port:          portOrDefault(req.Port),
		sshUser:       user,
		credentialID:  credID,
		hostKeySHA256: hk.SHA256,
		info:          info,
	}
	probeID := h.probeCache.put(rec)

	audit(r.Context(), r, "node.probe.ok", "node", 0, map[string]any{
		"host":          req.Host,
		"hostname":      info.Hostname,
		"interfaces":    len(info.Interfaces),
		"probe_id":      probeID,
		"incus_present": info.IncusInstalled,
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"probe_id":    probeID,
		"node":        info,
		"fingerprint": hk.SHA256,
	})
}

// resolveCredential turns either credential_id or inline fields into a Credential.
// On success returns a fresh Credential the caller should Wipe; the int64 is the
// row id (0 when inline).
func (h *ClusterMgmtHandler) resolveCredential(r *http.Request, ownerID, credID int64, inlineKind, password, keyData string) (*sshexec.Credential, int64, error) {
	if credID > 0 {
		if h.nodeCredRepo == nil {
			return nil, 0, errors.New("credentials store not configured")
		}
		row, err := h.nodeCredRepo.GetForUse(r.Context(), credID, false, ownerID)
		if err != nil {
			return nil, 0, fmt.Errorf("load credential: %w", err)
		}
		plaintext, err := auth.DecryptPassword(row.Ciphertext)
		if err != nil {
			return nil, 0, fmt.Errorf("decrypt credential: %w", err)
		}
		return credentialFrom(row.Kind, plaintext), row.ID, nil
	}
	if inlineKind == "" {
		return nil, 0, errors.New("credential_id or inline credential required")
	}
	if inlineKind == "password" {
		if password == "" {
			return nil, 0, errors.New("inline_password is required")
		}
		return &sshexec.Credential{Kind: sshexec.CredKindPassword, Password: password}, 0, nil
	}
	if inlineKind == "private_key" {
		if keyData == "" {
			return nil, 0, errors.New("inline_key_data is required")
		}
		return &sshexec.Credential{Kind: sshexec.CredKindPrivateKey, KeyData: []byte(keyData)}, 0, nil
	}
	return nil, 0, fmt.Errorf("unsupported inline_kind %q", inlineKind)
}

func credentialFrom(kind, plaintext string) *sshexec.Credential {
	switch kind {
	case "password":
		return &sshexec.Credential{Kind: sshexec.CredKindPassword, Password: plaintext}
	case "private_key":
		return &sshexec.Credential{Kind: sshexec.CredKindPrivateKey, KeyData: []byte(plaintext)}
	}
	return nil
}

func portOrDefault(p int) int {
	if p <= 0 {
		return 22
	}
	return p
}

// contextTimeout layers a per-request deadline on top of the http context so
// even slow downstream calls cannot exceed the probe envelope.
func contextTimeout(r *http.Request, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), d)
}
