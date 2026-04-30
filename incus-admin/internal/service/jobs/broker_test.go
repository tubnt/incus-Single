package jobs

import (
	"sync"
	"testing"
	"time"

	"github.com/incuscloud/incus-admin/internal/model"
)

func TestBroker_PublishToSubscribers(t *testing.T) {
	b := NewBroker()
	ch1, c1 := b.Subscribe(42)
	defer c1()
	ch2, c2 := b.Subscribe(42)
	defer c2()

	step := model.ProvisioningJobStep{Seq: 0, Name: "submit_instance", Status: model.StepStatusRunning}
	b.Publish(StepEvent{JobID: 42, Step: step})

	for _, ch := range []<-chan StepEvent{ch1, ch2} {
		select {
		case ev := <-ch:
			if ev.Step.Name != "submit_instance" {
				t.Fatalf("got step name %q, want submit_instance", ev.Step.Name)
			}
		case <-time.After(time.Second):
			t.Fatal("subscriber did not receive event")
		}
	}
}

func TestBroker_UnsubscribeStopsDelivery(t *testing.T) {
	b := NewBroker()
	ch, cancel := b.Subscribe(7)
	cancel()

	// 取消后 channel 已关闭：再 Publish 不应 panic（select default 丢弃）
	b.Publish(StepEvent{JobID: 7, Step: model.ProvisioningJobStep{Seq: 0}})

	// 应能立即从已关闭 chan 读到 zero value（ok=false）
	select {
	case _, ok := <-ch:
		if ok {
			t.Fatal("expected channel closed after cancel")
		}
	case <-time.After(time.Second):
		t.Fatal("channel should be closed and unblock recv")
	}
}

func TestBroker_RoutesByJobID(t *testing.T) {
	b := NewBroker()
	chA, cancelA := b.Subscribe(1)
	defer cancelA()
	chB, cancelB := b.Subscribe(2)
	defer cancelB()

	b.Publish(StepEvent{JobID: 1, Step: model.ProvisioningJobStep{Seq: 0, Name: "job-1-step"}})

	select {
	case ev := <-chA:
		if ev.JobID != 1 {
			t.Fatalf("subscriber A got jobID=%d", ev.JobID)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("A did not receive its event")
	}

	select {
	case <-chB:
		t.Fatal("subscriber B should not receive job 1's event")
	case <-time.After(100 * time.Millisecond):
		// expected
	}
}

func TestBroker_BufferFullDropsRatherThanBlock(t *testing.T) {
	b := NewBroker()
	_, cancel := b.Subscribe(99)
	defer cancel()

	// 灌满 32 buffer + 多余 16；Publish 必须不阻塞
	done := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 48; i++ {
			b.Publish(StepEvent{JobID: 99, Step: model.ProvisioningJobStep{Seq: i}})
		}
		close(done)
	}()

	select {
	case <-done:
		// good — 没阻塞
	case <-time.After(2 * time.Second):
		t.Fatal("Publish blocked when buffer full; should drop instead")
	}
	wg.Wait()
}
