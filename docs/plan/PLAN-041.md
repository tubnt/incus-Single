# PLAN-041 监控告警闭环 —— Prometheus 端点 + 阈值规则 + Webhook 通道

- **status**: completed
- **createdAt**: 2026-05-09 13:30
- **approvedAt**: 2026-05-09 14:00
- **completedAt**: 2026-05-09 14:30
- **relatedTask**: INFRA-009

## 现状

### 已有

- `internal/handler/portal/metrics.go`：`/admin/metrics/overview` + `/admin/metrics/vm/{name}` 拉 Incus prometheus 接口（`/1.0/metrics`），跨节点 fan-out + 30s 内存 cache + 退化解析 instance state
- `internal/repository/system_alert.go`：PG `system_alerts` 表（PLAN-039 留下），含 `(cluster, kind)` unique-where-resolved-null + `UpsertActive` / `ResolveActive` / `Dismiss` / `ListActive`
- `internal/worker/imbalance_watchdog.go`：唯一一个 alert producer（5min × 3 ticks 不均衡 → upsert system_alert），无通道发送
- `internal/handler/portal/clustermgmt.go` `WithAlerts(alertRepo)`：admin UI `/admin/cluster-mgmt` 已能展示 active alerts 列表
- `internal/auth`：OPS-022 留下 AES-256-GCM `EncryptPassword`/`DecryptPassword`，复用即可

### 缺失

- **无标准 Prometheus 端点**：grep `prometheus|/metrics` 在 server.go 0 命中，外部 Prometheus / Grafana 无法直接抓
- **无业务指标**：active_vms / pending_orders / balance_total / failed_jobs 这些只在 DB 里，没有暴露
- **无评估器**：阈值告警（"CPU > 90% 持续 5min"）没人评估
- **无通知通道**：钉钉 / 飞书 / 企业微信 / 邮件 / 自定义 Webhook 一个都没有
- **无 alert_deliveries 表**：发送记录、重试、签名都没地方落

## 方案

### A. Prometheus 端点（infra 类，独立小部分）

新增 `GET /api/metrics`：
- 包路径：`internal/handler/promexport/handler.go`
- 输出：标准 Prometheus exposition format（text/plain; version=0.0.4）
- 内容三段：
  1. **业务指标**（自己采）：`incusadmin_vms_active{cluster,user_id}`、`incusadmin_vms_provisioning`、`incusadmin_orders_pending`、`incusadmin_orders_failed_total`、`incusadmin_balance_total`、`incusadmin_jobs_failed_total{kind}`、`incusadmin_alerts_active{kind,severity}`、`incusadmin_backup_runs_failed_total{policy_id}`（PLAN-040 接好后联动）
  2. **Incus 转发**：每个 cluster 在 promexport 内部并行 fan-out `/1.0/metrics?target={node}`，加 `cluster=` label 后合并输出（复用 metrics.go 的 fan-out 思路，但不走内存 cache —— Prom 抓的是当前值）
  3. **Go runtime**：`promhttp.Handler()` 自带（go_gc_*、process_*）
- 鉴权：可选 Bearer（env `METRICS_BEARER_TOKEN`，空则匿名）—— 默认匿名但只在内网监听，cluster 外通过 oauth2-proxy 拦截
- 实现：用 `github.com/prometheus/client_golang/prometheus` + `promhttp`；业务指标走 `prometheus.GaugeVec` + 启动注册一个 collector 定期 SELECT DB

### B. 告警规则 + 评估 worker

新 migration `026_alert_rules_channels.sql`：

```sql
CREATE TABLE notify_channels (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL CHECK (kind IN ('dingtalk', 'feishu', 'wecom', 'webhook', 'smtp')),
  config_enc   TEXT NOT NULL,    -- AES-256-GCM 加密的 JSON config（webhook url + sign secret 等）
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_rules (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN
    ('vm_cpu', 'vm_mem', 'vm_disk', 'vm_down', 'cluster_node_offline',
     'order_failed', 'job_failed', 'backup_failed', 'balance_low')),
  scope_kind      TEXT CHECK (scope_kind IN ('global', 'cluster', 'vm', 'user')),
  scope_id        BIGINT,
  threshold       DOUBLE PRECISION,           -- 0.9 = 90%
  window_seconds  INT NOT NULL DEFAULT 300,   -- 持续 5 分钟才告警
  severity        TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  channel_ids     BIGINT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_deliveries (
  id           BIGSERIAL PRIMARY KEY,
  alert_id     BIGINT REFERENCES system_alerts(id),
  rule_id      BIGINT REFERENCES alert_rules(id),
  channel_id   BIGINT REFERENCES notify_channels(id),
  status       TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed')),
  attempts     INT NOT NULL DEFAULT 0,
  last_error   TEXT,
  payload_hash TEXT,                          -- 去重：同一 alert + channel + payload hash 24h 内不重发
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX alert_deliveries_dedup_idx ON alert_deliveries (channel_id, payload_hash, created_at DESC);
```

