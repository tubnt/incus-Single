package middleware

import (
	"net"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// OPS-049：把固定窗口换成 token bucket（golang.org/x/time/rate）。
//
// 行业基线（per-user authenticated API）：
//   - DigitalOcean: 5000/h + 250/min burst（sliding window）
//   - Linode:      1600/min 写 / 200/min 分页 GET（token bucket）
//   - Vultr:       1800/min (30 req/s) token bucket
//   - k8s/GCP/Istio/Cloudflare：均 token bucket
// 共识：token bucket = 云原生默认，允许短 burst + 强制长期平均，
// burst ≈ 2-3× sustained rate，必须返 IETF draft RateLimit-* headers。
//
// 旧实现（fixed window 30/min）有两个公认缺陷：
//  1) 跨界 2x burst 漏洞（攻击者可在窗口边界双倍突破）
//  2) 共享桶被 SPA 顺带 8-15 req 烧光，正常用户开第 3 台 VM 直接 429
//
// 当前参数（对照 DO + Vultr 中位档）：
//   - portal default:  5 req/s sustained, 30 burst → 长期 ~300/min
//   - sensitive:       1 req/s sustained,  5 burst → 长期 ~60/min
//                      （stepup / users:batch / shadow，行为同旧版长期速率）

type limiterEntry struct {
	lim      *rate.Limiter
	lastSeen time.Time
}

// keyedLimiter 维护一个 key→token bucket 的映射，并定期清理空闲 key。
// 不直接复用 x/time/rate 单实例，因为限流必须 per-key（per-user）。
type keyedLimiter struct {
	mu       sync.Mutex
	visitors map[string]*limiterEntry
	rps      rate.Limit
	burst    int
}

func newKeyedLimiter(rps rate.Limit, burst int) *keyedLimiter {
	kl := &keyedLimiter{
		visitors: make(map[string]*limiterEntry),
		rps:      rps,
		burst:    burst,
	}
	go kl.cleanup()
	return kl
}

// allow 返回是否允许 + 剩余 token + 距 burst 恢复满的秒数。
// 后两个返回值用于填 RateLimit-Remaining / RateLimit-Reset / Retry-After。
//
// 用 AllowN 而非 ReserveN：AllowN 立刻返 bool（允/不允），不预留时间槽，
// 被拒的请求不会饿死后面的请求；ReserveN 适合"等到 token 再放行"场景。
func (kl *keyedLimiter) allow(key string) (ok bool, remaining int, resetSec int) {
	kl.mu.Lock()
	e, found := kl.visitors[key]
	if !found {
		e = &limiterEntry{lim: rate.NewLimiter(kl.rps, kl.burst)}
		kl.visitors[key] = e
	}
	e.lastSeen = time.Now()
	lim := e.lim
	kl.mu.Unlock()

	now := time.Now()
	ok = lim.AllowN(now, 1)
	tokens := lim.TokensAt(now)
	if tokens < 0 {
		tokens = 0
	}
	remaining = int(tokens)

	// 距 burst 恢复满的秒数（用于 RateLimit-Reset）。
	refill := float64(kl.burst) - tokens
	if refill < 0 {
		refill = 0
	}
	rps := float64(kl.rps)
	if rps <= 0 {
		rps = 1
	}
	resetSec = int(refill / rps)
	if !ok && resetSec < 1 {
		resetSec = 1
	}
	return ok, remaining, resetSec
}

func (kl *keyedLimiter) cleanup() {
	tick := time.NewTicker(10 * time.Minute)
	defer tick.Stop()
	for range tick.C {
		cutoff := time.Now().Add(-30 * time.Minute)
		kl.mu.Lock()
		for k, e := range kl.visitors {
			if e.lastSeen.Before(cutoff) {
				delete(kl.visitors, k)
			}
		}
		kl.mu.Unlock()
	}
}

var (
	// portal 默认桶：5 req/s sustained，burst 30。
	// SPA 单页加载典型 8-15 req，burst 30 留 2× 余量；长期等效 300/min，
	// 仍远低于 DO 250/min burst（公网 IaaS）水平。
	defaultLimiter = newKeyedLimiter(rate.Limit(5), 30)

	// sensitive 桶：1 req/s sustained，burst 5。长期等效 60/min，
	// 兼顾人类点击节奏 + 防自动化扫描。
	//
	// Session-1 W4 / PLAN-051 §2-B：高敏端点单独桶。匹配前缀：
	//   /api/auth/stepup/        OIDC 重认证（攻击者可借此撞 Logto 限流）
	//   /api/admin/users:batch   批量改角色 / 充值
	//   /shadow/                 admin 影子登录
	//
	// pma-cr L-i4 假设：sensitive 列表与 /api/portal 不重叠，所以
	// RateLimitSensitive (Group 顶层) 与 RateLimit (/api/portal sub-router)
	// 串联不会对同一请求双重计数（ratelimit_test.go 保证）。
	sensitiveLimiter         = newKeyedLimiter(rate.Limit(1), 5)
	rateLimitSensitiveRoutes = []string{"/api/auth/stepup/", "/api/admin/users:batch", "/shadow/"}
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

// isSensitiveRoute 返回 true 表示该 path 走 sensitive 桶（1 rps + burst 5）。
func isSensitiveRoute(path string) bool {
	for _, p := range rateLimitSensitiveRoutes {
		if strings.HasPrefix(path, p) {
			return true
		}
	}
	return false
}

// clientKey 优先用登录后 email，未登录用真实客户端 IP。
func clientKey(r *http.Request) string {
	if email, _ := r.Context().Value(CtxUserEmail).(string); email != "" {
		return email
	}
	return realClientIP(r)
}

// writeRateLimitHeaders 写 IETF draft-ietf-httpapi-ratelimit-headers 头。
// 现代客户端（Go SDK / fetch）都识别这套标准头；429 时再补 Retry-After。
// limit 从 keyedLimiter.burst 读，保证 header 与桶配置一致（避免常量漂移）。
func writeRateLimitHeaders(w http.ResponseWriter, limit, remaining, resetSec int) {
	w.Header().Set("RateLimit-Limit", strconv.Itoa(limit))
	w.Header().Set("RateLimit-Remaining", strconv.Itoa(remaining))
	w.Header().Set("RateLimit-Reset", strconv.Itoa(resetSec))
}

// RateLimit 挂在 /api/portal sub-router；token bucket 5 rps + burst 30。
// SSE `/stream` 透传不限（per-user conn cap 由 JobsHandler 自己管）。
func RateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/stream") {
			next.ServeHTTP(w, r)
			return
		}
		key := clientKey(r)
		ok, remaining, resetSec := defaultLimiter.allow(key)
		writeRateLimitHeaders(w, defaultLimiter.burst, remaining, resetSec)
		if !ok {
			w.Header().Set("Retry-After", strconv.Itoa(resetSec))
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":"rate limit exceeded"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RateLimitSensitive 挂在 Group 顶层（ProxyAuth 之后），仅对前缀匹配的
// 高敏路径生效，其它路径透传。token bucket 1 rps + burst 5。
//
// pma-cr H-2 修复：原版把 sensitive 判定塞在 RateLimit 内部，但 RateLimit
// 仅挂在 /api/portal，/api/auth/stepup/ + /api/admin/users:batch + /shadow/
// 都走不到。把这个 middleware 挂到 r.Group 顶层后才覆盖全栈。
func RateLimitSensitive(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isSensitiveRoute(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		key := clientKey(r)
		ok, remaining, resetSec := sensitiveLimiter.allow(key)
		writeRateLimitHeaders(w, sensitiveLimiter.burst, remaining, resetSec)
		if !ok {
			w.Header().Set("Retry-After", strconv.Itoa(resetSec))
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":"sensitive rate limit exceeded"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}
