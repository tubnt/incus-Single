package aiassist

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/incuscloud/incus-admin/internal/service/nodeprobe"
)

// PLAN-038 / OPS-041 端到端集成测试：用 httptest 模拟 anthropic API，验证
// tool_use forcing wire + JSON schema 解析 + hallucination 检查 + Disabled
// fallback。无需真 API key。

// fakeAnthropicHandler 接收 anthropic Messages 请求，返一个固定的 tool_use 响应。
// returnInput 是 LLM 返回的 JSON（注入到 content[0].input）。
func fakeAnthropicHandler(t *testing.T, returnInput string) http.HandlerFunc {
	t.Helper()
	return func(w http.ResponseWriter, r *http.Request) {
		// 验证请求 header
		if r.Header.Get("x-api-key") == "" {
			http.Error(w, `{"error":{"message":"missing api key"}}`, http.StatusUnauthorized)
			return
		}
		if r.Header.Get("anthropic-version") == "" {
			http.Error(w, `{"error":{"message":"missing version"}}`, http.StatusBadRequest)
			return
		}

		// 验证 body 含 tool_use forcing
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), `"submit_structured_response"`) {
			http.Error(w, `{"error":{"message":"missing tool"}}`, http.StatusBadRequest)
			return
		}
		if !strings.Contains(string(body), `"tool_choice"`) {
			http.Error(w, `{"error":{"message":"missing tool_choice"}}`, http.StatusBadRequest)
			return
		}

		// 返 anthropic 标准 tool_use 响应
		resp := map[string]any{
			"content": []map[string]any{{
				"type":  "tool_use",
				"name":  "submit_structured_response",
				"input": json.RawMessage(returnInput),
			}},
			"usage":       map[string]any{"input_tokens": 123, "output_tokens": 45},
			"stop_reason": "tool_use",
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func TestAnthropicProvider_ToolUseRoundTrip(t *testing.T) {
	canned := `{"recommendations":[{"role":"mgmt","nic":"enp1s0","confidence":0.9,"rationale":"已配 mgmt 网段"}],"warnings":[]}`
	srv := httptest.NewServer(fakeAnthropicHandler(t, canned))
	defer srv.Close()

	p, err := NewAnthropicProvider("test-key", "claude-test", srv.URL, 10)
	if err != nil {
		t.Fatalf("NewAnthropicProvider: %v", err)
	}
	if p.Name() != "anthropic" {
		t.Errorf("Name=%q want anthropic", p.Name())
	}
	sug, err := p.Suggest(context.Background(), "system prompt", []byte(`{"foo":"bar"}`), []byte(`{"type":"object"}`))
	if err != nil {
		t.Fatalf("Suggest: %v", err)
	}
	if string(sug.JSON) != canned {
		t.Errorf("JSON=%q want %q", sug.JSON, canned)
	}
	if sug.UsageInputTokens != 123 || sug.UsageOutputTokens != 45 {
		t.Errorf("usage tokens lost; got %+v", sug)
	}
	if sug.Provider != "anthropic" || sug.Model != "claude-test" {
		t.Errorf("metadata=%+v", sug)
	}
}

func TestAnthropicProvider_5xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":{"message":"upstream broken"}}`, http.StatusInternalServerError)
	}))
	defer srv.Close()
	p, _ := NewAnthropicProvider("k", "m", srv.URL, 5)
	_, err := p.Suggest(context.Background(), "s", []byte("{}"), []byte("{}"))
	if err == nil || !strings.Contains(err.Error(), "500") {
		t.Errorf("expected 500 error; got %v", err)
	}
}

func TestAnthropicProvider_NoToolUseInResponse(t *testing.T) {
	// 模型返了纯 text 而非 tool_use → 应当 ErrAISchemaInvalid
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"content": []map[string]any{{"type": "text", "text": "I refuse to use the tool"}},
			"usage":   map[string]any{"input_tokens": 1, "output_tokens": 1},
		})
	}))
	defer srv.Close()
	p, _ := NewAnthropicProvider("k", "m", srv.URL, 5)
	_, err := p.Suggest(context.Background(), "s", []byte("{}"), []byte("{}"))
	if !errors.Is(err, ErrAISchemaInvalid) {
		t.Errorf("expected ErrAISchemaInvalid; got %v", err)
	}
}

