package jobs

import (
	"sync"

	"github.com/incuscloud/incus-admin/internal/model"
)

// StepEvent 是 SSE 推送给客户端的最小载荷。worker 在 AppendStep / UpdateStep
// 之后调 Broker.Publish；SSE handler 通过 Subscribe 拿一个只读 channel 收事件。
type StepEvent struct {
	JobID    int64                      `json:"job_id"`
	Step     model.ProvisioningJobStep  `json:"step"`
	Terminal bool                       `json:"terminal"` // job 已到终态（succeeded/failed/partial），SSE 收到后应 close
	Status   string                     `json:"status,omitempty"` // job 终态时填写
}

// Broker 是 job_id → []chan StepEvent 的薄路由。订阅者断连后 Unsubscribe 释放
// channel。Publish 永远 non-blocking（满 buffer 直接丢，订阅者错过的 step 通过
// SSE 重连 Last-Event-ID 从 DB 重放补齐）。
type Broker struct {
	mu   sync.Mutex
	subs map[int64]map[int]chan StepEvent
	nextID int
}

func NewBroker() *Broker {
	return &Broker{subs: make(map[int64]map[int]chan StepEvent)}
}

// Subscribe 返回一个 buffered chan + 取消函数。Buffer 32 够覆盖一次完整 job
// 的全部 step（vm.create 5–6 步），订阅者不需要立刻消费也不会阻塞 publisher。
func (b *Broker) Subscribe(jobID int64) (<-chan StepEvent, func()) {
	b.mu.Lock()
	defer b.mu.Unlock()

	ch := make(chan StepEvent, 32)
	if b.subs[jobID] == nil {
		b.subs[jobID] = make(map[int]chan StepEvent)
	}
	id := b.nextID
	b.nextID++
	b.subs[jobID][id] = ch

	cancel := func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		if m := b.subs[jobID]; m != nil {
			if c, ok := m[id]; ok {
				close(c)
				delete(m, id)
			}
			if len(m) == 0 {
				delete(b.subs, jobID)
			}
		}
	}
	return ch, cancel
}

// Publish 把事件推给所有订阅者。Buffer 满时直接丢（non-blocking），由 SSE 端
// reconnect 时通过 Last-Event-ID 从 DB 拉缺失 step 补齐。
func (b *Broker) Publish(ev StepEvent) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, ch := range b.subs[ev.JobID] {
		select {
		case ch <- ev:
		default:
			// Drop on full buffer — DB has authoritative copy, client resyncs on reconnect.
		}
	}
}

// SubscriberCountForUser 给 SSE handler 做 per-user conn cap 用。需要外部传入
// jobID→userID 映射；这里直接 sum 所有 jobID 的订阅数（Broker 不知道 user）。
// per-user 限流由 handler 层用独立 map 实现，Broker 只负责按 job 路由。
func (b *Broker) SubscriberCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	total := 0
	for _, m := range b.subs {
		total += len(m)
	}
	return total
}
