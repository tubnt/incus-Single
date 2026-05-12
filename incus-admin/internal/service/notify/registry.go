package notify

import "fmt"

// Registry 把所有 Sender 按 kind 索引，dispatcher 用 kind 查 sender。
// 入口在 main.go 启动时调 NewRegistry()，传给 alert_dispatcher。
type Registry struct {
	senders map[string]Sender
}

func NewRegistry() *Registry {
	r := &Registry{senders: make(map[string]Sender)}
	r.Register(NewDingtalkSender())
	r.Register(NewFeishuSender())
	r.Register(NewWecomSender())
	r.Register(NewWebhookSender())
	r.Register(NewSMTPSender())
	return r
}

func (r *Registry) Register(s Sender) {
	r.senders[s.Kind()] = s
}

func (r *Registry) Get(kind string) (Sender, error) {
	s, ok := r.senders[kind]
	if !ok {
		return nil, fmt.Errorf("notify: unknown kind %q", kind)
	}
	return s, nil
}
