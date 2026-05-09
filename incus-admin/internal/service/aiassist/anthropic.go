package aiassist

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// PLAN-038 / OPS-041 Phase B Anthropic Messages API provider。
//
// 设计取舍：
//   - 不引 anthropic-sdk-go 依赖，bare-metal net/http 调一次（~80 行）
//   - 用 **tool_use forcing** 拿结构化输出：定义一个 input_schema 为目标 schema
//     的 tool，强制 tool_choice={type:"tool"}，response.content[0].input 即
//     schema 化 JSON
//   - 未启用 prompt caching：本期调用频率低（每节点探测 0~1 次 + 每失败 job 0~1 次），
//     不值得加复杂度

const (
	anthropicEndpoint = "https://api.anthropic.com/v1/messages"
	anthropicVersion  = "2023-06-01"
)

type anthropicProvider struct {
	apiKey  string
	model   string
	baseURL string // 自托管 / 兼容代理；空 = 官方
	timeout time.Duration
	http    *http.Client
}

// NewAnthropicProvider 构造。apiKey 空 → 报错。
func NewAnthropicProvider(apiKey, model, baseURL string, timeoutSec int) (Provider, error) {
	if apiKey == "" {
		return nil, errors.New("anthropic api key required")
	}
	if model == "" {
		model = "claude-haiku-4-5"
	}
	if timeoutSec <= 0 {
		timeoutSec = 30
	}
	if baseURL == "" {
		baseURL = anthropicEndpoint
	}
	return &anthropicProvider{
		apiKey:  apiKey,
		model:   model,
		baseURL: baseURL,
		timeout: time.Duration(timeoutSec) * time.Second,
		http:    &http.Client{Timeout: time.Duration(timeoutSec) * time.Second},
	}, nil
}

func (a *anthropicProvider) Name() string { return "anthropic" }

// 请求 / 响应结构（参考 https://docs.anthropic.com/en/api/messages）
type anthropicReq struct {
	Model      string             `json:"model"`
	MaxTokens  int                `json:"max_tokens"`
	System     string             `json:"system,omitempty"`
	Messages   []anthropicMessage `json:"messages"`
	Tools      []anthropicTool    `json:"tools,omitempty"`
	ToolChoice *anthropicChoice   `json:"tool_choice,omitempty"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

type anthropicChoice struct {
	Type string `json:"type"`
	Name string `json:"name,omitempty"`
}

type anthropicResp struct {
	Content []struct {
		Type  string          `json:"type"`
		Name  string          `json:"name,omitempty"`
		Input json.RawMessage `json:"input,omitempty"`
		Text  string          `json:"text,omitempty"`
	} `json:"content"`
	Usage struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
	StopReason string `json:"stop_reason"`
	Error      *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (a *anthropicProvider) Suggest(ctx context.Context, systemPrompt string, userJSON []byte, schemaJSON []byte) (*Suggestion, error) {
	body := anthropicReq{
		Model:     a.model,
		MaxTokens: 2048,
		System:    systemPrompt,
		Messages: []anthropicMessage{{
			Role:    "user",
			Content: string(userJSON),
		}},
		Tools: []anthropicTool{{
			Name:        "submit_structured_response",
			Description: "Return the structured response matching the input_schema. Do not write any free-form text.",
			InputSchema: json.RawMessage(schemaJSON),
		}},
		ToolChoice: &anthropicChoice{Type: "tool", Name: "submit_structured_response"},
	}

	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-api-key", a.apiKey)
	req.Header.Set("anthropic-version", anthropicVersion)
	req.Header.Set("content-type", "application/json")

	resp, err := a.http.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "Timeout") {
			return nil, fmt.Errorf("%w: %v", ErrAITimeout, err)
		}
		return nil, fmt.Errorf("anthropic request: %w", err)
	}
	defer resp.Body.Close()

	rawResp, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		var ae anthropicResp
		_ = json.Unmarshal(rawResp, &ae)
		msg := ""
		if ae.Error != nil {
			msg = ae.Error.Message
		}
		return nil, fmt.Errorf("anthropic %d: %s", resp.StatusCode, msg)
	}

	var parsed anthropicResp
	if err := json.Unmarshal(rawResp, &parsed); err != nil {
		return nil, fmt.Errorf("parse anthropic response: %w", err)
	}

	// 找 tool_use 块（应当只有一个）
	for _, c := range parsed.Content {
		if c.Type == "tool_use" && c.Name == "submit_structured_response" && len(c.Input) > 0 {
			return &Suggestion{
				JSON:              []byte(c.Input),
				UsageInputTokens:  parsed.Usage.InputTokens,
				UsageOutputTokens: parsed.Usage.OutputTokens,
				Provider:          "anthropic",
				Model:             a.model,
			}, nil
		}
	}
	return nil, fmt.Errorf("%w: no tool_use block in response", ErrAISchemaInvalid)
}
