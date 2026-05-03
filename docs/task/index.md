# IncusAdmin - Task List

> Updated: 2026-05-03

## Usage

Each task is a single line linking to its detail file. All detailed information lives in `docs/task/PREFIX-NNN.md`.

### Format

- [ ] [**PREFIX-001 Short imperative title**](PREFIX-001.md) `P1`

### Status Markers

| Marker | Meaning |
|--------|---------|
| `[ ]`  | Pending |
| `[-]`  | In progress |
| `[x]`  | Completed |
| `[~]`  | Closed / Won't do |

### Priority: P0 (blocking) > P1 (high) > P2 (medium) > P3 (low)

### Rules

- Only update the checkbox marker; never delete the line.
- New tasks append to the end.
- See each `PREFIX-NNN.md` for full details.

---

## Tasks

- [x] [**REFACTOR-001 Refactor frontend to pma-web standards**](REFACTOR-001.md) `P1`
- [x] [**REFACTOR-002 Refactor backend to pma-go standards**](REFACTOR-002.md) `P1`
- [x] [**INFRA-001 Enable VM auto-failover with cluster healing**](INFRA-001.md) `P1`
- [x] [**INFRA-002 Build cluster node management UI and automation**](INFRA-002.md) `P1`
- [x] [**OPS-021 PLAN-025/026 后续 cleanup（死代码 / 一致性 / quota）**](OPS-021.md) `P2`
- [x] [**OPS-022 vms.password DB 字段加密（AES-256-GCM）**](OPS-022.md) `P2`
- [x] [**OPS-024 admin batch create / cluster-env-script / maintenance mode**](OPS-024.md) `P2`
- [x] [**OPS-026 join-node.sh 兼容 bonded NIC + skip-network**](OPS-026.md) `P2`
- [x] [**INFRA-003 Add standalone Incus host management**](INFRA-003.md) `P2`
- [x] [**QA-001 Fix 6 QA bugs from browser testing**](QA-001.md) `P2`
- [x] [**UX-001 UI/UX completeness per PLAN-007**](UX-001.md) `P1`
- [x] [**QA-002 Code review follow-up — fix PLAN-008 review findings**](QA-002.md) `P0`
- [x] [**QA-003 Fix 15 QA bugs from 2026-04-16 production browser testing**](QA-003.md) `P1`
- [x] [**TECHDEBT-001 Close PLAN-009/010/011/012 deferred items**](TECHDEBT-001.md) `P1`
- [x] [**INFRA-004 Cluster TLS fingerprint pinning**](INFRA-004.md) `P1`
- [~] [**INFRA-005 Observability iframe HTTPS reverse proxy**](INFRA-005.md) `P2`
- [x] [**QA-004 Full web QA on production after PLAN-013 deploy**](QA-004.md) `P1`
- [x] [**QA-005 Fix QA-004 bug findings N1-N15**](QA-005.md) `P1`
- [x] [**INFRA-006 VM state reverse-sync worker**](INFRA-006.md) `P1`
- [x] [**UX-002 后台菜单重组 + 用户/管理员视角分离**](UX-002.md) `P2`
- [x] [**QA-006 全量用户端 E2E + N1-N11 bug 修复**](QA-006.md) `P1`
- [x] [**UX-003 用户端功能缺口填补(G1-G5)**](UX-003.md) `P2`
- [x] [**SEC-001 安全与审计基线加固**](SEC-001.md) `P1`
- [x] [**HA-001 事件驱动 HA 实现 + 故障演练 + 历史回放**](HA-001.md) `P1`
- [x] [**OPS-001 镜像模板 DB 化 + UI 动态化（PLAN-021 Phase A+B）**](OPS-001.md) `P1`
- [x] [**OPS-002 新 IP 段 202.151.179.0/26 VLAN 376 接入（PLAN-021 Phase F）**](OPS-002.md) `P1`
- [x] [**OPS-003 密码重置离线回落（PLAN-021 Phase C）**](OPS-003.md) `P1`
- [x] [**OPS-004 防火墙组（PLAN-021 Phase E）**](OPS-004.md) `P1`
- [x] [**OPS-005 Floating IP（PLAN-021 Phase G）**](OPS-005.md) `P1`
- [x] [**OPS-006 Rescue 模式 safe-mode-with-snapshot（PLAN-021 Phase D）**](OPS-006.md) `P1`
- [x] [**OPS-007 VM 详情页 + 用户端 UI 完整化（PLAN-021 收尾补丁）**](OPS-007.md) `P1`
- [x] [**OPS-008 全功能 UI 回归发现 11 个 bug（9 已修 1 doc-only 1 误报）**](OPS-008.md) `P1`
- [x] [**OPS-009 高危按钮安全标签批量补齐（aria-label / ⚠ / border-destructive）**](OPS-009.md) `P3`
- [x] [**OPS-010 修复 Pay-with-Balance 重复支付竞态 + 友好化错误信息**](OPS-010.md) `P1`
- [x] [**OPS-011 日志降噪：用户取消请求不再打 ERROR**](OPS-011.md) `P3`
- [x] [**OPS-012 Reinstall 数据丢失保护：删除前探测镜像服务器**](OPS-012.md) `P2`
- [x] [**OPS-013 admin/create-vm 页 UX 修复（i18n + 规格按钮 active 态）**](OPS-013.md) `P3`
- [x] [**OPS-014 用户端 VM 详情页 Firewall tab（绑定/解绑 UI）**](OPS-014.md) `P2`
- [x] [**OPS-015 admin/monitoring metrics 跨节点 fan-out（修复多 VM 缺失）**](OPS-015.md) `P2`
- [x] [**OPS-016 Reinstall 数据丢失防线再加一层（image pre-pull）**](OPS-016.md) `P2`
- [x] [**OPS-017 Firewall ingress/egress 双向规则**](OPS-017.md) `P2`
- [x] [**OPS-018 Floating IP portal attach/detach + Admin VM firewall bind**](OPS-018.md) `P2`
- [x] [**OPS-019 杂项打磨：lint / i18n / stateful / Bug#4 / log / audit**](OPS-019.md) `P3`
- [x] [**OPS-020 前端 arbitrary value 全量替换为 @theme utility 直引**](OPS-020.md) `P3`
- [x] [**INFRA-007 VM provisioning 异步化 + SSE 进度流**](INFRA-007.md) `P1`
- [x] [**OPS-027 admin/vms 跨 project 列表 0 VM 修复**](OPS-027.md) `P1`
- [x] [**SEC-002 portal API cloud-init 字段过滤（含 password）**](SEC-002.md) `P2`
- [x] [**OPS-028 全功能 UI 测试遗留打磨（CR + P3 + SEC-002）**](OPS-028.md) `P2`
- [x] [**OPS-029 EN 语言包系统化补全 + 多处 i18n 漏项**](OPS-029.md) `P3`
- [x] [**OPS-030 DESIGN.md 严格合规：清零 arbitrary value + console aria + api-tokens i18n**](OPS-030.md) `P3`
- [x] [**UX-004 新建云主机页面 UX 重做（admin/create-vm + PurchaseSheet）**](UX-004.md) `P2`
- [x] [**UX-005 用户创建云主机入口重做：独立整页 /launch**](UX-005.md) `P2`
- [x] [**QA-007 前端全面审查与 QA bug 报告**](QA-007.md) `P1`
- [x] [**OPS-031 QA-007 P1 修复包：BUG-01..05**](OPS-031.md) `P1`
- [x] [**OPS-032 QA-007 P2+P3 清扫包**](OPS-032.md) `P2`
- [x] [**OPS-033 QA-007 残留全清扫（BUG-08/14/15/17/18）**](OPS-033.md) `P3`
- [x] [**QA-008 前端旅途审查（用户 + 管理员）**](QA-008.md) `P1`
- [x] [**OPS-034 QA-008 旅途审查 bug 集中修**](OPS-034.md) `P1`
- [x] [**UX-006 字号审计 + UI 简化方案调研**](UX-006.md) `P2`
- [x] [**OPS-035 字号 / 间距 / 密度全局回调一档（方案乙）**](OPS-035.md) `P2`
- [x] [**OPS-036 IA 简化（方案丙的安全子集）**](OPS-036.md) `P2`
- [x] [**OPS-037 修复 BUG-06 size token min()/calc() 静默失效**](OPS-037.md) `P1`
- [-] [**OPS-038 收尾包：5 项剩余优化全做**](OPS-038.md) `P2`
- [x] [**OPS-039 添加节点自动化（凭据多形态 + 自动探测）**](OPS-039.md) `P1`
