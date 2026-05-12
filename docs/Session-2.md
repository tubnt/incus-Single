# Session 2 — 代码异味 / 正确性 / 性能审计

**审计时间：** 2026-05-09
**基线 commit：** `4cb8c52` (`main`)
**覆盖语言：** Go (handler/service/repository/jobs/server)、TypeScript / TSX (web)、Bash (cluster + embedded scripts)
**覆盖文件：** 35+（含 11 个 >500 行的"巨文件"和 50+ 个 >120 行的函数）
**辅助工具：** code-review-graph (`find_large_functions_tool`、`get_architecture_overview_tool`)、Serena (memory)、并行 sub-agent 三路深读

---

## 0. TL;DR — 必须立刻处理

| 编号 | 等级 | 位置 | 简述 |
|------|------|------|------|
| F-01 | **P0 安全** | `handler/portal/vm.go:1028-1034` ⇄ `service/jobs/vm_create.go:112` | redact 漏 `cloud-init.user-data`，所有异步新建 VM 的明文 root 密码可经 `/admin/clusters/{name}/vms`、`/admin/vms`、VM 详情接口被 admin 看到 / 落在浏览器缓存与日志中 |
| F-02 | **P0 安全** | `single/scripts/create-vm.sh:322` | VM 密码明文 append 到 `/root/.vm-credentials`，违反 OPS-022 加密基线与全局「Never log secrets」原则 |
| F-03 | **P0 一致性** | `cluster/scripts/join-node.sh` | 与 `incus-admin/internal/sshexec/embedded/scripts/join-node.sh` 漂移：缺 OPS-046 的 `pub.${VLAN_PUB}` VLAN 子接口绑桥逻辑；运维直接跑会复现 PR #25/#27 修复掉的"VM 全断公网"故障 |
| F-04 | **P0 数据丢失** | `internal/server/server.go:446` + `internal/service/jobs/runtime.go:207,302` | `runtime.Stop()` 从未被调用；SIGTERM 时 in-flight job 跑在 `context.Background()`，进程退出后写到一半的 DB 行无人收尾 |
| F-05 | **P1 功能性** | `internal/service/vm.go:598`, `internal/service/jobs/vm_reinstall.go:90` | Reinstall 写 legacy `user.cloud-init`（已被注释证明 cloud-init datasource 不识别）→ 重装产生的新密码不会真正生效 |
| F-06 | **P1 数据一致性** | `internal/handler/portal/order.go:169-342` | `Pay` 多步写入未事务化：扣款→分 IP→插 vm row→建 job→Enqueue 任一段崩溃留下"已扣费 + creating 状态 VM + 无 job"的孤儿，sweeper 找不到 |

下面是按模块的完整清单，含详细原因 + 修复方向。

---

## 1. Go 后端

### 1.1 `internal/handler/portal/vm.go`（2113 行 — god file）

#### F-01 [P0 安全]｜cloud-init redaction 漏新版 key
- `vm.go:1028-1034` `redactInstanceMap` 仅 `delete(cfg, "user.cloud-init")`
- `service/jobs/vm_create.go:108-112` 注释里明确说 `user.cloud-init` 不被任何 cloud-init datasource 识别，所以新写入的标准 key 是 **`cloud-init.user-data`**
- 走异步路径（PLAN-025 之后绝大多数新 VM）的 cloud-init 明文（含 `password: <hex>`）会从 admin 的 `/admin/clusters/{name}/vms`、`/admin/vms`、`/admin/clusters/{name}/vms/{vmName}` 完整外漏到 admin 浏览器、屏幕快照、httpx 日志
- `redact_test.go` 测的也是旧 key，所以单测全绿，覆盖盲区
- **修复方向：** 同时 `delete(cfg, "user.cloud-init"); delete(cfg, "cloud-init.user-data"); delete(cfg, "cloud-init.network-config"); delete(cfg, "cloud-init.vendor-data")`；测试加新 key 用例；考虑用通用前缀 `for k := range cfg { if strings.HasPrefix(k, "cloud-init.") || k == "user.cloud-init" { delete(cfg, k) } }`

#### F-07 [P1 性能 / 内存泄漏]｜`vmListCache` 无 TTL / 无失效
- `vm.go:900-908`：包级 `map[string]vmListCacheEntry`，只在"获取失败时"读，但**任何成功获取都会写**——cache 永远新鲜
- 卸载一个 cluster 后对应 entry 永不清；多 cluster 的内存随调用线性堆积
- **修复方向：** 直接删（每次都让 `injectDBIPs` 走 DB），或加 5 min TTL + `cluster.Manager` 的 onRemove 钩子

