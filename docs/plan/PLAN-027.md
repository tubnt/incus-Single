# PLAN-027 Standalone Incus host 管理 + DB-driven cluster config（INFRA-003）

- **status**: completed
- **priority**: P2
- **owner**: claude
- **createdAt**: 2026-04-30
- **completedAt**: 2026-04-30（生产部署 OK，DB clusters 表已被 env 兜底 upsert 填充 kind/cert_file/default_project）
- **referenceDoc**: `docs/plan/PLAN-006.md` Phase 6C、INFRA-002 落地经验
- **task**: [INFRA-003](../task/INFRA-003.md)

## Context

PLAN-006 Phase 6C 立项 6 个月一直 pending。现状：
- `cluster.Manager.AddCluster` / `RemoveCluster` 已支持运行时增删（PLAN-022 加的）
- `ClusterRepo` 已有部分字段（id, name, display_name, api_url, status, tls_fingerprint）
- handler `POST /admin/clusters/add` 注册 cluster 但**只写 Manager 不写 DB**，重启即丢
- `clusters` 表缺：cert_file / key_file / ca_file / kind / default_project / storage_pool / network / ip_pools

INFRA-003 真正要补的：**clusters 表 schema 扩展 + 启动时 DB-driven 加载 + handler 双写 DB**。Standalone host 只是"单节点 cluster"，无须新代码路径，schema 加 `kind` 字段做 UI 展示区分即可。

## 范围

| 模块 | 文件 | 改动 |
|---|---|---|
| migration | `db/migrations/017_clusters_full_config.sql` | clusters 表加 cert_file / key_file / ca_file / kind / default_project / storage_pool / network / ip_pools_json 列 |
| model | `internal/model/models.go` | Cluster struct 加新字段；常量 `ClusterKindCluster` / `ClusterKindStandalone` |
| repo | `internal/repository/cluster.go` | `CreateFull` / `DeleteByName` / `ListFull` 返回完整 config；`Upsert` 兼容只用基础字段（env bootstrap） |
| main.go | bootstrap | env 配置仍是首启动 fallback；正常启动从 DB 读 → 转 ClusterConfig → NewManager。env 集群在 DB 不存在时由 main.go upsert 进 DB 兜底 |
| handler | `internal/handler/portal/clustermgmt.go::AddCluster` | 写 Manager + 写 DB（事务一致）；先 DB upsert 再 Manager.AddCluster，失败 rollback DB |
| handler | `clustermgmt.go::RemoveCluster` | 先 Manager.Remove 再 DB delete；audit 记 |
| frontend | (无改动) | `useAddClusterMutation` form 已支持 cert/key/ca 路径输入 |
| 文档 | changelog + INFRA-003 status | |

## 设计约束

- backward compat：现有用 env 配 CLUSTER_* 的部署，第一次启动时 main.go 把 env 配置 upsert 进 DB；之后 DB 是源，env 仍读但 DB 优先
- standalone host：UI 展示 `kind=standalone` badge；后端逻辑完全沿用 cluster.Manager 路径（API 调用、健康检查等都一致）
- TLS 证书文件依然走 admin 服务器本地路径（不存 cert 内容到 DB）—— 简化但要求 admin 把 cert 文件 scp 到 `/etc/incus-admin/certs/{name}/` 后再调 add
- IP pools 用 JSONB 存（已有 config.IPPoolConfig 结构序列化）

## 任务拆分

- [x] **PLAN-027.A** migration 017 + model + ClusterRepo `CreateFull / DeleteByName / ListFull`
- [x] **PLAN-027.B** main.go 启动时从 DB 读 + env 兜底 upsert
- [x] **PLAN-027.C** handler AddCluster/RemoveCluster 双写 DB + 事务一致
- [x] **PLAN-027.D** build/test/deploy + PR + CI + merge

## 验收

- 重启 admin 服务后，先前 admin POST /clusters/add 添加的 cluster **仍在**（之前是 in-memory only 重启即丢）
- env 配的 cluster 在 DB clusters 表里有对应行（`kind=cluster`）
- `POST /api/admin/clusters/add` 提交 standalone host（kind=standalone）后能 ListNodes 正常返其单节点
- `go vet` clean / `go test` 全绿

## 不在范围

- TLS cert / key 内容存 DB（保留文件路径方案，避免密钥进 DB 增加爆露面）
- 多 cluster 跨集群 VM 调度策略
- Cluster 配置版本化 / 历史回溯
