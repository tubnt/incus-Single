package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// 企业微信群机器人 sender。
//
// 与钉钉 / 飞书的关键差异：
//   - 无加签机制，仅 URL 中的 key 作为认证凭据
//   - 限流 20 条/min/机器人
//   - 推荐用 markdown 类型富文本
//
// 文档: https://developer.work.weixin.qq.com/document/path/91770

type WecomSender struct {
	client *http.Client
}

func NewWecomSender() *WecomSender {
	return &WecomSender{client: newSafeClient()}
}

func (w *WecomSender) Kind() string { return "wecom" }

type wecomConfig struct {
	WebhookURL string `json:"webhook_url"`
}

func (w *WecomSender) Send(ctx context.Context, configJSON json.RawMessage, ev AlertEvent) error {
	var cfg wecomConfig
	if err := json.Unmarshal(configJSON, &cfg); err != nil {
		return fmt.Errorf("%w: %v", ErrConfigInvalid, err)
	}
	if cfg.WebhookURL == "" {
		return fmt.Errorf("%w: webhook_url empty", ErrConfigInvalid)
	}
	if err := requireHostInList(cfg.WebhookURL, wecomHosts); err != nil {
		return fmt.Errorf("%w: %v", ErrConfigInvalid, err)
	}

	body := map[string]any{
		"msgtype": "markdown",
		"markdown": map[string]string{
			"content": formatWecomMarkdown(ev),
		},
	}
	payload, _ := json.Marshal(body)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.WebhookURL, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := w.client.Do(req)
	if err != nil {
		return fmt.Errorf("wecom post: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != 200 {
		return fmt.Errorf("wecom http %d: %s", resp.StatusCode, string(respBody))
	}
	var r struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if err := json.Unmarshal(respBody, &r); err == nil && r.ErrCode != 0 {
		return fmt.Errorf("wecom errcode %d: %s", r.ErrCode, r.ErrMsg)
	}
	return nil
}

func formatWecomMarkdown(ev AlertEvent) string {
	colorTag := ""
	switch ev.Severity {
	case "critical", "error":
		colorTag = "<font color=\"warning\">"
	case "warning":
		colorTag = "<font color=\"comment\">"
	}
	tail := ""
	if colorTag != "" {
		tail = "</font>"
	}
	if ev.Phase == "resolved" {
		colorTag = "<font color=\"info\">"
		tail = "</font>"
	}
	out := "## " + colorTag + FormatTitle(ev) + tail + "\n\n"
	if ev.Cluster != "" {
		out += "> 集群: `" + ev.Cluster + "`\n"
	}
	out += "> 类型: `" + ev.Kind + "`\n"
	out += "> 级别: `" + ev.Severity + "`\n"
	if ev.Message != "" {
		out += "\n" + ev.Message + "\n"
	}
	return out
}
