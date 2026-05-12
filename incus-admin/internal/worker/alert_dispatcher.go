package worker

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/incuscloud/incus-admin/internal/repository"
	"github.com/incuscloud/incus-admin/internal/service/notify"
)

// PLAN-041 / INFRA-009 alert dispatcher
//
// 30 秒 tick：
//   1) ListPending（status=pending 且 next_retry_at <= now）
//   2) 按 channel_id 拉解密配置 → 调对应 sender.Send
//   3) 成功 → MarkSuccess；失败 → MarkRetry（attempts<3）/ MarkFailed（≥3）
//   4) MarkFailed 时再写一条 system_alerts(kind='channel_delivery_failed')
//      让 admin 感知通道挂了，避免重要告警静默丢失。

// DispatcherDeps 集中依赖。Channels 必须支持解密读取（GetWithConfig）。
type DispatcherDeps struct {
	Deliveries *repository.AlertDeliveryRepo
	Channels   *repository.NotifyChannelRepo
	Alerts     *repository.SystemAlertRepo
	Registry   *notify.Registry
}

// RunAlertDispatcher 启动调度循环。tickEvery <= 0 → 默认 30s。
// batchSize <= 0 → 默认 50。
func RunAlertDispatcher(ctx context.Context, deps DispatcherDeps, tickEvery time.Duration, batchSize int) {
	if deps.Deliveries == nil || deps.Channels == nil || deps.Registry == nil {
		slog.Info("alert dispatcher disabled (deps missing)")
		return
	}
	if tickEvery <= 0 {
		tickEvery = 30 * time.Second
	}
	if batchSize <= 0 {
		batchSize = 50
	}
	slog.Info("alert dispatcher started", "tick", tickEvery, "batch", batchSize)

	tick := time.NewTicker(tickEvery)
	defer tick.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("alert dispatcher stopping")
			return
		case <-tick.C:
			runDispatchOnce(ctx, deps, batchSize)
		}
	}
}

func runDispatchOnce(ctx context.Context, deps DispatcherDeps, batchSize int) {
	defer func() {
		if rec := recover(); rec != nil {
			slog.Error("alert dispatcher panic", "panic", rec)
		}
	}()

	pending, err := deps.Deliveries.ListPending(ctx, batchSize)
	if err != nil {
		slog.Warn("dispatcher: list pending failed", "error", err)
		return
	}
	for _, d := range pending {
		dispatchOne(ctx, deps, &d)
	}
}

func dispatchOne(ctx context.Context, deps DispatcherDeps, d *repository.AlertDelivery) {
	defer func() {
		if rec := recover(); rec != nil {
			slog.Error("dispatcher one panic", "delivery_id", d.ID, "panic", rec)
		}
	}()

	// 拉通道完整配置
	ch, err := deps.Channels.GetWithConfig(ctx, d.ChannelID)
	if err != nil {
		// 解密失败 / DB 错 → 直接 MarkFailed，不重试
		_ = deps.Deliveries.MarkFailed(ctx, d.ID, "channel config: "+err.Error())
		raiseChannelDeliveryFailed(ctx, deps, d.ChannelID, err.Error())
		return
	}
	if ch == nil {
		_ = deps.Deliveries.MarkFailed(ctx, d.ID, "channel not found")
		return
	}
	if !ch.Enabled {
		_ = deps.Deliveries.MarkFailed(ctx, d.ID, "channel disabled")
		return
	}

	sender, err := deps.Registry.Get(ch.Kind)
	if err != nil {
		_ = deps.Deliveries.MarkFailed(ctx, d.ID, "no sender: "+err.Error())
		return
	}

	// payload → AlertEvent
	var ev notify.AlertEvent
	if err := json.Unmarshal(d.Payload, &ev); err != nil {
		_ = deps.Deliveries.MarkFailed(ctx, d.ID, "decode payload: "+err.Error())
		return
	}
	// 兜底：phase / severity 从 delivery 行覆盖（避免 payload 写错）
	if ev.Phase == "" {
		ev.Phase = d.Phase
	}
	if ev.Severity == "" {
		ev.Severity = d.Severity
	}
	if ev.GroupKey == "" {
		ev.GroupKey = d.GroupKey
	}

	sendCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	err = sender.Send(sendCtx, ch.Config, ev)
	cancel()

	if err == nil {
		_ = deps.Deliveries.MarkSuccess(ctx, d.ID, d.Phase)
		slog.Info("dispatcher: delivery sent",
			"delivery_id", d.ID, "channel_id", d.ChannelID, "kind", ch.Kind,
			"group_key", d.GroupKey, "phase", d.Phase)
		return
	}

	// 失败：若是配置错误 → 直接 MarkFailed，不重试
	// 否则 attempts++ + 退避
	attempts := d.Attempts + 1
	if isConfigError(err) || attempts >= repository.DeliveryMaxAttempts {
		_ = deps.Deliveries.MarkFailed(ctx, d.ID, err.Error())
		raiseChannelDeliveryFailed(ctx, deps, d.ChannelID, err.Error())
		slog.Warn("dispatcher: delivery final failed",
			"delivery_id", d.ID, "channel_id", d.ChannelID, "attempts", attempts, "error", err)
		return
	}
	_ = deps.Deliveries.MarkRetry(ctx, d.ID, attempts, err.Error())
	slog.Warn("dispatcher: delivery retry scheduled",
		"delivery_id", d.ID, "channel_id", d.ChannelID, "attempts", attempts, "error", err)
}

// isConfigError 把 sender 返回的"配置错误"标记类型识别出来 → 不重试。
func isConfigError(err error) bool {
	if err == nil {
		return false
	}
	// notify.ErrConfigInvalid 是 sender 在 config 解析失败时返回的标志错误
	// errors.Is 兼容包装链
	type unwrapper interface{ Unwrap() error }
	for cur := err; cur != nil; {
		if cur == notify.ErrConfigInvalid {
			return true
		}
		u, ok := cur.(unwrapper)
		if !ok {
			break
		}
		cur = u.Unwrap()
	}
	return false
}

// raiseChannelDeliveryFailed 写一条 system_alerts 让 admin 看到"通道挂了"。
// 用 group_key=channel_delivery_failed:<channel_id> 让同一通道的连续失败聚合
// 成单行 active alert，不刷屏。
func raiseChannelDeliveryFailed(ctx context.Context, deps DispatcherDeps, channelID int64, reason string) {
	if deps.Alerts == nil {
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"channel_id": channelID, "reason": reason,
	})
	groupKey := "channel_delivery_failed:" + intToStr(channelID)
	cid := channelID
	_, err := deps.Alerts.UpsertWithGroup(
		ctx, "channel_delivery_failed", "", "error", groupKey, "channel",
		&cid, nil, payload,
	)
	if err != nil {
		slog.Warn("dispatcher: raise channel_delivery_failed alert failed", "error", err)
	}
}

func intToStr(n int64) string {
	// 不引 strconv 减小依赖；64 位 max 19 位
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	buf := make([]byte, 0, 20)
	for n > 0 {
		buf = append([]byte{byte('0' + n%10)}, buf...)
		n /= 10
	}
	if neg {
		buf = append([]byte{'-'}, buf...)
	}
	return string(buf)
}
