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
	"strconv"
	"time"
)

// 飞书自定义机器人 sender。
//
// 关键差异（2026 实测）：
//   - 签名算法：HmacSHA256(key=timestamp+"\n"+secret, msg=空字符串) → base64
//     注意 key/msg 顺序与钉钉相反（钉钉是 secret 当 key），常见踩坑点
//   - timestamp ±1 小时
//   - 签名通过 body 字段传，不在 URL（与钉钉相反）
//
// 文档: https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot

type FeishuSender struct {
	client *http.Client
}

func NewFeishuSender() *FeishuSender {
	return &FeishuSender{client: newSafeClient()}
}

func (f *FeishuSender) Kind() string { return "feishu" }

type feishuConfig struct {
	WebhookURL string `json:"webhook_url"`
	SignSecret string `json:"sign_secret"`
}

func (f *FeishuSender) Send(ctx context.Context, configJSON json.RawMessage, ev AlertEvent) error {
	var cfg feishuConfig
	if err := json.Unmarshal(configJSON, &cfg); err != nil {
		return fmt.Errorf("%w: %v", ErrConfigInvalid, err)
	}
	if cfg.WebhookURL == "" {
		return fmt.Errorf("%w: webhook_url empty", ErrConfigInvalid)
	}
	if err := requireHostInList(cfg.WebhookURL, feishuHosts); err != nil {
		return fmt.Errorf("%w: %v", ErrConfigInvalid, err)
	}

	body := map[string]any{
		"msg_type": "interactive",
		"card":     buildFeishuCard(ev),
	}
	if cfg.SignSecret != "" {
		ts := strconv.FormatInt(time.Now().Unix(), 10)
		// 飞书签名：HmacSHA256(key=timestamp+"\n"+secret, msg=""), base64
		k := ts + "\n" + cfg.SignSecret
		mac := hmac.New(sha256.New, []byte(k))
		// msg 是空字符串，但 hmac 仍要 Sum
		sig := base64.StdEncoding.EncodeToString(mac.Sum(nil))
		body["timestamp"] = ts
		body["sign"] = sig
	}
	payload, _ := json.Marshal(body)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.WebhookURL, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := f.client.Do(req)
	if err != nil {
		return fmt.Errorf("feishu post: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != 200 {
		return fmt.Errorf("feishu http %d: %s", resp.StatusCode, string(respBody))
	}
	// 飞书业务错误在 body code 字段（0 = 成功）
	var r struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := json.Unmarshal(respBody, &r); err == nil && r.Code != 0 {
		return fmt.Errorf("feishu code %d: %s", r.Code, r.Msg)
	}
	return nil
}

func buildFeishuCard(ev AlertEvent) map[string]any {
	color := "blue"
	switch ev.Severity {
	case "critical":
		color = "red"
	case "error":
		color = "red"
	case "warning":
		color = "orange"
	}
	if ev.Phase == "resolved" {
		color = "green"
	}

	mdLines := ""
	if ev.Cluster != "" {
		mdLines += "**集群:** `" + ev.Cluster + "`\n"
	}
	mdLines += "**类型:** `" + ev.Kind + "`\n"
	mdLines += "**级别:** `" + ev.Severity + "`\n"
	if ev.Message != "" {
		mdLines += "\n" + ev.Message
	}

	return map[string]any{
		"header": map[string]any{
			"title":    map[string]any{"tag": "plain_text", "content": FormatTitle(ev)},
			"template": color,
		},
		"elements": []map[string]any{
			{
				"tag":     "div",
				"text":    map[string]any{"tag": "lark_md", "content": mdLines},
			},
		},
	}
}
