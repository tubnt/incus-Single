package portal

import (
	"encoding/json"
	"strings"
	"testing"
)

// SEC-002 / OPS-028 回归保护：admin VM list/detail 响应必须裁掉
// config.user.cloud-init（含明文初始 root 密码）。
func TestRedactInstanceMap(t *testing.T) {
	raw := []byte(`{
		"name": "vm-test",
		"config": {
			"limits.cpu": "1",
			"user.cloud-init": "#cloud-config\npassword: secret123\n"
		},
		"expanded_config": {
			"user.cloud-init": "#cloud-config\npassword: secret456\n"
		}
	}`)

	got := redactInstanceJSON(raw)

	var m map[string]any
	if err := json.Unmarshal(got, &m); err != nil {
		t.Fatalf("redacted result not valid JSON: %v", err)
	}

	cfg := m["config"].(map[string]any)
	if _, present := cfg["user.cloud-init"]; present {
		t.Error("config.user.cloud-init should be redacted")
	}
	if cfg["limits.cpu"] != "1" {
		t.Errorf("config.limits.cpu must be preserved, got %v", cfg["limits.cpu"])
	}

	exp := m["expanded_config"].(map[string]any)
	if _, present := exp["user.cloud-init"]; present {
		t.Error("expanded_config.user.cloud-init should be redacted")
	}

	if strings.Contains(string(got), "password: secret") {
		t.Errorf("redacted output still contains password: %s", string(got))
	}

	if m["name"] != "vm-test" {
		t.Errorf("name must be preserved, got %v", m["name"])
	}
}

// 防御性：decode 失败时返回 raw（fail-open）但要 warn。
func TestRedactInstanceJSON_BadInput(t *testing.T) {
	raw := json.RawMessage([]byte("not valid json"))
	got := redactInstanceJSON(raw)
	if string(got) != string(raw) {
		t.Errorf("bad input must pass through raw, got %s", string(got))
	}
}

// 空 instances 不分配新切片。
func TestRedactInstanceList_Empty(t *testing.T) {
	if redactInstanceList(nil) != nil {
		t.Error("nil input should return nil")
	}
	got := redactInstanceList([]json.RawMessage{})
	if len(got) != 0 {
		t.Errorf("empty input should return empty, got len=%d", len(got))
	}
}

// 没有 cloud-init 字段时不报错也不污染其他字段。
func TestRedactInstanceMap_NoSensitiveFields(t *testing.T) {
	raw := []byte(`{"name":"vm-clean","config":{"limits.cpu":"2"}}`)
	got := redactInstanceJSON(raw)
	var m map[string]any
	_ = json.Unmarshal(got, &m)
	cfg := m["config"].(map[string]any)
	if cfg["limits.cpu"] != "2" {
		t.Errorf("clean config altered: %v", cfg)
	}
}