#### F-08 [P2 死代码]｜`pickNextIP` / `ipCacheData` / `atoi` 整套未被引用
- `vm.go:2022-2091`，已被 `ipallocator.allocateIP` 取代
- 留着会让"IP 分配相关"搜索结果污染、测试覆盖率虚高
- **修复方向：** 直接删

#### F-09 [P2 重复代码]｜「fallback to first cluster」模式至少 6 处
- `vm.go:421-423` (`findClusterName`)、`1304-1311`、`1369-1376`、`1460-1467`
- `clustermgmt.go:298,344,416`
- 同样语义但实现略有差异：有的判 `len(clients)==0` 返 503，有的直接 panic 风险
- **修复方向：** 抽 `cluster.Manager.ResolveByQuery(name string) (string, *config, error)` 单一入口

#### F-10 [P2 god file]｜2113 行同时塞 `VMHandler` + `AdminVMHandler`
- Trash/Restore/List 在 portal 与 admin 各一份，逻辑高度相似
- **修复方向：** 拆 `vm_portal.go`、`vm_admin.go`、`vm_redact.go`、`vm_chaos.go`、`vm_trash.go`

#### F-11 [P3 性能]｜`writeJSON` 每次 response 都走 `reflect.ValueOf` 检查 nil slice
- `vm.go:2093-2112`，被 30+ 端点高频调用
- **修复方向：** handler 自己用 `[]T{}` 替代 nil；或单独的 `writeJSONList` helper 不走 reflect

---

### 1.2 `internal/handler/portal/clustermgmt.go`（1253 行）

#### F-12 [P1 god file]｜1253 行 / 8 责任域
- 同文件混 cluster CRUD、节点 lifecycle、env-script 生成（敏感）、AI assist、system-alerts、topology snapshot；`ClusterMgmtHandler` 12 字段
- **修复方向：** 拆 `cluster_crud.go` / `node_lifecycle.go` / `env_script.go` / `ai_assist.go` / `topology.go`

#### F-13 [P1 内存泄漏]｜`aiRate` 永久增长
- `clustermgmt.go:49-51,84-87,1230-1252`：`map[int64][]time.Time`，按 user 累积；调用一次后再不回访的用户保留空切片至进程退出
- **修复方向：** 后台 ticker 周期清理空 slice / 长期未用条目

#### F-14 [P1 内存泄漏]｜`probeCache` GC 仅触发于访问
- `node_probe.go:70-77`：`gcLocked` 在 `put`/`get` 内才跑；流量停滞时过期记录长存
- **修复方向：** 后台 60 s ticker

#### F-15 [P2 重复实现]｜`extractOperationID` ≈ `path.Base`
- `clustermgmt.go:447-454`
- **修复方向：** `import "path"; opID := path.Base(opPath)`

#### F-16 [P2 重复实现]｜`parseHostFromAPIURL` 自己 split URL，IPv6 直接 NotImplemented
- `clustermgmt.go:734-750`
- **修复方向：** `url.Parse` + `Hostname()`

#### F-17 [P2 配置硬编码]｜`GenerateEnvScript` 写死 `202.151.179.X`
- `clustermgmt.go:880-884`，文件被当作 `text/x-shellscript` 直接下载并被运维 `bash <(curl ...)` 跑
- 跨客户/跨机房复用时拓扑直接搬错
- **修复方向：** 从 `cluster_env` 表读，或接受 query 参数前缀

#### F-18 [P2 算法]｜`GenerateEnvScript` 用 bubble sort
- `clustermgmt.go:850-856`
- **修复方向：** `sort.Slice`

#### F-19 [P2 cred 双 wipe]｜success/error 路径都 explicit `cred.Wipe()` + 还有 defer 兜底
- `clustermgmt.go:568-593`
- **修复方向：** 删 explicit Wipe，仅 defer

---

### 1.3 `internal/handler/portal/firewall.go`（996 行）

#### F-20 [P1 N+1 查询]｜`ListGroups` / `PortalListDefaults` / `PortalListGroups` 全部 per-group SELECT rules
- `firewall.go:91-101,591-597,809-818`：50 group 一次页面 = 51 SQL
- **修复方向：** 单 SQL JOIN `firewall_groups + firewall_rules`，Go 端按 group_id bucket

#### F-21 [P1 拒绝服务]｜`PortalReplaceDefaults` 没限定 `GroupIDs` 上限
- `firewall.go:840-859`：`validate:"dive,gt=0"` 没 max；攻击者可一次提交 1000 个 ID
- **修复方向：** `validate:"max=20"`；改成 `WHERE id = ANY($1)` 单 SQL

