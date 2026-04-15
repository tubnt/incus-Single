package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
)

type ctxKey string

const (
	CtxUserEmail ctxKey = "user_email"
	CtxUserRole  ctxKey = "user_role"
	CtxUserID    ctxKey = "user_id"
)

func ProxyAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		email := r.Header.Get("X-Auth-Request-Email")
		if email == "" {
			email = r.Header.Get("X-Forwarded-Email")
		}
		if email == "" {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), CtxUserEmail, strings.ToLower(strings.TrimSpace(email)))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func RequireRole(role string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userRole, _ := r.Context().Value(CtxUserRole).(string)
			if userRole != role {
				slog.Warn("access denied", "required", role, "actual", userRole, "path", r.URL.Path)
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r.WithContext(r.Context()))
		})
	}
}

func UserFromEmail(userLookup func(ctx context.Context, email string) (int64, string, error)) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			email, _ := r.Context().Value(CtxUserEmail).(string)
			if email == "" {
				next.ServeHTTP(w, r)
				return
			}

			userID, role, err := userLookup(r.Context(), email)
			if err != nil {
				slog.Error("user lookup failed", "email", email, "error", err)
				http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
				return
			}

			ctx := r.Context()
			ctx = context.WithValue(ctx, CtxUserID, userID)
			ctx = context.WithValue(ctx, CtxUserRole, role)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
