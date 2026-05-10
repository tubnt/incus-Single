package notify

import (
	"context"
	"encoding/json"
	"errors"
)

// AlertEvent 是 dispatcher 喂给 Sender 的统一负载。各 Sender 自行格式化为
// 钉钉 / 飞书 / 企微 / 通用 webhook / 邮件 message。
//
// Phase = firing → 通知"告警发生"；Phase = resolved → 通知"告警已恢复"。
// 字段保持小，避免序列化大对象后泄漏租户信息。
type AlertEvent struct {
	GroupKey  string         `json:"group_key"`
	Kind      string         `json:"kind"`     // vm_cpu / cluster_node_offline / ...
	Severity  string         `json:"severity"` // info / warning / error / critical
	Phase     string         `json:"phase"`    // firing / resolved
	Cluster   string         `json:"cluster,omitempty"`
	ScopeKind string         `json:"scope_kind,omitempty"`
	ScopeID   *int64         `json:"scope_id,omitempty"`
	Title     string         `json:"title"`    // 一句话摘要
	Message   string         `json:"message"`  // 详情描述（多行 markdown）
	Extra     map[string]any `json:"extra,omitempty"`
}

// Sender 是各通道的统一接口。Send 失败由 dispatcher 决定是否重试。
type Sender interface {
	// Kind 返回通道类型常量（与 repository.NotifyChannel.Kind 对齐）。
	Kind() string
	// Send 发送一条告警事件。configJSON 是该 channel 的解密 config，由 sender
	// 自行 unmarshal。返回 nil = 成功；返回 error 由 dispatcher 写 last_error。
	Send(ctx context.Context, configJSON json.RawMessage, ev AlertEvent) error
}

// ErrConfigInvalid 是 sender 解析 config 失败时返回的标志错误。
// dispatcher 见此错误时不重试（重试也修不好），直接 mark failed。
var ErrConfigInvalid = errors.New("notify: invalid channel config")

// FormatTitle 给所有 sender 用的统一标题。Phase=resolved 时前置"[已恢复]"。
func FormatTitle(ev AlertEvent) string {
	prefix := ""
	switch ev.Phase {
	case "resolved":
		prefix = "[已恢复] "
	case "firing":
		switch ev.Severity {
		case "critical":
			prefix = "[严重] "
		case "error":
			prefix = "[错误] "
		case "warning":
			prefix = "[警告] "
		case "info":
			prefix = "[通知] "
		}
	}
	if ev.Title == "" {
		return prefix + ev.Kind
	}
	return prefix + ev.Title
}