#### F-22 [P1 一致性]｜`portalRunBatch` 串行 stop+patch+start，最多 64 VM 全在一次 HTTP 请求里
- `firewall.go:921-987`：chi 60s timeout 中途砍断，前 N 个已经被改 ACL 的 VM 已重启，后 M 个状态不明
- **修复方向：** 走 jobs runtime（参考 `vm_migrate_batch`）；至少加 worker pool + per-item context timeout

#### F-23 [P1 跨用户绑定]｜`AdminBindVM`/`AdminUnbindVM` 不校验 group owner ↔ vm.UserID
- `firewall.go:463-498,500-536`：admin 路径允许把用户私有 group 绑到另一个用户的 VM
- 之后 detach 找不到正确 group_id（namespace `fwg-u<owner>-<slug>` 假设破坏）
- **修复方向：** admin 路径若 `g.OwnerID != nil && *g.OwnerID != vm.UserID` → 422

#### F-24 [P2 重复代码]｜`BindVM` / `AdminBindVM` 几乎逐行重复
- `firewall.go:354-432` ⇄ `463-536`，仅 `audit.via` 不同
- **修复方向：** 抽 `bindCommon(w, r, vmID, requireOwner bool, via string)`

---

### 1.4 `internal/handler/portal/order.go`（526 行）

#### F-06 [P0 数据一致性]｜`Pay` 多步写入未事务化
- `order.go:169-342`：扣款 → 分 IP → 插 vm row → 建 job → Enqueue
- 任一中段崩溃 → 用户被扣费 + IP 已分 + `creating` 状态 VM + 无 provisioning_jobs 行 → sweeper 找不到 → 永不收尾
- **修复方向：** `pay + vm row + job row` 单事务（IP 分配可以放外部，但要把 ip→job_id 关联落地，rollback 路径能反查并释放）

#### F-25 [P1 状态机缺失]｜`UpdateStatus` admin 端任意流转
- `order.go:438-454`：admin 可把 `active → pending → cancelled → paid`，无 FSM 校验，配额 / 退款 / 余额账连带漂移
- **修复方向：** 显式定义 transition 表，副作用（refund、quota release）由 transition 触发

#### F-26 [P1 fail-open]｜`checkQuota` 在 DB 错误时放行
- `order.go:489-503`：评论说 "不阻塞 payment"，但 `MaxVMs` 这种硬上限 fail-open 等于 DB 一抖用户就能突破
- **修复方向：** 硬上限 fail-closed + audit；软上限 fail-open

#### F-27 [P1 ctx 取消]｜`rollbackPayment` 沿用 caller `ctx`
- `order.go:458-478`：HTTP 已超时取消时，refund / IP release / status update 可能只跑了一半
- **修复方向：** detach 到 `context.WithTimeout(context.Background(), 5*time.Second)` 的新 ctx

---

### 1.5 `internal/server/server.go`（575 行）

#### F-04 [P0 数据丢失]｜SIGTERM 不等 jobs runtime
- `server.go:446-453` 没有调用任何 `jobs.Runtime.Stop()`；in-flight 跑在 `context.Background()` (`runtime.go:207`)，进程退出时被强杀
- 配合 F-06，留下"用户已扣费 / VM row creating / instance 在 Incus 一半"的孤儿
- **修复方向：** 维护 `[]Closer` 列表，shutdown 时 `srv.Shutdown(ctx)` → `for _, c := range closers { c.Shutdown(timeoutCtx) }`

#### F-28 [P1 SSE 被砍]｜全局 `chimw.Timeout(60*time.Second)`
- `server.go:169`：所有 handler 都被 60 s ctx cancel，包括 `/portal/jobs/{id}/stream` SSE 与 console websocket
- 表现：长 reinstall 在前端 60 s 时被强 close，UI 误以为失败
- **修复方向：** 移到 sub-router；流式 endpoint 在没有 timeout 的子 router 注册

#### F-29 [P1 timing leak]｜emergency login 锁定检查不恒时
- `server.go:489-536`：lock check 早于 token compare；`failCount` 全局非 per-IP
- **修复方向：** 控制流恒等；per-IP rate limit（小 LRU 即可）

#### F-30 [P3 静默错误]｜`writeJSON` 吞 `Encode` 错误
- `server.go:545-549`
- **修复方向：** 加 slog warn

---

### 1.6 `internal/service/vm.go`（930 行）+ `service/jobs/*`

#### F-05 [P1 功能性 + 安全副作用]｜Reinstall cloud-init key 错位
- `service/vm.go:598`：`inst.Config["user.cloud-init"] = cloudInit`
- `service/jobs/vm_reinstall.go:90`：同样 legacy key
- 注释（`vm_create.go:108-110`）明确说这个 key 不被任何 cloud-init datasource 认识 → 新生成密码不会落进 guest
- 用户重装后用响应里的新密码登不上，反而旧 cloud-init.user-data 中的老密码（如果残留）才有效；与 reset_password offline path 行为不一致
- **修复方向：** 改写 `cloud-init.user-data`；测试覆盖一次 reinstall→密码可用 round-trip

