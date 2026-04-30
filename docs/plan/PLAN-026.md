# PLAN-026 集群节点管理 UI + 自动化（INFRA-002）

- **status**: completed
- **priority**: P1
- **owner**: claude
- **createdAt**: 2026-04-30
- **completedAt**: 2026-04-30（go vet clean / go test 全绿 / tsc 0 / vitest 37/37 / build OK / 生产 systemd active 4 worker 运行中）
- **referenceDoc**: `docs/plan/PLAN-006.md` Phase 6B、`cluster/scripts/join-node.sh`、`cluster/scripts/scale-node.sh`、PLAN-025 jobs runtime
- **task**: [INFRA-002](../task/INFRA-002.md)

## Context

PLAN-006 Phase 6B 立项 6 个月以来一直 pending。深度审查发现：
- `cluster/scripts/join-node.sh` 已是完整 7 步 add-node 编排（前置/装包/网络/Incus join/Ceph OSD/防火墙/验证）
- `cluster/scripts/scale-node.sh --remove` 已是完整 7 步 remove-node 编排（法检/检 VM/evacuate/移 OSD/leave/更新监控/通知）
- `internal/sshexec/runner.go` 已有 SSH 执行 + known_hosts pin + POSIX-quote 防注入
- PLAN-025 jobs runtime + SSE 已经把"长 op + 实时进度"基础设施搭好

INFRA-002 真正剩下的只是：**SSH 编排器 + UI**，复用 PLAN-025 的 jobs runtime 即可。

## 范围

| 模块 | 文件 | 改动 |
|---|---|---|
| migration | `db/migrations/016_jobs_node_kinds.sql` | 扩展 `provisioning_jobs.kind` CHECK 约束加 `cluster.node.add` / `cluster.node.remove` |
| model | `internal/model/models.go` | 新增 `JobKindClusterNodeAdd` / `JobKindClusterNodeRemove` 常量 |
| sshexec | `internal/sshexec/runner.go` + 单测 | 新增 `RunStream(ctx, cmd, onLine)` 行级回调（`StdoutPipe` + `bufio.Scanner`），不破坏现有 `Run/RunArgs` |
| service/jobs | `internal/service/jobs/cluster_node_add.go`（新） | leader 生 token → SCP 脚本 → 远程跑 → 解析 marker advance step |
| service/jobs | `internal/service/jobs/cluster_node_remove.go`（新） | leader 跑 `scale-node.sh --remove`，相同 marker 解析 |
| service/jobs | `runtime.go::dispatch` | 加两个新 kind |
| handler | `internal/handler/portal/clustermgmt.go` | `POST /admin/clusters/{name}/nodes`（add）+ `DELETE /admin/clusters/{name}/nodes/{node}`（remove） |
| handler | `internal/handler/portal/jobs.go` | 已有 admin role 跨用户 canAccess 检查，admin 直接 watch portal 端点 OK；新增 admin 路由别名 `/admin/jobs/{id}` + `/admin/jobs/{id}/stream`（让前端 admin 命名空间路由直观） |
| service.Params | `internal/service/jobs/executor.go` | 加 cluster.node.* 字段（target host / SSH user / role 等） |
| frontend | `features/nodes/api.ts` | `useAdminAddNodeMutation` / `useAdminRemoveNodeMutation` |
| frontend | `features/nodes/components/add-node-form.tsx`（新） | hostname / public IP / SSH user / SSH key path / 角色（osd / mon-mgr-osd） |
| frontend | `app/routes/admin/nodes.tsx` | "添加节点"按钮 + 抽屉 + JobProgress 实时 step + 日志尾部 |
| 前端 lib 复用 | `shared/lib/sse-client.ts` + `features/jobs/use-job-stream.ts` | 已就绪 |
| i18n | `web/src/locales/{zh,en}.json` | nodes.add* / nodes.remove* / jobs.step.cluster* |
| 文档 | `docs/changelog.md` + `docs/task/INFRA-002.md` 状态 in_progress | |

## 设计约束（DESIGN.md 优先 > pma-web）

- 所有 UI 视觉值通过 `@theme` token 引用：表单 `bg-surface-1 border-border rounded-md`，主按钮 `variant="primary"`，destructive 按钮 `variant="destructive"`，进度卡复用 `<JobProgress />`；日志尾部 `bg-surface-panel font-mono text-caption text-text-tertiary`
- 严禁 hex 字面量、严禁 `text-[12px]` / `bg-[#xxxx]` 之流的 arbitrary value
- Linear 风：add-node 抽屉右滑入，宽 `min(96vw, 36rem)`（与 PurchaseSheet 同模式）

