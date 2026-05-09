package aiassist

import (
	"context"
	"errors"
)

// PLAN-038 / OPS-041 Phase B/C provider 抽象。
//
// Provider 是 LLM 后端的统一接口。每次调用是无状态的：传 prompt + JSON schema，
// 拿回 schema 校验过的 JSON。设计上：
//
//   - 不暴露 streaming（本期 Tier 2/3 都是结构化短输出，不需要）
//   - 不暴露多轮对话（Tier 2/3 是单轮 zero-shot prompt）
//   - schema 由调用方传入，便于 unit test 用 fixture
//   - 失败均通过 error 返回；上层走 fallback 路径，不阻塞业务流

// Suggestion 是 Provider 返回的结构化结果。
//
// JSON 必经调用方的 schema 校验通过；Reasoning 留作 audit / 前端 hover 提示。
type Suggestion struct {
	JSON              []byte // schema-validated JSON
	UsageInputTokens  int
	UsageOutputTokens int
	Provider          string // "anthropic" | "openai" | "disabled"
	Model             string
}

// Provider 实现：anthropic / openai / disabled。
type Provider interface {
	Name() string
	// Suggest 发出一次 zero-shot 推理。systemPrompt 是固定指令，userJSON 是
	// 用户输入（应已脱敏）。schemaJSON 用于 JSON-mode 强制；返回的 Suggestion.JSON
	// 一定符合 schema。失败 → err。
	Suggest(ctx context.Context, systemPrompt string, userJSON []byte, schemaJSON []byte) (*Suggestion, error)
}

// 标准错误，便于上层做 metric 分类。
var (
	ErrAIDisabled       = errors.New("ai provider disabled")
	ErrAITimeout        = errors.New("ai provider timeout")
	ErrAISchemaInvalid  = errors.New("ai provider response schema invalid")
	ErrAIQuotaExceeded  = errors.New("ai provider monthly token budget exceeded")
)