func TestSuggestRoleMapping_HappyPath(t *testing.T) {
	canned := `{"recommendations":[
		{"role":"mgmt","nic":"enp1s0","confidence":0.9,"rationale":"配置匹配"},
		{"role":"ceph_cluster","nic":"ens3","confidence":0.85,"rationale":"25G 高速链路"},
		{"role":"bridge_source","nic":"eno1","confidence":0.95,"rationale":"默认路由"},
		{"role":"ceph_public","nic":"ens3","confidence":0.7,"rationale":"复用 ceph 网卡"}
	],"warnings":["NUMA 不对称"]}`
	srv := httptest.NewServer(fakeAnthropicHandler(t, canned))
	defer srv.Close()
	p, _ := NewAnthropicProvider("k", "m", srv.URL, 10)

	info := &nodeprobe.NodeInfo{
		Hostname: "node1",
		Interfaces: []nodeprobe.Interface{
			{Name: "enp1s0", LinkUp: true},
			{Name: "ens3", LinkUp: true, SpeedMbps: 25000},
			{Name: "eno1", LinkUp: true, IsDefaultRoute: true},
		},
	}
	resp, sug, err := SuggestRoleMapping(context.Background(), p, info, ClusterContext{NodeCount: 5}, "osd", nil)
	if err != nil {
		t.Fatalf("SuggestRoleMapping: %v", err)
	}
	if len(resp.Recommendations) != 4 {
		t.Errorf("expected 4 recs, got %d", len(resp.Recommendations))
	}
	if sug.UsageInputTokens != 123 {
		t.Errorf("token usage not propagated")
	}
	if len(resp.Warnings) != 1 {
		t.Errorf("warnings lost")
	}
}

func TestSuggestRoleMapping_HallucinationDetected(t *testing.T) {
	// LLM 推荐一个不存在的 NIC（hallucination） → 必须报 ErrAISchemaInvalid
	canned := `{"recommendations":[{"role":"mgmt","nic":"phantom-nic","confidence":1.0,"rationale":"made up"}],"warnings":[]}`
	srv := httptest.NewServer(fakeAnthropicHandler(t, canned))
	defer srv.Close()
	p, _ := NewAnthropicProvider("k", "m", srv.URL, 10)

	info := &nodeprobe.NodeInfo{Interfaces: []nodeprobe.Interface{{Name: "real-nic", LinkUp: true}}}
	_, _, err := SuggestRoleMapping(context.Background(), p, info, ClusterContext{}, "osd", nil)
	if !errors.Is(err, ErrAISchemaInvalid) {
		t.Fatalf("expected ErrAISchemaInvalid (hallucination); got %v", err)
	}
	if !strings.Contains(err.Error(), "phantom-nic") {
		t.Errorf("error message should mention hallucinated NIC; got %v", err)
	}
}

func TestSuggestRoleMapping_InvalidRole(t *testing.T) {
	canned := `{"recommendations":[{"role":"invalid_role","nic":"enp1s0","confidence":0.5,"rationale":"x"}],"warnings":[]}`
	srv := httptest.NewServer(fakeAnthropicHandler(t, canned))
	defer srv.Close()
	p, _ := NewAnthropicProvider("k", "m", srv.URL, 10)

	info := &nodeprobe.NodeInfo{Interfaces: []nodeprobe.Interface{{Name: "enp1s0", LinkUp: true}}}
	_, _, err := SuggestRoleMapping(context.Background(), p, info, ClusterContext{}, "osd", nil)
	if !errors.Is(err, ErrAISchemaInvalid) {
		t.Fatalf("expected ErrAISchemaInvalid (bad role enum); got %v", err)
	}
}

func TestDiagnose_HappyPath(t *testing.T) {
	canned := `{
		"category": "netplan_revert",
		"root_cause": "netplan apply 90s 后超时被自动回滚",
		"suggested_fix_steps": [
			{"step": "检查 bond slave 链路", "command_template": "ip link show enp1s0f0"},
			{"step": "重试加入"}
		],
		"safe_to_auto_retry": false,
		"requires_manual": "确认网线物理连接"
	}`
	srv := httptest.NewServer(fakeAnthropicHandler(t, canned))
	defer srv.Close()
	p, _ := NewAnthropicProvider("k", "m", srv.URL, 10)

	resp, sug, err := Diagnose(context.Background(), p, DiagnoseInput{
		StepFailed:      "network_config",
		LastStderrLines: "[network_config] netplan apply timed out",
	})
	if err != nil {
		t.Fatalf("Diagnose: %v", err)
	}
	if resp.Category != "netplan_revert" {
		t.Errorf("category=%q", resp.Category)
	}
	if len(resp.SuggestedFixSteps) != 2 {
		t.Errorf("steps=%d", len(resp.SuggestedFixSteps))
	}
	if resp.SafeToAutoRetry {
		t.Errorf("safe_to_auto_retry should be false")
	}
	if sug.UsageInputTokens != 123 {
		t.Errorf("token usage missing")
	}
}

