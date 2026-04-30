# IncusAdmin - Task List

> Updated: 2026-04-30

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
- [ ] [**INFRA-003 Add standalone Incus host management**](INFRA-003.md) `P2`
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
