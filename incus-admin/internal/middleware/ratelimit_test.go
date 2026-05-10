package middleware

import (
	"strings"
	"testing"
)

// TestSensitiveRoutesNotInPortal ——
// pma-cr L3-3 / PLAN-051 §2-K：rateLimitSensitiveRoutes 与 /api/portal sub-router
// 必须不重叠，否则 RateLimitSensitive (Group 顶层) + RateLimit (/api/portal)
// 串联会对同一请求双重计数，违反"5/min sensitive 与 30/min portal 互斥"假设。
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
		{"/api/portal/services", false}, // 走 RateLimit (30/min)
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