#### F-31 [P0/P1 影子]｜`runtime.Run` 用 `context.WithTimeout(context.Background(), 30*time.Minute)`
- `runtime.go:207`：worker 不响应 parent ctx，这是 F-04 的根因
- **修复方向：** 注入 `gracefulCtx`，`Stop()` 时 cancel；executor 内部步骤检查 ctx

#### F-32 [P1 双重 Rollback]｜sweeper 对已 rollback 过的 job 再 Rollback 一次
- `runtime.go:314-331`：sweeper 调 `Finish` 后再走 `dispatch().Rollback`
- 不少 Rollback 不幂等（创建 vm 已退过款再退一次需要 RefundOnce 真的原子，否则双退）
- **修复方向：** 在 jobs 表加 `rolled_back_at TIMESTAMPTZ`，sweeper 只回收 `null` 的；或者 `running_lock` 防 concurrent rollback

#### F-33 [P1 DB write storm]｜`cluster_node_add.onLine` per-line `UpdateStep`
- `cluster_node_add.go:162-189`：远程脚本每行 stdout 一次 `BEGIN/UPDATE/COMMIT`；apt-install / image pull 输出可达数千行
- 5 并发节点加入 → Postgres 连接池耗尽
- **修复方向：** 500ms tick 批量 flush；保留环形缓冲在内存中只 flush 末尾 N 行
- 同症状：`cluster_node_remove.go:138-151`、`vm_migrate_batch.go:98-113`

#### F-34 [P1 broken happy-path]｜`requestJoinToken` async 分支直接 `return "", "not implemented"`
- `cluster_node_add.go:261-271`：Incus 任何小版本变动到 async 响应，整个 add-node 路径报 opaque error
- **修复方向：** WaitForOperation 之后 GET op metadata 取 token；或在集群注册阶段拒绝

#### F-35 [P2 mu 锁内 DB IO]｜`onLine` 持锁调 `UpdateStep`（add / remove）
- 当前 RunStream 是单 goroutine 调 onLine，所以暂时安全；但模式脆弱
- **修复方向：** 锁保护 marker 决策，DB 写在锁外

#### F-36 [P2 dead variable]｜`cluster_node_add.stepFailedSent` 永不置 true
- **修复方向：** 删

#### F-37 [P1 错误吞咽]｜vm_reinstall executor `_ = json.Unmarshal(...)` 处处忽略
- `vm_reinstall.go:76,117,138`：op.ID 解析失败被吞 → 跳过 WaitForOperation → recreate 撞 "instance still exists"
- **修复方向：** 检查 unmarshal err；async 响应 + 空 op.ID 视为失败

#### F-38 [P2 Params god struct]｜`jobs/executor.go:23-86` Params 累积所有 executor 字段
- 每个 executor 只读子集；漏传字段静默走 zero-value
- **修复方向：** per-kind 子 struct + interface 或 oneof

#### F-39 [P2 Credential Wipe 依赖每个 executor 自觉]
- `executor.go` + `cluster_node_add.go:208-211`，`vm_reinstall` 没 wipe
- **修复方向：** 集中在 `runOne` defer `takeParams` 时统一 Wipe

#### F-40 [P2 broker 锁过粗]｜`broker.go:64-73` Publish 持 Mutex 遍历所有 sub channel
- 多 SSE 订阅者 + 多 publisher 时序列化
- **修复方向：** RWMutex（RLock 在 Publish）；或 snapshot subscribers 后释锁再发

---

### 1.7 `internal/service/firewall.go`

#### F-41 [P1 部分一致]｜`EnsureACL` 跨 cluster 任一失败留下脏状态
- `firewall.go:117-132`：第一个 cluster 写成功，第二个失败 → return err，已写的不回滚 → DB row 已新版本，Incus 旧版本
- **修复方向：** per-cluster sync_status 表；或 all-or-nothing + 回滚 PUT

#### F-42 [P1 stop/patch/start 无幂等记录]
- `firewall.go:174-254`：start 失败时 VM 留 stopped 无审计
- **修复方向：** `firewall_apply_ops` 行 + sweeper

---

### 1.8 `internal/service/floating_ip.go`

#### F-43 [P2 `/26` 与 `eth0` 硬编码]
- `floating_ip.go:92-105`，runbook hint 拼接出错
- **修复方向：** 从 cluster config 读