## 步骤映射

**add-node**（job kind = `cluster.node.add`）：
| seq | name | 触发 |
|---|---|---|
| 0 | leader_token | handler 前置：`incus cluster add <name>` SSH leader |
| 1 | upload_scripts | handler 前置：scp join-node.sh + cluster-env.sh + apply-network.sh + setup-firewall.sh |
| 2 | preflight | 远程 stdout `====== 步骤 1/7` |
| 3 | install_packages | `====== 步骤 2/7` |
| 4 | network_config | `====== 步骤 3/7` |
| 5 | join_incus | `====== 步骤 4/7` |
| 6 | join_ceph | `====== 步骤 5/7` |
| 7 | firewall | `====== 步骤 6/7` |
| 8 | verify | `====== 步骤 7/7` |

**remove-node**（job kind = `cluster.node.remove`）：mirror `scale-node.sh` 的 `[STEP]` marker。

## 失败补偿矩阵

| 失败时机 | rollback |
|---|---|
| leader_token | 仅 audit + 返回错误，未做任何破坏性 |
| upload_scripts | scp 失败 → audit；远端无脏状态 |
| preflight 之后 | 前置检查失败 → 远端未变更；audit 报错让 admin 介入 |
| install_packages 之后 | 已动远端：apt 安装一些包；不自动卸载（远端最小变更，不破坏） |
| network_config 之后 | 远端 netplan 已应用：`apply-network.sh` 内部带网络回滚安全网（一旦失联自动 revert） |
| join_incus 之后 | 已经在 Incus 集群里，但 Ceph 未加入；executor 调 `incus cluster remove <name> --force` |
| join_ceph 之后 | 已加 OSD；不自动回退（rebalance 风暴风险）；标 step.failed + 留 audit 让 admin 决定 |

remove-node 失败：脚本内已有"法定人数检查 + evacuate 超时检查"前置防护；executor 仅记录 + audit。

## 安全 / 鉴权

- 路由位置：`/api/admin/clusters/{name}/nodes`（admin 命名空间）→ `RequireRole("admin")` + `RequireRecentAuthOnSensitive`（step-up）+ `AuditAdminWrites`
- POST add 不算 sensitive（add 不破坏现有节点），但建议加入 step-up 白名单以保险
- DELETE remove 必须走 step-up（destructive，会 evacuate VM）—— 加入 sensitive 路径
- SSH 私钥沿用 `cfg.Monitor.CephSSHKey` + `cfg.Monitor.SSHKnownHostsFile`（与 NodeOps test-ssh 同密钥）
- 输入 validation：hostname `safename`、IP `ip`、SSH user `safename` max 64

## 任务拆分

- [x] **PLAN-026.A** migration 016 + model + sshexec.RunStream + sshexec 单测
- [x] **PLAN-026.B** clusterNodeAdd / clusterNodeRemove executor + dispatch + Params 扩展
- [x] **PLAN-026.C** handler `POST/DELETE /admin/clusters/{name}/nodes` + admin SSE 别名
- [x] **PLAN-026.D** frontend add-node form + remove confirm + JobProgress + i18n
- [x] **PLAN-026.E** build/lint/typecheck/test 全绿 + 部署生产
- [x] **PLAN-026.F** pma-cr 复查 + PR + CI + merge

## 验收

- admin 在 `/admin/nodes` 点"添加节点"，填 hostname/IP/SSH user/key 路径 → 测试 SSH 通 → 提交 → 抽屉变 JobProgress 实时显示 9 步进度 + 日志尾部 → 完成 toast
- 节点行 hover 出 destructive "移除节点" → step-up + 二次输 nodename 确认 → 抽屉 JobProgress 7 步
- 失败任意 step 显示红色 dot + 最后 [ERROR] 行内容
- 后端 `go vet ./...` clean / `go test ./...` 全绿 / audit-coverage 不掉
- 前端 typecheck 0 / vitest 全绿 / build OK / 零 hex 字面量 / 零 arbitrary value

## 不在范围（显式排除，单立 task）

- `cluster/configs/cluster-env.sh` 自动同步新节点（运维脚本静态文件，需手工编辑提交 git）
- maintenance mode（per-node `scheduler.instance=manual`）
- INFRA-003 standalone host 管理（被 INFRA-002 阻塞，PLAN-027 立）
- node6 的实际 e2e 测试（用户决定是否要把 node6 真加入集群；本 PLAN 提供能力，不强制 e2e）
