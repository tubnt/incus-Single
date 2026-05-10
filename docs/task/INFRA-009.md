# INFRA-009 监控告警闭环 —— Prometheus 端点 + 阈值规则 + Webhook 通道

- **status**: completed
- **priority**: P0
- **owner**: claude-code
- **createdAt**: 2026-05-09 13:30
- **claimedAt**: 2026-05-09 14:00
- **completedAt**: 2026-05-09 14:30

## 描述

把"看得到 metrics"升级为"凌晨 3 点 CPU 飙到 95% 钉钉/飞书/邮件收到通知"。三段：

1. 公开 `/api/metrics` Prometheus exposition（业务指标 + Incus 转发）
2. DB 配置阈值告警规则 + 评估 worker（1min tick）
3. 通知通道：钉钉 / 飞书 / 企业微信 / 自定义 Webhook / SMTP，重试 + 去重 + SSRF 防护

详细设计见 [PLAN-041](../plan/PLAN-041.md)。

## 验收标准

- [ ] migration 026 上生产无错；3 张表（notify_channels / alert_rules / alert_deliveries）
- [ ] `/api/metrics` 输出标准 Prometheus 格式，可被 Grafana 抓取
- [ ] 业务指标至少含：active_vms / pending_orders / failed_jobs / active_alerts / balance_total
- [ ] 5 种通道全部跑通真实 demo（含签名校验）
- [ ] alert_evaluator 1min tick 评估 ≥ 6 类规则（vm_cpu/mem/disk/down + cluster_node_offline + balance_low）
- [ ] alert_dispatcher 失败 3 次重试 + 24h 去重
- [ ] 配 Webhook 时强制 https + 私有 IP 拒绝（SSRF 防护）
- [ ] secret 加密复用 OPS-022 的 AES-256-GCM key
- [ ] admin UI：通道 CRUD + 测试发送 + 规则 CRUD + 启用/禁用
- [ ] 90 天保留 worker 清理 alert_deliveries 历史

## 进行时描述

落地监控告警闭环

## 依赖

- **blocked by**: (无)
- **blocks**: 后续运营自动化看板（Grafana dashboard 模板 / Loki 日志接入）

## 笔记

- system_alerts 表已就绪（PLAN-039 留下），不重建
- 业务指标 collector 内置 30s cache，避免被 Prom 5s 抓爆
- Prom 端点匿名模式不输出 user_id label，避免租户隔离泄漏
- 通道签名：钉钉 HMAC-SHA256 / 飞书 HMAC-SHA256 / 企微 raw