#### F-44 [P2 `updateVMFiltering` 不重启 VM]
- `floating_ip.go:44-86`：与 firewall PATCH 不同，没有 stop/start；如果 `security.ipv4_filtering` Incus 不支持 live PATCH 就静默无效
- **修复方向：** 验证 Incus 行为；必要时同步 stop+patch+start

---

### 1.9 `internal/repository/vm.go`（612 行）

#### F-45 [P1 silent decrypt failure]｜`GetByID` 解密失败返 nil 密码
- `repository/vm.go:81-84`：用户看到 "VM 没密码"；admin 无法分辨"未设"vs"密钥轮换坏了"
- **修复方向：** 返加密 blob + sentinel error；admin 端单独诊断接口

#### F-46 [P2 ListPaged race]｜COUNT 与 SELECT 分两步
- `repository/vm.go:110-134`：并发插入时 total 可能与 rows 不一致
- **修复方向：** `COUNT(*) OVER ()` 单 SQL

#### F-47 [P2 IPsByNames 无上限]｜`IN ($1,$2,...)` 任意长度
- `repository/vm.go:157-186`：N 大时 PG 参数表炸
- **修复方向：** 单参数 `pq.Array(names)` + chunk 1000

#### F-48 [P2 不一致策略]｜`Create` 加密失败 silent fallback 明文，`UpdatePassword` 加密失败 fail
- `repository/vm.go:26-40` vs `195-204`
- **修复方向：** 统一 fail-closed（不要悄悄写明文）

#### F-49 [P3 9× 重复 SELECT 列表]
- 19 列粘贴 9 次
- **修复方向：** `const vmSelectCols = "..."` 统一

---

## 2. TS 前端

### 2.1 `web/src/features/vms/api.ts`（530 行）

#### F-50 [P1 性能 — cascade refetch storm]
- 几乎所有 mutation 都 `queryClient.invalidateQueries({ queryKey: vmKeys.all })`（行 146/228/246/291/321/345/353/392/438/480）
- `vmKeys.all = ["vm"]` → 一次 stop 触发 portal myList + myDetail + 每个 cluster 的 list/detail + gone + trash 全部 refetch
- **修复方向：** 每个 mutation 缩窄到真正影响的 key（`myList()` + `myDetail(id)`、`clusterList(cluster)`）

#### F-51 [P2 IP 提取偏好不当]｜`extractIP` 取 `Object.entries(network)` 第一个 inet+global
- `vms/api.ts:520-529`：可能取到 `vrrp-*` floating IP 而不是 VM 主 IP
- **修复方向：** 优先 `eth*` / `enp*` / `ens*`，去优先 `vrrp*`/`vnet*`/`tap*`

#### F-52 [P2 trash 轮询永不停]｜`useMyTrashedQuery` 每 5 s 轮询
- `vms/api.ts:185-192`：trash 长期为空时仍打接口
- **修复方向：** `refetchInterval: q => (q.state.data?.vms.length ?? 0) > 0 ? 5000 : false`

#### F-53 [P3 type unsafety]｜`intent.args: params as unknown as Record<string, unknown>`
- 抽 `Intent<T>` 泛型

---

### 2.2 `web/src/features/nodes/api.ts`（713 行）

#### F-54 [P1 缺 invalidate]｜`useEnableStatefulBatchMutation` / `useEnableStatefulMutation` 无 onSuccess invalidate
- `nodes/api.ts:207-239`：批量启用 stateful 后 cluster VMs 表仍显示旧 `migration.stateful` 直到 10 s 轮询；用户看到没变化又点一次 → 已 stateful 的 VM 被无谓重启
- **修复方向：** invalidate `vmKeys.clusterList(cluster)`

#### F-55 [P1 blob 泄漏]｜`downloadClusterEnvScript` 无 AbortController
- `nodes/api.ts:663-693`：step-up 跳转中途，blob URL 未 revoke、`<a>` append/click 在已卸载的 body 上
- **修复方向：** 暴露 AbortController；try/finally revoke

#### F-56 [P2 缺 invalidate]｜`useMigrateBatchMutation` 不 invalidate `vmKeys.clusterList`
- 节点列变化但 VM 列表不刷
- **修复方向：** 同上加一行

#### F-57 [P2 轮询冲突 focus]
- `nodes/api.ts:241-246`、`web/src/features/vms/api.ts:199` 等：`refetchInterval` + 默认 `refetchOnWindowFocus: true` + `staleTime: 0` → tab 切回 +1 次
- **修复方向：** `staleTime: 10_000` 或 `refetchOnWindowFocus: false`

---

### 2.3 大组件

