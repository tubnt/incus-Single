# PLAN-028 join-node.sh 兼容 bonded NIC + skip-network（OPS-026）

- **status**: completed
- **completedAt**: 2026-04-30（生产部署 OK，B2 batch=2 e2e 验证通过）
- **priority**: P2
- **owner**: claude
- **createdAt**: 2026-04-30
- **referenceDoc**: PLAN-026 / INFRA-002 落地经验
- **task**: [OPS-026](../task/OPS-026.md)

## Context

INFRA-002 真实 e2e（用 node6 加入集群）在 PR #8 之后跑前置检查时发现：node6 物理拓扑用 **bonded 25G NIC**（`bond-mgmt` + `bond-ceph`），与 `cluster/configs/cluster-env.sh` 写死 `NIC_PRIMARY=eno1` 的假设不匹配。直接跑 join-node.sh do_network 会拆掉 node6 现有 bond，apply-network.sh 安全网会 revert，最坏 mgmt 失联。

## 范围

| 模块 | 改动 |
|---|---|
| `cluster/scripts/join-node.sh` + `embedded` 副本 | 加 `--nic-primary` / `--nic-cluster` / `--bridge-name` / `--skip-network` 参数；env 默认仍来自 cluster-env.sh |
| skip-network 行为 | 跳过 `do_network`；preflight 改为验证 IP / route 已经在位（不检查 NIC 名）；verify 跳过 VLAN / bridge 检查 |
| `service/jobs/cluster_node_add.go` | `Params` 加 `NICPrimary` / `NICCluster` / `BridgeName` / `SkipNetwork` 字段；执行时拼对应 flags |
| `handler/portal/clustermgmt.go::AddNode` | 请求 body 接受新可选字段；默认不传保持原行为 |
| frontend `app/routes/admin/node-join.tsx` | 表单加 advanced section：bonded NIC + 跳过网络 toggle |
| 文档 | changelog + INFRA-002 status 不变（仍 completed），加 PLAN-028 link |

## 设计约束

- **向后兼容**：默认行为（不传 flags / skip-network=false）跟 PLAN-026 完全一致；node1-5 原有 add 流程不变
- **预配假设**：选 `--skip-network` 的运维必须保证目标节点已经：
  - 公网 IP / 默认路由就位（node6 的 bond-mgmt 已配 202.151.179.231/27）
  - 内网 mgmt + Ceph public/cluster 网段已就位（node6 已 10.0.10.6 / 10.0.20.6 / 10.0.30.6）
  - `br-pub` 桥接（如果该节点还要承载 VM；纯 OSD 节点不需要）
- 文档明确：node6 当前是 OSD-only（无 br-pub），加入后只承担存储角色；要承载 VM 需运维额外创建 br-pub

## 任务拆分

- [x] **PLAN-028.A** 改 join-node.sh + embedded 副本
- [x] **PLAN-028.B** 改 cluster_node_add executor + Params + handler
- [x] **PLAN-028.C** 前端 advanced toggle + i18n
- [x] **PLAN-028.D** node6 真实 e2e + maintenance toggle (D2) + batch=2 (B2) 验证
- [x] **PLAN-028.E** PR + CI + merge

## 验收

- 在生产 vmc.5ok.co 通过 admin UI 提交 node6 add（带 skip-network=true）→ SSE 9 步进度（含 skipped 网络步骤）→ 完成后 `incus cluster list` 显示 node6 Online + Ceph orch 显示 OSD up
- node6 加入后用 maintenance toggle 标 manual → 新建 VM 不会落在 node6
- batch count=2 在原 5 节点 cluster 跑通
- go vet / go test / tsc / vitest / build 全绿

## 不在范围

- node6 自动创建 br-pub bridge（运维手工，有共享物理网卡 IP 的复杂度）
- 跨 ops/distro 通用 NIC discovery
- LACP / active-backup 等 bond 模式自动检测
