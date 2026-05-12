// Package promexport 暴露 Prometheus exposition 端点。
//
// PLAN-041 / INFRA-009：
//   - 默认匿名（决策 D13 = A），监听端口由现有 Server 提供
//   - 可选 Bearer：env METRICS_BEARER_TOKEN 非空时强制校验
//   - 仅业务指标（决策 D18 = A），不带 user_id label，避免租户泄漏
//   - Incus prometheus fan-out 留 v2
//
// 暴露路径：GET /api/metrics
package promexport

import (
	"crypto/subtle"
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Handler 持有自有 registry + 可选 Bearer。
type Handler struct {
	reg          *prometheus.Registry
	bearerToken  string
	httpHandler  http.Handler
}

// New 建一个新的 Prometheus registry（不污染默认 registry）。
// bearerToken 空字符串 → 匿名。
func New(reg *prometheus.Registry, bearerToken string) *Handler {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	return &Handler{
		reg:         reg,
		bearerToken: bearerToken,
		httpHandler: promhttp.HandlerFor(reg, promhttp.HandlerOpts{
			ErrorHandling: promhttp.ContinueOnError,
		}),
	}
}

// Registry 返回内置 registry，让 main.go 注册 metrics。
func (h *Handler) Registry() *prometheus.Registry { return h.reg }

// ServeHTTP 实现 http.Handler。鉴权失败返 401，不返 metrics。
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.bearerToken != "" {
		auth := r.Header.Get("Authorization")
		const prefix = "Bearer "
		if len(auth) <= len(prefix) || auth[:len(prefix)] != prefix {
			w.Header().Set("WWW-Authenticate", `Bearer realm="metrics"`)
			http.Error(w, "missing bearer", http.StatusUnauthorized)
			return
		}
		got := auth[len(prefix):]
		if subtle.ConstantTimeCompare([]byte(got), []byte(h.bearerToken)) != 1 {
			w.Header().Set("WWW-Authenticate", `Bearer realm="metrics"`)
			http.Error(w, "invalid bearer", http.StatusUnauthorized)
			return
		}
	}
	h.httpHandler.ServeHTTP(w, r)
}
