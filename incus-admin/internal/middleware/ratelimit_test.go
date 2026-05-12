package middleware

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"golang.org/x/time/rate"
)

// TestSensitiveRoutesNotInPortal ——
// pma-cr L3-3 / PLAN-051 §2-K：rateLimitSensitiveRoutes 与 /api/portal sub-router
// 必须不重叠，否则 RateLimitSensitive (Group 顶层) + RateLimit (/api/portal)
// 串联会对同一请求双重计数，违反"sensitive 与 portal 互斥"假设。
//
// 新增 sensitive 路由前，CI 会拦截重叠引入。
func TestSensitiveRoutesNotInPortal(t *testing.T) {
	for _, route := range rateLimitSensitiveRoutes {
		if strings.HasPrefix(route, "/api/portal") {
			t.Errorf("sensitive route %q overlaps /api/portal sub-router; "+
				"RateLimitSensitive + RateLimit will double-count. "+
				"Either move route out of /api/portal or refactor RateLimit "+
				"to short-circuit sensitive paths.", route)
		}
	}
}

// TestSensitiveRoutesNonEmpty 防御性：列表被误清空时立刻 fail，避免静默
// 退化到 0 个高敏端点都没限流。
func TestSensitiveRoutesNonEmpty(t *testing.T) {
	if len(rateLimitSensitiveRoutes) == 0 {
		t.Fatal("rateLimitSensitiveRoutes should not be empty; W4 sensitive limiter would be a no-op")
	}
}

// TestIsSensitiveRoute 验证 prefix 匹配语义。
func TestIsSensitiveRoute(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"/api/auth/stepup/start", true},
		{"/api/auth/stepup-callback", false}, // callback 在 Group 外，不走 RateLimitSensitive
		{"/api/admin/users:batch", true},
		{"/api/admin/users:batch?x=1", true},
		{"/api/admin/users", false},
		{"/shadow/enter", true},
		{"/shadow/exit", true},
		{"/api/portal/services", false}, // 走 RateLimit (portal 桶)
		{"/api/admin/clusters", false},
		{"/", false},
	}
	for _, tc := range cases {
		got := isSensitiveRoute(tc.path)
		if got != tc.want {
			t.Errorf("isSensitiveRoute(%q) = %v, want %v", tc.path, got, tc.want)
		}
	}
}

// TestKeyedLimiterBurst 验证 token bucket 行为：burst 内全过 + 超出立刻 429。
// 同时确认 per-key 隔离（不同 key 独立桶）。
func TestKeyedLimiterBurst(t *testing.T) {
	kl := newKeyedLimiter(rate.Limit(1), 3) // 1 rps, burst 3

	// alice 连发 3 个全过
	for i := 0; i < 3; i++ {
		ok, _, _ := kl.allow("alice")
		if !ok {
			t.Fatalf("alice req #%d should pass within burst", i+1)
		}
	}
	// 第 4 个被拒
	ok, remaining, retry := kl.allow("alice")
	if ok {
		t.Fatal("alice req #4 should be rejected after burst exhausted")
	}
	if remaining != 0 {
		t.Errorf("expected remaining=0 after burst exhausted, got %d", remaining)
	}
	if retry < 1 {
		t.Errorf("expected Retry-After >=1s when rejected, got %d", retry)
	}

	// bob 独立桶，仍可消费 3 个
	for i := 0; i < 3; i++ {
		ok, _, _ := kl.allow("bob")
		if !ok {
			t.Fatalf("bob req #%d should pass — per-key isolation broken", i+1)
		}
	}
}

// TestRateLimitHeaders 验证 RateLimit middleware 返写 IETF draft headers。
func TestRateLimitHeaders(t *testing.T) {
	// 为单测重置 portal limiter（避免污染全局）。
	oldDefault := defaultLimiter
	defer func() { defaultLimiter = oldDefault }()
	defaultLimiter = newKeyedLimiter(rate.Limit(1), 2) // 1 rps, burst 2

	h := RateLimit(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// 两个 burst 应该带 RateLimit-* 头通过
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/portal/products", nil)
		req.RemoteAddr = "1.2.3.4:9999"
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("req #%d expected 200, got %d", i+1, rr.Code)
		}
		if rr.Header().Get("RateLimit-Limit") != "2" {
			t.Errorf("req #%d RateLimit-Limit = %q, want 2", i+1, rr.Header().Get("RateLimit-Limit"))
		}
		if _, err := strconv.Atoi(rr.Header().Get("RateLimit-Remaining")); err != nil {
			t.Errorf("req #%d RateLimit-Remaining not numeric: %q", i+1, rr.Header().Get("RateLimit-Remaining"))
		}
	}

	// 第 3 个超出 burst，应返 429 + Retry-After
	req := httptest.NewRequest(http.MethodGet, "/api/portal/products", nil)
	req.RemoteAddr = "1.2.3.4:9999"
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", rr.Code)
	}
	retry, err := strconv.Atoi(rr.Header().Get("Retry-After"))
	if err != nil || retry < 1 {
		t.Errorf("Retry-After should be positive integer, got %q (err=%v)", rr.Header().Get("Retry-After"), err)
	}
}

// TestRateLimitStreamBypass 确认 SSE /stream 路径透传不限流。
func TestRateLimitStreamBypass(t *testing.T) {
	oldDefault := defaultLimiter
	defer func() { defaultLimiter = oldDefault }()
	defaultLimiter = newKeyedLimiter(rate.Limit(1), 1)

	h := RateLimit(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// burst=1 但 /stream 应该可以无限连
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/portal/jobs/42/stream", nil)
		req.RemoteAddr = "5.6.7.8:1234"
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("SSE req #%d expected 200 (stream bypass), got %d", i+1, rr.Code)
		}
	}
}

// TestRateLimitSensitiveTransparent 确认 sensitive middleware 对非高敏路径透传。
func TestRateLimitSensitiveTransparent(t *testing.T) {
	oldSensitive := sensitiveLimiter
	defer func() { sensitiveLimiter = oldSensitive }()
	sensitiveLimiter = newKeyedLimiter(rate.Limit(1), 1) // 严格限流

	h := RateLimitSensitive(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// 非 sensitive 路径——透传，不消耗 sensitive 桶
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/portal/services", nil)
		req.RemoteAddr = "9.10.11.12:1234"
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("non-sensitive req #%d expected 200, got %d", i+1, rr.Code)
		}
	}
}
