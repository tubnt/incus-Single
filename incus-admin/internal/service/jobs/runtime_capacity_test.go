package jobs

import (
	"testing"
)

// TestNewRuntime_DefaultCapacity 验证 OPS-050：未配 PoolSize / QueueSize 时
// 取默认值 4 / 64，保持向后兼容。
func TestNewRuntime_DefaultCapacity(t *testing.T) {
	rt := NewRuntime(Deps{})
	if got, want := cap(rt.queue), 64; got != want {
		t.Errorf("default QueueSize cap = %d, want %d", got, want)
	}
	if got, want := rt.deps.PoolSize, 4; got != want {
		t.Errorf("default PoolSize = %d, want %d", got, want)
	}
	if depth := rt.QueueDepth(); depth != 0 {
		t.Errorf("empty queue depth = %d, want 0", depth)
	}
}

// TestNewRuntime_CustomCapacity 验证 env 注入路径：显式 PoolSize / QueueSize
// 被正确传到 channel buffer 上。
func TestNewRuntime_CustomCapacity(t *testing.T) {
	rt := NewRuntime(Deps{PoolSize: 8, QueueSize: 256})
	if got, want := cap(rt.queue), 256; got != want {
		t.Errorf("QueueSize cap = %d, want %d", got, want)
	}
	if got, want := rt.deps.PoolSize, 8; got != want {
		t.Errorf("PoolSize = %d, want %d", got, want)
	}
}

// TestRuntime_QueueDepth 验证 QueueDepth() 反映 channel 当前堆积量。
// 直接往 queue 灌（不启 worker，避免被消费），观察 depth 增长。
func TestRuntime_QueueDepth(t *testing.T) {
	rt := NewRuntime(Deps{PoolSize: 1, QueueSize: 4})

	if depth := rt.QueueDepth(); depth != 0 {
		t.Fatalf("initial depth = %d, want 0", depth)
	}

	// 不启 worker，直接灌 channel。Enqueue 在非阻塞场景下应成功。
	rt.queue <- 1
	rt.queue <- 2
	rt.queue <- 3

	if depth := rt.QueueDepth(); depth != 3 {
		t.Fatalf("after 3 enqueues depth = %d, want 3", depth)
	}

	// 拉走一个
	<-rt.queue
	if depth := rt.QueueDepth(); depth != 2 {
		t.Fatalf("after 1 dequeue depth = %d, want 2", depth)
	}
}