新 `internal/worker/alert_evaluator.go`：
- 1 分钟 tick
- 拉所有 enabled rules → 按 kind 评估：
  - `vm_cpu/mem/disk`：内部并发拉 `/1.0/metrics`（直接走 cluster client，不依赖 promexport 端点，避免回环）→ 计算 vm 维度阈值越线 → window_seconds 内持续越线才触发
  - `vm_down`：从 DB vm_reconciler 已写的 status='gone' / job 失败信号读取
  - `cluster_node_offline`：复用 imbalance_watchdog 同款 cluster member 探测
  - `order_failed` / `job_failed` / `backup_failed`：count failed rows in last window
  - `balance_low`：SELECT users WHERE balance < threshold（threshold 来自规则）
- 触发 → `system_alerts.UpsertActive(kind, scope, severity, payload)` → 给每个 channel 排一行 alert_deliveries(status='pending')
- 不再越线 → `ResolveActive(kind, scope)` + 推 resolved 通知（recover）

### C. 通道 service

`internal/service/notify/`：
- `dingtalk.go`：钉钉自定义机器人（webhook + sign HMAC-SHA256，时间戳查验）
- `feishu.go`：飞书自定义机器人（同模式，不同签名算法）
- `wecom.go`：企业微信群机器人
- `webhook.go`：通用 HTTP POST（JSON body + 可选 Bearer）
- `smtp.go`：标准 SMTP（TLS / STARTTLS）
- 全部走统一接口 `type Sender interface { Send(ctx, AlertEvent) error }`

新 `internal/worker/alert_dispatcher.go`：
- 30s tick 扫 `alert_deliveries WHERE status='pending'`
- 解密 channel.config_enc → 选对应 Sender → Send
- 失败 → attempts+1 + last_error，重试 3 次（指数退避 1m / 5m / 15m），第 4 次标 failed 不再重试 + 写 system_alert kind='delivery_failed'
- 成功 → status='success' + sent_at

### D. SSRF 防护 + 域名白名单

- webhook / generic 通道：必须 https；解析 host 后查 IP 不能落在私有段（10/8、172.16/12、192.168/16、127/8、169.254/16、::1、fe80::/10）—— 用 `net.IP.IsPrivate` + 自校验
- dingtalk/feishu/wecom：硬编码 host 白名单（`oapi.dingtalk.com` / `open.feishu.cn` / `qyapi.weixin.qq.com`）
- SMTP：仅允许配置好的 host:port，端口限 25/465/587

### E. 前端

- 新页面 `/admin/notify-channels`：通道 CRUD + "测试发送"按钮（合成一条假 AlertEvent push）
- 新页面 `/admin/alert-rules`：规则 CRUD + 启用/禁用 toggle
- `/admin/cluster-mgmt` 现有 active alerts 视图加"通道送达状态"列（最近 1 条 delivery）

### F. 业务指标的"自动注册"

避免每个新指标都改一处的散乱：
- `internal/observability/metrics.go` 集中定义所有 GaugeVec / Counter
- service 层调用 `obs.VMsActive.WithLabelValues(cluster, userID).Set(...)` 即可
- DB-driven 指标走"采集器"模式：promexport handler 在每次 scrape 时同步 SELECT 并 Set

## 风险

