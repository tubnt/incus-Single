// Package auth handles the step-up authentication OIDC round-trip.
//
// Two endpoints:
//   - GET /api/auth/stepup/start?rd=<return URL>
//     Signs the return URL into the OIDC state parameter and 302 redirects to
//     Logto with prompt=login + max_age=0 so the user goes through full
//     re-authentication (including MFA if Logto enforces it).
//
//   - GET /api/auth/stepup-callback?code=...&state=...
//     Lives on oauth2-proxy's skip_auth_routes allowlist so Logto can reach it
//     without a session cookie. Verifies the state, exchanges the code for
//     tokens, verifies id_token signature, matches the user by email, and
//     updates users.stepup_auth_at before 302'ing back to rd.
package auth

import (
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/incuscloud/incus-admin/internal/auth"
	"github.com/incuscloud/incus-admin/internal/repository"
)

const (
	// State param TTL: Logto auth flow should finish well within this.
	stateTTL = 10 * time.Minute
)

// pkceStore Session-1 O3 / PLAN-051 §2-B：state → code_verifier 内存映射。
// state 已经是签名过的 nonce + expiry；用 state 作 key 取 verifier 安全。
// 单实例部署假设；多实例部署需要外置 Redis（OPS-047 跟踪）。
type pkceStore struct {
	mu    sync.Mutex
	items map[string]pkceEntry
}

type pkceEntry struct {
	verifier  string
	expiresAt time.Time
}

func newPKCEStore() *pkceStore {
	return &pkceStore{items: make(map[string]pkceEntry)}
}

func (s *pkceStore) put(state, verifier string, ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.gcLocked()
	s.items[state] = pkceEntry{verifier: verifier, expiresAt: time.Now().Add(ttl)}
}

func (s *pkceStore) take(state string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.gcLocked()
	v, ok := s.items[state]
	if !ok {
		return ""
	}
	delete(s.items, state)
	return v.verifier
}

func (s *pkceStore) gcLocked() {
	now := time.Now()
	for k, v := range s.items {
		if now.After(v.expiresAt) {
			delete(s.items, k)
		}
	}
}

type Handler struct {
	oidc        *auth.OIDCClient
	userRepo    *repository.UserRepo
	stateSecret []byte
	pkce        *pkceStore
}

func NewHandler(oidcClient *auth.OIDCClient, userRepo *repository.UserRepo, stateSecret string) *Handler {
	return &Handler{
		oidc:        oidcClient,
		userRepo:    userRepo,
		stateSecret: []byte(stateSecret),
		pkce:        newPKCEStore(),
	}
}

// Start redirects the user to Logto with prompt=login, carrying the target
// path in a signed state parameter so the callback can resume the flow.
func (h *Handler) Start(w http.ResponseWriter, r *http.Request) {
	rd := r.URL.Query().Get("rd")
	if rd == "" || !strings.HasPrefix(rd, "/") {
		// Only allow relative paths so the state can't be turned into an open redirect.
		rd = "/"
	}
	state, err := auth.SignState(h.stateSecret, rd, stateTTL)
	if err != nil {
		slog.Error("stepup: sign state", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	// Session-1 O3：生成 PKCE pair，verifier 留在 server-side store（state 作 key）
	verifier, challenge, perr := auth.GeneratePKCE()
	if perr != nil {
		slog.Error("stepup: generate pkce", "error", perr)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	h.pkce.put(state, verifier, stateTTL)
	http.Redirect(w, r, h.oidc.StepUpAuthURL(state, challenge), http.StatusFound)
}

// Callback is Logto's redirect target. It completes the step-up by marking
// users.stepup_auth_at and bouncing the browser back to the original rd.
func (h *Handler) Callback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()

	if errCode := q.Get("error"); errCode != "" {
		slog.Warn("stepup: OIDC error", "error", errCode, "description", q.Get("error_description"))
		http.Error(w, "authentication failed", http.StatusBadRequest)
		return
	}

	code := q.Get("code")
	state := q.Get("state")
	if code == "" || state == "" {
		http.Error(w, "missing code or state", http.StatusBadRequest)
		return
	}

	rd, err := auth.VerifyState(h.stateSecret, state)
	if err != nil {
		slog.Warn("stepup: verify state", "error", err)
		http.Error(w, "invalid state", http.StatusBadRequest)
		return
	}

	// Session-1 O3：取出 verifier；缺失 / 过期视为不合法（攻击者无法伪造 verifier）
	verifier := h.pkce.take(state)
	claims, err := h.oidc.VerifyCode(ctx, code, verifier)
	if err != nil {
		slog.Warn("stepup: verify code", "error", err)
		http.Error(w, "authentication failed", http.StatusBadRequest)
		return
	}

	if claims.Email == "" {
		slog.Warn("stepup: id_token missing email claim", "sub", claims.Sub)
		http.Error(w, "authentication failed", http.StatusBadRequest)
		return
	}

	// Find the application user by email. If the user logged in for the first
	// time through step-up (unlikely — step-up only fires for sensitive ops
	// accessible to already-known users), we don't auto-create here.
	user, err := h.userRepo.GetByEmail(ctx, strings.ToLower(claims.Email))
	if err != nil {
		slog.Error("stepup: lookup user", "email", claims.Email, "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if user == nil {
		slog.Warn("stepup: no matching user", "email", claims.Email)
		http.Error(w, "unknown user", http.StatusForbidden)
		return
	}

	authTime := time.Unix(claims.AuthTime, 0)
	if err := h.userRepo.SetStepUpAuthAt(ctx, user.ID, authTime); err != nil {
		slog.Error("stepup: persist auth time", "user_id", user.ID, "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	slog.Info("stepup: completed", "user_id", user.ID, "email", user.Email, "auth_time", authTime)

	// Only allow relative-path redirects to block open-redirect abuse.
	if !strings.HasPrefix(rd, "/") {
		rd = "/"
	}
	http.Redirect(w, r, rd, http.StatusFound)
}