func TestDiagnose_StderrTruncation(t *testing.T) {
	// >40KB stderr 应当被截断
	huge := strings.Repeat("x", 50_000)
	captured := ""
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		captured = string(body)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"content": []map[string]any{{
				"type": "tool_use",
				"name": "submit_structured_response",
				"input": json.RawMessage(`{
					"category":"unknown","root_cause":"x","suggested_fix_steps":[],
					"safe_to_auto_retry":false,"requires_manual":""
				}`),
			}},
			"usage": map[string]any{"input_tokens": 1, "output_tokens": 1},
		})
	}))
	defer srv.Close()
	p, _ := NewAnthropicProvider("k", "m", srv.URL, 10)
	_, _, err := Diagnose(context.Background(), p, DiagnoseInput{
		StepFailed: "x", LastStderrLines: huge,
	})
	if err != nil {
		t.Fatalf("Diagnose: %v", err)
	}
	// 请求 body 不应携带原始 50KB 串
	if strings.Count(captured, "x") > 41_000 {
		t.Errorf("stderr should be truncated to ~40KB; captured ~%d 'x'", strings.Count(captured, "x"))
	}
}

func TestDisabledProvider_AllPathsReturnDisabled(t *testing.T) {
	p := NewDisabledProvider()
	if p.Name() != "disabled" {
		t.Errorf("Name=%q", p.Name())
	}
	_, err := p.Suggest(context.Background(), "s", []byte("{}"), []byte("{}"))
	if !errors.Is(err, ErrAIDisabled) {
		t.Errorf("Suggest err=%v want ErrAIDisabled", err)
	}
	// 上层 SuggestRoleMapping / Diagnose 也应返 ErrAIDisabled 让 handler 走 503
	_, _, err = SuggestRoleMapping(context.Background(), p, &nodeprobe.NodeInfo{}, ClusterContext{}, "osd", nil)
	if !errors.Is(err, ErrAIDisabled) {
		t.Errorf("SuggestRoleMapping err=%v want ErrAIDisabled", err)
	}
	_, _, err = Diagnose(context.Background(), p, DiagnoseInput{})
	if !errors.Is(err, ErrAIDisabled) {
		t.Errorf("Diagnose err=%v want ErrAIDisabled", err)
	}
}

func TestRedactString_BeforeAnthropicSend(t *testing.T) {
	// 验证 redact 实际防止敏感内容溜进 prompt
	captured := ""
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		captured = string(body)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"content": []map[string]any{{
				"type": "tool_use", "name": "submit_structured_response",
				"input": json.RawMessage(`{"category":"unknown","root_cause":"x","suggested_fix_steps":[],"safe_to_auto_retry":false,"requires_manual":""}`),
			}},
			"usage": map[string]any{"input_tokens": 1, "output_tokens": 1},
		})
	}))
	defer srv.Close()
	p, _ := NewAnthropicProvider("k", "m", srv.URL, 10)

	// 模拟 handler 走的路径：redact 后再 Diagnose
	rawStderr := "Failed at 202.151.179.5; mac 10:66:6a:ad:2c:12; token=AAAAB3NzaC1yc2EAAAADAQABAAABAQABCDEFGHIJKLMNOPQRSTUV"
	_, _, err := Diagnose(context.Background(), p, DiagnoseInput{
		StepFailed:      "x",
		LastStderrLines: RedactString(rawStderr),
	})
	if err != nil {
		t.Fatalf("Diagnose: %v", err)
	}
	if strings.Contains(captured, "202.151.179.5") {
		t.Errorf("raw IPv4 leaked; body=%q", captured[:200])
	}
	if strings.Contains(captured, "10:66:6a:ad:2c:12") {
		t.Errorf("raw MAC leaked")
	}
	if strings.Contains(captured, "AAAAB3NzaC1") {
		t.Errorf("ssh-key style token leaked")
	}
}