#### F-58 [P1 缺 typed-confirm]｜admin `runResetPwd` 没有打字确认
- `web/src/app/routes/admin/vm-detail.tsx:200-220,355`
- 同文件 `runReinstall`、`runDelete` 都用 `confirm({ typeToConfirm: name })`，唯独 reset password 直接点按钮就走
- 重置生产 VM root 密码无法回滚；新密码只显示 20 s
- **修复方向：** 套 `useConfirm({ destructive: true, typeToConfirm: name })`

#### F-59 [P1 partial failure 误导]｜`vms.tsx runBatchTrash` undo-all 包含失败 id
- `web/src/app/routes/vms.tsx:222-256`：toast 显示「全部撤销」按钮，点击后对所有 id 调 restoreMutation；失败的那部分会安静返 4xx 用户没感知
- **修复方向：** 维护 `okIds: number[]`，仅对 ok 集合 undo；失败明示

#### F-60 [P1 closure race]｜`cluster-vms-table.runBatch` 多组并发 + 共享计数器
- `web/src/features/vms/components/cluster-vms-table.tsx:110-162`：partial fail 后 `pending`/`summaries` 累积错位，`clearSelection()` 看哪一组最后到
- **修复方向：** `Promise.allSettled` per-group + 单点聚合（参考 `vms.tsx runBatchAction`）

#### F-61 [P1 全局 keydown 重复实现]
- `web/src/app/routes/vms.tsx:104-147` 与 `command-palette.tsx:80-98` 各写一份 INPUT/dialog/cmdk 守卫
- 前情：项目 memory 记载过 `querySelectorAll` 没 scope 导致误删 vm 的事故 — 多份重复手写 keydown 是同类问题的温床
- **修复方向：** 抽 `useGlobalShortcut(key, handler, opts)`

#### F-62 [P1 sessionStorage 写入风暴]｜`node-join.tsx` 每次 dispatch 全量序列化
- `web/src/app/routes/admin/node-join.tsx:231-238`：`useEffect` 依赖 `[state]`，整个 wizard state（含 `confirm.node` 的 NodeInfo / interfaces / disks / pci_devices）每键入一次重 stringify+setItem
- **修复方向：** debounce 300ms；或只持久化轻量 stage + 表单字段

#### F-63 [P1 前端硬编码 IP 启发式]｜`computeHeuristics` 写死 `10.0.10.` / `10.0.20.` / `10.0.30.`
- `node-join.tsx:1148-1175` ⇄ 后端 ranker 已在做同样判断
- 拓扑变更时两边漂移 → 用户拿到错误默认值且 NIC 表被自动折叠隐藏
- **修复方向：** 删除前端启发式，全靠 `applyRankedPicks`；ranked 为空时 NIC 表默认展开

#### F-64 [P1 lastError 跨 stage 残留]｜`node-join.tsx`
- 行 199-202 dispatch error 不在 stage/back 清掉 → 用户回退到 cred 步骤会看到 fingerprint 步骤的错误
- **修复方向：** stage/back reducer 清 `lastError`

#### F-65 [P1 effect cleanup 击穿 debounce]｜`data-table.tsx` 列宽持久化
- `web/src/shared/components/ui/data-table.tsx:127-148`：cleanup 同步 flush + setTimeout 300ms 双写；拖列宽时 cleanup 在每次 effect 重跑触发，debounce 形同虚设
- **修复方向：** `useEffectEvent`（React 19）做 flush；或 `dirtyRef` + `beforeunload` 收口

#### F-66 [P1 batch 财务操作非原子]｜`admin/users.tsx` 批量充值
- `web/src/app/routes/admin/users.tsx:161-199`：N 次独立 `http.post`，partial fail 仅展示 ok/fail 数量、无逐项错误；`setBatchPending(false)` 早于 invalidate → 短窗口内可重复提交，二次扣款
- **修复方向：** 后端加 `POST /admin/users:batch-topup` 原子端点；前端在 invalidate 完成前禁用对话框

#### F-67 [P1 mutation 隔离失效]｜users.tsx top-up 用裸 `http.post` 不走 mutation
- 行 163：`batchMutation.isPending` 永远是 false，role-change 按钮在 top-up 进行中仍可用 → 跨 mutation race
- **修复方向：** 抽 `useBatchTopUpMutation`；或共享 `anyBatchPending`

#### F-68 [P2 selector O(N×M)]｜`cluster-vms-table.tsx:276-279` `Array.includes` 嵌套
- N=200, M=50 → 每次勾选 10 000 string compare
- **修复方向：** `selectedNames` → `Set` + `useMemo`

#### F-69 [P2 columns 重建]｜`cluster-vms-table.tsx:272` `t` 进 deps，TanStack Table 整列重 shape
- 语言切换或父级 prop 变动都触发
- **修复方向：** 列结构外置；cell 内调 `t()` 单元格级再渲染

