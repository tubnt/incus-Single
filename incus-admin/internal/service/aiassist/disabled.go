package aiassist

import "context"

// disabledProvider 是 AI 关闭模式下的 noop —— 调用全部短路返 ErrAIDisabled。
// 让 handler 拿到稳定的失败信号，进而用 Tier 1 fallback / 前端隐藏 AI 按钮。
type disabledProvider struct{}

// NewDisabledProvider 返回 disabled 占位 Provider。
func NewDisabledProvider() Provider {
	return &disabledProvider{}
}

func (d *disabledProvider) Name() string { return "disabled" }

func (d *disabledProvider) Suggest(_ context.Context, _ string, _ []byte, _ []byte) (*Suggestion, error) {
	return nil, ErrAIDisabled
}
