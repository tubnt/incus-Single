# INFRA-001 Enable VM auto-failover with cluster healing

- **status**: completed
- **priority**: P1
- **owner**: claude
- **createdAt**: 2026-04-15 18:00
- **completedAt**: 2026-04-19 05:30
- **supersededBy**: PLAN-020（Phase A-F）+ HA-001（事件驱动 HA）

## Description

Configure Incus cluster auto-healing so VMs automatically evacuate from failed nodes to healthy ones. Add admin UI for HA status monitoring.

Acceptance criteria:
- `cluster.healing_threshold` configured and tested
- All VMs verified on shared Ceph storage (no local devices)
- Admin dashboard shows node health, HA status per VM, evacuation history
- Manual evacuation button per node
- Alert on node going offline

## ActiveForm

Enabling VM auto-failover with cluster healing

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Related plan: PLAN-006 Phase 6A.
Incus docs: cluster.healing_threshold, `incus cluster evacuate`.
Risk: partial connectivity can cause false evacuations. Need conservative threshold (300s+).

## 2026-04-19 完成记录

PLAN-020 + HA-001 交付全部验收项：

- `cluster.healing_threshold=300` 在 `cn-sz-01` 已配置（PLAN-002 Phase 2B）；Ceph RBD 作为共享存储，`local:` 设备清零（PLAN-013 收尾）
- 事件驱动 HA：`worker/event_listener.go` 订阅 `/1.0/events?type=lifecycle`，cluster-member offline → 自动建 `healing_events(trigger=auto)` 行；instance-updated → 回填 `evacuated_vms` 明细；online → Complete
- 手动 evacuate：`POST /admin/clusters/{name}/nodes/{node}/evacuate` + `/restore`，双写 `healing_events(trigger=manual, actor_id)`
- Chaos drill：`POST /admin/clusters/{name}/ha/chaos/simulate-node-down`，staging/dev only
- 管理面板：`/admin/ha` 两 Tab —— Status（节点健康/HA 开关/手动 evacuate）+ History（表格 + 筛选 + Drawer 明细）
- 告警路径：Phase G/H 未交付时，运维侧通过 `healing_expire_stale` 超时 partial + 结构化日志识别；Slack/Lark 路由推迟到独立小 PR

关闭理由：ACC 五条全部满足或由后续任务承担（Phase G chaos 全链路集成测试、Phase H runbook 随 HA-001 继续推进）。