#### F-70 [P2 banner 整表每秒重渲]｜`vms.tsx TrashBanner` `setNow` 1s ticker
- 行 442-446：items 多时浪费
- **修复方向：** `<Countdown />` 子组件持有自己的 1 s tick

#### F-71 [P2 raw `<select>`]｜`cluster-vms-table.tsx:304-319`
- 违反「UI 全部走 headless 库」基线；视觉与无障碍不一致
- **修复方向：** 替换为 `Select` 组件

#### F-72 [P2 iframe 安全]｜`admin/vm-detail.tsx:393-398` 子 iframe 缺 `sandbox`
- 同源 iframe 跑 xterm，无沙箱属性
- **修复方向：** 加 `sandbox="allow-scripts allow-same-origin"` + `useMemo` 稳定 src

#### F-73 [P2 i18n 抖动 toast 双发]｜`vm-detail.tsx (portal)` 行 87-104 effect deps 含 `t`
- 切语言时 reinstall success toast 重发
- **修复方向：** `firedRef` once-guard

---

## 3. Bash 脚本

### 3.1 P0 — `single/scripts/create-vm.sh:322` 明文密码落盘
- `echo "${VM_NAME}: user=ubuntu password=${VM_PASS} ip=${VM_IP}" >> "${CREDENTIAL_FILE}"`
- 与 OPS-022 加密基线（incus-admin 已 AES-256-GCM）完全相反；append 方式让历史 VM 密码全部累积
- **修复方向：** 不落盘（一次性 stdout 给用户记录），或 `openssl enc -aes-256-gcm -k <key>` 写出；最低限度 `umask 077` + 单文件覆盖+轮转

### 3.2 P0 — `cluster/scripts/join-node.sh` 与 embedded 副本漂移
- embedded 版（648 行）已经合入 OPS-046 的 4 处补丁：netplan 加 `pub.${VLAN_PUB}` 子接口；br-pub slave 改 VLAN 子接口；`do_join_incus` 末尾 `incus network set ... bridge.external_interfaces`；`do_verify` 加子接口校验
- cluster/scripts 副本（607 行）缺这些 → 运维直接跑会复现 PR #25/#27 修掉的"VM 全断公网"故障
- 这是 ops026 / firewall_mechanism 内存里强调过的高风险路径
- **修复方向：** 让 cluster/scripts/join-node.sh 软链 → embedded 那份；或 CI gate `diff -q`；或直接 backport 4 处补丁

### 3.3 P1 — `incus cluster list | grep -q "${NODE_NAME}"` 子串匹配
- `cluster/scripts/join-node.sh:422,528` 与 embedded 同处
- `node1` 已存在时 `node10` 加入会被误判已加入；admin 自动化 join 报"成功"
- **修复方向：** `incus cluster list --format csv | awk -F, -v n="$NODE_NAME" '$1==n && $3=="ONLINE"'`

### 3.4 P1 — SSH `accept-new` TOFU
- `cluster/scripts/join-node.sh:443/454/475` 与 embedded 467/478/499
- bootstrap 节点首次 fingerprint 无条件接受；admin 主控通过 SSH 远程跑 join 时风险被放大
- **修复方向：** 提前由调用方写 known_hosts；脚本改 `StrictHostKeyChecking=yes`

### 3.5 P1 — `apt-get install ... 2>/dev/null || true`
- `cluster/scripts/join-node.sh:285` 与 embedded 同处
- `jq nftables python3 bridge-utils` 是后续步骤硬依赖；安装失败被吞，后面才在 ceph 解析处突然 `python3: command not found`
- **修复方向：** 去掉 `2>/dev/null || true`，让 `set -e` 终止

### 3.6 P1 — `setup-healing.sh:90-109` voter 探测在分区时假阴性
- fallback 到 "0 0" 让 `--apply` 路径直接退出，不重试也不区分"集群暂不可达"vs"voter 真不够"
- **修复方向：** `incus cluster list` 直接探，区分两种情况 + 重试

### 3.7 P1 — `single/scripts/create-vm.sh:114` IP 校验仅 `^\d+\.\d+\.\d+\.\d+$`
- `999.999.999.999` 通过；与 join-node.sh 的 `validate_ip`（带 octet 范围）不一致
- **修复方向：** 复用 `validate_ip`，抽公共 lib

### 3.8 P1 — `single/scripts/create-vm.sh` cloud-init here-doc 未严格转义
- L254-308：`${VM_HASH}`/`${VM_PASS}` 直接插值进 yaml；目前侥幸（SHA512 crypt 输出无 yaml 危险字符），但脆弱
- **修复方向：** 用 `python3 -c "import yaml,sys; ..."` 或 `yq` 生成 yaml

