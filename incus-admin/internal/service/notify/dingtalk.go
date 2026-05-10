package notify

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// 钉钉自定义机器人 sender。
//
// 安全：
//   - host 必须在 dingtalkHosts 白名单（oapi.dingtalk.com）
//   - sign_secret 非空时拼 HmacSHA256(secret, ts+\n+secret) 加签（钉钉 2026 文档）
//   - timestamp 必须 ±1 小时内（钉钉服务端校验）
//   - 限流 20 条/min/机器人；超过返 errorCode=130101 → dispatcher 重试
//
// 文档: https://open.dingtalk.com/document/robots/customize-robot-security-settings

type DingtalkSender struct {
	client *http.Client
}

func NewDingtalkSender() *DingtalkSender {
	return &DingtalkSender{client: newSafeClient()}
}

func (d *DingtalkSender) Kind() string { return "dingtalk" }

type dingtalkConfig struct {
	WebhookURL string `json:"webhook_url"`
	SignSecret string `json:"sign_secret"`
}

func (d *DingtalkSender) Send(ctx context.Context, configJSON json.RawMessage, ev AlertEvent) error {
	var cfg dingtalkConfig
	if err := json.Unmarshal(configJSON, &cfg); err != nil {
		return fmt.Errorf("%w: %v", ErrConfigInvalid, err)
	}
	if cfg.WebhookURL == "" {
		return fmt.Errorf("%w: webhook_url empty", ErrConfigInvalid)
	}
	if err := requireHostInList(cfg.WebhookURL, dingtalkHosts); err != nil {
		return fmt.Errorf("%w: %v", ErrConfigInvalid, err)
	}

	finalURL := cfg.WebhookURL
	if cfg.SignSecret != "" {
		ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
		// 钉钉签名：HmacSHA256(timestamp + "\n" + secret, secret) → base64 → URL encode
		mac := hmac.New(sha256.New, []byte(cfg.SignSecret))
		mac.Write([]byte(ts + "\n" + cfg.SignSecret))
		sig := base64.StdEncoding.EncodeToString(mac.Sum(nil))
		sep := "?"
		if u, err := url.Parse(cfg.WebhookURL); err == nil && u.RawQuery != "" {
			sep = "&"
		}
		finalURL = cfg.WebhookURL + sep + "timestamp=" + ts + "&sign=" + url.QueryEscape(sig)
	}

	// markdown 类型支持多行 + 加粗，比 text 富表达且不增加限流配额
	body := map[string]any{
		"msgtype": "markdown",
		"markdown": map[string]string{
			"title": FormatTitle(ev),
			"text":  formatDingtalkMarkdown(ev),
		},
	}
	payload, _ := json.Marshal(body)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, finalURL, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := d.client.Do(req)
	if err != nil {
		return fmt.Errorf("dingtalk post: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != 200 {
		return fmt.Errorf("dingtalk http %d: %s", resp.StatusCode, string(respBody))
	}
	// 钉钉始终返 200，业务错误在 body errcode 字段
	var r struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if err := json.Unmarshal(respBody, &r); err == nil && r.ErrCode != 0 {
		return fmt.Errorf("dingtalk errcode %d: %s", r.ErrCode, r.ErrMsg)
	}
	return nil
}

func formatDingtalkMarkdown(ev AlertEvent) string {
	out := "**" + FormatTitle(ev) + "**\n\n"
	if ev.Cluster != "" {
		out += "- 集群: `" + ev.Cluster + "`\n"
	}
	out += "- 类型: `" + ev.Kind + "`\n"
	out += "- 级别: `" + ev.Severity + "`\n"
	if ev.Message != "" {
		out += "\n" + ev.Message + "\n"
	}
	return out
}
