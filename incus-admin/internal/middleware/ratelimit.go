package middleware

import (
	"net"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

type rateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*visitor
	rate     int
	window   time.Duration
}

type visitor struct {
	count  int
	resetAt time.Time
}

func newRateLimiter(rate int, window time.Duration) *rateLimiter {
	rl := &rateLimiter{
		visitors: make(map[string]*visitor),
		rate:     rate,
		window:   window,
	}
	go rl.cleanup()
	return rl
}

func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	v, ok := rl.visitors[key]
	if !ok || time.Now().After(v.resetAt) {
		rl.visitors[key] = &visitor{count: 1, resetAt: time.Now().Add(rl.window)}
		return true
	}
	v.count++
	return v.count <= rl.rate
}

func (rl *rateLimiter) cleanup() {
	for {
		time.Sleep(rl.window)
		rl.mu.Lock()
		now := time.Now()
		for k, v := range rl.visitors {
			if now.After(v.resetAt) {
				delete(rl.visitors, k)
			}
		}
		rl.mu.Unlock()
	}
}

var (
	defaultLimiter = newRateLimiter(30, time.Minute)
	// Session-1 W4 / PLAN-051 §2-B：高敏端点单独 5/min。匹配前缀：
	//   /api/auth/stepup/        OIDC 重认证（攻击者可借此撞 Logto 限流）
	//   /api/admin/users:batch   批量改角色 / 充值
	//   /shadow/                 admin 影子登录
	//
	// pma-cr L-i4 注释假设：sensitive 列表与 /api/portal 不重叠，所以
	// RateLimitSensitive (Group 顶层) 与 RateLimit (/api/portal sub-router)
	// 串联不会对同一请求双重计数。新增 sensitive 路由前先核对——若把
	// /api/portal/* 加入 sensitive list，需要在 RateLimit 顶部 short-circuit
	// "已被 sensitive 处理过" 避免双扣。
	sensitiveLimiter = newRateLimiter(5, time.Minute)
	rateLimitSensitiveRoutes  = []string{"/api/auth/stepup/", "/api/admin/users:batch", "/shadow/"}
)

// trustedProxiesEnv 解析 TRUSTED_PROXIES（CIDR 或 IP，逗号分隔）。
// 默认空 = 不信任任何前置代理。生产部署 Cloudflare 时填入 CF 网段。
var (
	trustedProxiesOnce sync.Once
	trustedProxiesNets []*net.IPNet
)

func loadTrustedProxies() []*net.IPNet {
	trustedProxiesOnce.Do(func() {
		raw := strings.TrimSpace(os.Getenv("TRUSTED_PROXIES"))
		if raw == "" {
			return
		}
		for _, p := range strings.Split(raw, ",") {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			if !strings.Contains(p, "/") {
				if strings.Contains(p, ":") {
					p += "/128"
				} else {
					p += "/32"
				}
			}
			_, nw, err := net.ParseCIDR(p)
			if err == nil {
				trustedProxiesNets = append(trustedProxiesNets, nw)
			}
		}
	})
	return trustedProxiesNets
}

var ipRe = regexp.MustCompile(`^[0-9a-fA-F:.]+$`)

// realClientIP 在 RemoteAddr 属于 TRUSTED_PROXIES 时从 X-Forwarded-For 摘出
// 真实客户端 IP；否则用 RemoteAddr 自身（防伪造）。emergency listener 不调用，
// 它通过 SSH tunnel 直连，没有前置代理。
func realClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	remoteIP := net.ParseIP(host)
	trusted := loadTrustedProxies()
	for _, nw := range trusted {
		if nw.Contains(remoteIP) {
			xff := r.Header.Get("X-Forwarded-For")
			if xff != "" {
				// XFF: client, proxy1, proxy2 — 取最左侧（client）
				parts := strings.SplitN(xff, ",", 2)
				ip := strings.TrimSpace(parts[0])
				if ip != "" && ipRe.MatchString(ip) {
					return ip
				}
			}
			break
		}
	}
	return host
}

// isSensitiveRoute 返回 true 表示该 path 走 5/min 严格限流（其它路径走 30/min）。
func isSensitiveRoute(path string) bool {
	for _, p := range rateLimitSensitiveRoutes {
		if strings.HasPrefix(path, p) {
			return true
		}
	}
	return false
}

// RateLimit 给 /api/portal 路径的默认 30/min 限流。仅在 portal sub-router
// 挂载；其它路径（admin / auth / shadow）由 RateLimitSensitive 单独覆盖。
func RateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// PLAN-025：SSE 长连接不应该被请求频率限流。job 流就一条连接 + 心跳，
		// 即使浏览器多 tab，per-user conn cap 在 JobsHandler 层另行控制。
		if strings.HasSuffix(r.URL.Path, "/stream") {
			next.ServeHTTP(w, r)
			return
		}
		// Session-1 W4 / PLAN-051 §2-B：登录前阶段（无 user email）从
		// X-Forwarded-For 取真实 IP，避免 Cloudflare/oauth2-proxy 把所有未登录
		// 请求 RemoteAddr 收敛到代理本地地址 → 全集群共享一个桶 → 单用户登录被
		// 攻击者借机耗尽配额。
		key := realClientIP(r)
		if email, _ := r.Context().Value(CtxUserEmail).(string); email != "" {
			key = email
		}
		if !defaultLimiter.allow(key) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"error":"rate limit exceeded"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RateLimitSensitive 给高敏端点的独立 5/min 限流。pma-cr H-2 修复：原版把
// sensitive 判定塞在 RateLimit 内部，但 RateLimit 仅挂在 /api/portal，
// /api/auth/stepup/ + /api/admin/users:batch + /shadow/ 都走不到。
// 把这个 middleware 挂到 r.Group（ProxyAuth 之后），按 path prefix 仅对
// 高敏路径生效，其它路径透传不动。
func RateLimitSensitive(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isSensitiveRoute(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		key := realClientIP(r)
		if email, _ := r.Context().Value(CtxUserEmail).(string); email != "" {
			key = email
		}
		if !sensitiveLimiter.allow(key) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"error":"sensitive rate limit exceeded"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}
