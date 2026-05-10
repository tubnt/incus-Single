package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// 通用 Webhook sender：把 AlertEvent 直接 POST 到客户配置的 URL。
//
// 安全：
//   - URL 必须 https
//   - dial 前 IP 校验拒绝私有 / 链路本地 / loopback / CGNAT
//   - 不跟随 redirect
//   - 可选 Bearer 鉴权 + 自定义 headers

type WebhookSender struct {
	client *http.Client
}

func NewWebhookSender() *WebhookSender {
	return &WebhookSender{client: newSafeClient()}
}

func (w *WebhookSender) Kind() string { return "webhook" }

type webhookConfig struct {
	URL     string            `json:"url"`
	Method  string            `json:"method,omitempty"`  // 默认 POST
	Headers map[string]string `json:"headers,omitempty"` // 自定义 header
	Bearer  string            `json:"bearer,omitempty"`  // Bearer token，写到 Authorization
}

func (w *WebhookSender) Send(ctx context.Context, configJSON json.RawMessage, ev AlertEvent) error {
	var cfg webhookConfig
	if err := json.Unmarshal(configJSON, &cfg); err != nil {
		return fmt.Errorf("%w: %v", ErrConfigInvalid, err)
	}
	if cfg.URL == "" {
		return fmt.Errorf("%w: url empty", ErrConfigInvalid)
	}
	if err := requireHTTPS(cfg.URL); err != nil {
		return fmt.Errorf("%w: %v", ErrConfigInvalid, err)
	}

	method := cfg.Method
	if method == "" {
		method = http.MethodPost
	}

	payload, _ := json.Marshal(ev)
	req, err := http.NewRequestWithContext(ctx, method, cfg.URL, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("User-Agent", "incus-admin-alerts/1.0")
	if cfg.Bearer != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.Bearer)
	}
	for k, v := range cfg.Headers {
		req.Header.Set(k, v)
	}

	resp, err := w.client.Do(req)
	if err != nil {
		return fmt.Errorf("webhook %s: %w", method, err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	// 200-299 视为成功；redirect (3xx) 由 CheckRedirect 直接返回 last response，
	// 我们在这里把 3xx 也视为失败，避免静默接受未跟踪重定向。
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook http %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}