### 3.9 P1 — `single/scripts/create-vm.sh:23,35,38` `auto_detect_network` 在 `err()` 定义之前调用
- bash 函数解析延迟救场，但走 err 分支会 `err: command not found` + `set -e` 退出
- **修复方向：** log/err 函数定义前置

### 3.10 P2 — `cluster/scripts/setup-healing.sh:201-225` 死代码块
- 自己注释承认"重定向不对"，下方 L227-231 已重新实现；上面 14 行 python 仍每次跑一遍 → VM 列表打三次
- **修复方向：** 删 L201-225

### 3.11 P2 — `ceph-status.sh` 单脚本 fork python 19 次 / 调用
- L111-408 散布 19 块 `python3 -c "..."`；`--watch 1` 每秒重启解释器 19 次
- **修复方向：** collect_data + 渲染合到一个 python 块，bash 只负责终端控制

### 3.12 P2 — `ceph-status.sh` 缺 `command -v python3` 校验
- L83 仅校验 ceph
- **修复方向：** 同步加 python3 检查

### 3.13 P2 — `single/scripts/create-vm.sh:137-138` virtio-win.iso 拉取无 checksum
- 中间人 / CDN 投毒 → 恶意驱动
- **修复方向：** 写死 sha256sum；或镜像到内部 OSS

### 3.14 P3 — 通览：所有 5 个脚本顶部都 `set -euo pipefail`；未发现 `eval` / `curl|bash` / 未引用 `rm -rf $X` / `kill $(lsof -ti:PORT)` 等明文红线模式

---

## 4. 跨切面建议（一次性收口最划算的 5 件事）

| # | 收口主题 | 涉及条目 | 估算收益 |
|---|---------|----------|---------|
| 1 | **cloud-init 一致化（key + redact + reinstall）** | F-01 / F-05 / F-37 | 关闭明文密码外泄 + 重装恢复密码功能 |
| 2 | **Jobs runtime graceful shutdown + sweeper rollback 防双跑** | F-04 / F-31 / F-32 / F-33 | 重启/部署期不再丢/重复 in-flight job |
| 3 | **TanStack Query 缩窄 invalidation key + 缺失 invalidate 补齐** | F-50 / F-54 / F-56 | 一次 mutation 不再 refetch 6+ endpoint |
| 4 | **批量操作走 jobs runtime（财务 / 防火墙 / VM）** | F-22 / F-66 / F-59 / F-60 | 解决 chi 60s 截断与 race 引发的多种数据不一致 |
| 5 | **`cluster/scripts/join-node.sh` ↔ embedded 单一来源** | F-03 | 阻断「运维直接拷脚本跑 → VM 全断公网」事故复发 |

---

## 5. 已经验证 vs 仍需 follow-up

**已验证（执行 grep / 读源 / 工具回链确认）：**
- F-01：grep `user.cloud-init` / `cloud-init.user-data` 三套写入对照、redact_test 仅覆盖 legacy
- F-08：`pickNextIP` grep 全仓 0 caller
- F-03：`diff` cluster vs embedded（agent 已对照）
- F-04 / F-31：`Stop()` grep 在 server.go 0 命中

**建议在修复时再二次验证：**
- F-22 firewall batch 是否真的串行 stop+patch+start：建议补 e2e 测试
- F-32 sweeper rollback 双跑：在 jobs 表加 `rolled_back_at` 列后写一个 race test
- F-65 data-table cleanup debounce 击穿：手测拖动 + 控制台 `localStorage.setItem` 观察实际写入频率
- F-12 / F-10 god file 拆分：建议在拆分 PR 中跑 `code-review-graph detect_changes` 确认 callers 不被影响

---

## 附录：审计时的工具调用路径

1. `code-review-graph` `find_large_functions_tool(min_lines=120, kind=Function)` — 50 个超大函数定位
2. `code-review-graph` `find_large_functions_tool(min_lines=500, kind=File)` — 21 个超大文件定位
3. `code-review-graph` `get_architecture_overview_tool` — 130 community 拓扑（offload 到 jq 处理）
4. `code-review-graph` `list_graph_stats_tool` — 总量 369 文件 / 2861 节点 / 25391 边
5. Serena memory：`project_overview`、`feedback_*`、`firewall_mechanism`、`ops026_overview` 提供项目历史决策
6. 三路并行 sub-agent 深读：Go (jobs/handlers/repo)、TS (大组件/api)、Bash (5 个脚本)
7. 主线直读：`vm.go` 全文、`service/vm.go` Create/Reinstall、`vm_create.go` 全文（验证 cloud-init key 漂移）、`ipallocator.go`（确认 pickNextIP 死代码）