1. **Prometheus 抓取频率太高拖死 DB**：业务指标 collector 每次 scrape 都 SELECT，被 Prom 配 5s 抓一次会很惨 → 加内部 30s cache（与 metrics.go 同款），exposition 时返 cache
2. **告警风暴**：节点宕机会同时触发 N 条 vm_down → alert_evaluator 必须按 (kind, scope_kind, scope_id) 聚合，单 system_alert 只写 1 行（cluster 层），不在 vm 层每台一行
3. **去重未做导致刷屏**：alert_deliveries 加 `payload_hash` UNIQUE 24h 窗口，重复 alert 只发一次（resolved 后再次触发不算重复）
4. **secret 加密 key 缺失启动崩溃**：复用 OPS-022 的 `auth.EncryptPassword`，passthrough 模式（key 空时不加密）已支持，dev 不阻塞
5. **Webhook SSRF 攻击**：见 D 节，强制 https + 私有 IP 拒绝 + 域名白名单
6. **/api/metrics 暴露业务指标可能泄漏租户隔离**：active_vms 带 `user_id` label 会让外部 Prom 看到所有用户 → 默认开启 Bearer，匿名模式只输出聚合（不带 user_id label）
7. **alert_deliveries 表 1 年后膨胀**：加 90 天保留 worker（与 audit_cleanup 同模式）

## 工作量

- A 端点：≈ 1.5 天
- B migration + repo + evaluator worker：≈ 3-4 天
- C 4 个 sender + dispatcher worker：≈ 3 天（钉钉/飞书签名各踩一次）
- D SSRF + 测试：≈ 1 天
- E 前端 2 页：≈ 2-3 天
- 文档 + Grafana dashboard json：≈ 1 天
- **合计 ≈ 11-13 天**（一人）

## 备选方案

| 方案 | 优点 | 缺点 | 选用 |
|---|---|---|---|
| A. 自研评估 + dispatcher（本方案） | 业务规则灵活、与 system_alert 强绑定、无新组件 | 自维护重试 / 去重 | ✅ |
| B. 引入 Alertmanager | 标准重试/silence/group 全套 | 多一个进程，运维 +1，钉钉/飞书还得装 [PrometheusAlert](https://github.com/feiyu563/PrometheusAlert) | ❌ |
| C. 把通道做成 Logto/外部 SaaS | 零代码 | 客户私有部署不能访问外网 | ❌ |
| D. 暴露 Prom 端点但不做评估 | 工作量减半 | 客户得自己装 Prom + 写规则 + 装通道，与 P0 目标矛盾 | ❌ |

## 批注

### 2026-05-09 14:00 用户批注（深度审查后批准）

**全部接受 F4-F14 修正项 + D11-D18 + X1-X5**：

- **F4 dedup 三元组**：原方案 `(channel_id, payload_hash) + 24h` 会吞 firing→resolved→firing。改 `(channel_id, group_key, status)` 三元组（Alertmanager 标准），retention 与告警生命周期对齐。
- **F5 prometheus collector stampede**：业务指标必须**后台 30s 刷新 + `prometheus.NewConstMetric`**，不能 scrape 时 SELECT DB。
- **F6 SSRF 防护**：用 `code.dny.dev/ssrf`（IANA 自动同步）+ `CheckRedirect: ErrUseLastResponse`。`net/netip.Addr.IsPrivate()` 不够。
- **F8 复用 system_alerts CRUD**：不重做，只新增 alert_rules / notify_channels / alert_deliveries。
- **F9 features/alerts/api.ts**：新建统一聚合，原 `useSystemAlertsQuery` 在 nodes/api.ts 保留兼容。
- **F11 step-up allowlist**：仅敏感动作（删 alert rule / 配 webhook secret / 删 channel）加 allowlist。
- **F12 imbalance_watchdog 改造**：作为内置 system rule 接入 dispatcher（D12 = B）。
- **F13 sidebar**：告警规则 / 通道归 `monitoring` 组。

**决策**：
- D11 = B（dedup 三元组 `(channel, group_key, status)`）
- D12 = B（imbalance 作为内置 system rule，UI 可启停）
- D13 = A（默认匿名 + 裁 user_id label，外部 Bearer 加 env 启用）
- D14 = B（`code.dny.dev/ssrf`）
- D15 = A（3 次后报"通道挂"）
- D16 = A（silence/抑制留 v2）
- D17 = A（不支持双 secret，留 v2）
- D18 = A（仅聚合，无 user_id label）
- X1：041 用 migration 025（PLAN-040 搁置后释放编号）
- X3 = A（复用 OPS-022 单 AES key）
- X5：i18n zh + en 双语全程

**视觉**：所有前端遵循 DESIGN.md（Linear dark-mode native）+ 现有 Tailwind v4 `@theme` token，禁 hex 字面量与 arbitrary value（OPS-020/030 已清零基础）。

