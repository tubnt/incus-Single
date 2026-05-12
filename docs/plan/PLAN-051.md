# PLAN-051 全平台收口包 —— Session-1/2/3 + QA-009 一次性闭环

- **status**: proposed
- **priority**: P0
- **owner**: claude
- **createdAt**: 2026-05-09
- **scope**: 把 Session-1（安全）/ Session-2（代码异味+正确性+性能）/ Session-3（前端性能+移动端）/ QA-009（功能/UX/i18n/异常）四份审计的 ~110 条 finding，按"是否真实 + 是否必要修 + 是否过度修"三道筛后，按用户旅程组织成单包交付。

---

## 0. 取舍原则（用于过度修筛除）

| 通过 | 不通过 |
|---|---|
| 用户能直接触发的功能错误 / 数据丢失 / 状态机漂移 | 单纯重构（god file 拆分、列表 select 列复用） |
| 安全防线（多层兜底中已存在但未覆盖） | 已存在多重防御只缺最外层加强 |
| 量化收益 ≥ 100ms LCP / ≥ 50ms INP / ≥ 50% bandwidth | <30 ms / 仅"理论收益"的微优化 |
| i18n / a11y 阻碍中文用户阅读关键操作结果 | 不影响理解的次要文案 |
| 跨用户/跨集群一致性破坏 | 仅触发单用户的 UX 不便 |

**Session-3 Phase 1 已落地（gzip + asset cache + refetchOnWindowFocus）不在本包**。本包专注尚未落地的、必要的修复。

---

## 1. 二次复查结果（已经过 graph + Serena 工具直读源码）

> 验证表见附录 A。每条都标注 ✅ CONFIRMED / ❌ FALSE-POSITIVE / ⚠️ NEEDS-MORE-INFO / 🟢 ALREADY-DONE。

### 已剔除的 false positive / 过度修（不进 scope）

| 来源 | 原 finding | 剔除理由 |
|---|---|---|
| QA-009 | AI 诊断面板 XSS | React JSX 自动 escape，无现存风险。本包仅加防御性注释，不写运行时逻辑（详见 §10 杂项）|
| QA-009 | 跨集群迁移阻断 | `MigrateBatchSheet` 由 `clusterName` prop 锁定单集群，路由层即拦截 |
| QA-009 | `/admin` 无 index 跳 | `routes/admin.tsx:23` 已 redirect 到 `/admin/monitoring` |
| QA-009 | SPA fallback 把 `/assets`/`/locales` 回退 index.html | `static.go:81-89` 已修 |
| QA-009 | `usePayOrderMutation` 缺 currentUser invalidate | `billing/api.ts:118` 已 invalidate |
| QA-009 | tickets mutation 全无 onError | api 层无，但所有 call site（5 处）已挂 |
| Session-2 | F-32 sweeper 双 Rollback | 实测 `runtime.go:318-325` 调用顺序是 Finish → 单次 Rollback，无重入。**FALSE POSITIVE** |
| Session-2 | F-67 batch top-up 不走 mutation | `api.ts:68-88` `useBatchUserMutation` 是 useMutation；前端 mutation gate 正常。**FALSE POSITIVE** |
| Session-1 | O7 iframe sandbox（外部监控） | observability 嵌入 Grafana URL 由 admin 配置，非用户输入；O7 改 xterm iframe 上即可，无需扩展到 Grafana iframe |
| Session-1 | O10 `@base-ui-components` RC | 升级影响过大；本包仅 lock 到 commit hash，不切版本 |
| Session-2 | F-08 `pickNextIP` 死代码 | 删除是 surgical clean，可做但不重要；仅作 P3 cleanup |
| Session-2 | F-10/F-12 god file 拆分 | 纯 refactor，无行为修复；**不进本包**，留 OPS-053 |
| Session-2 | F-15/F-16/F-18/F-19/F-30/F-36/F-49/F-69 卫生项 | 共 8 条仅 readability，**不进本包** |
| Session-2 | F-43 `/26` 硬编码 | 当前只有一个生产集群，跨集群差异未到；留 OPS-054 |
| Session-2 | F-71 raw `<select>` | 移动端原生 select 体验更好，Session-3 🔵-8 也确认"仅观察" |
| Session-2 | F-44 `updateVMFiltering` 不重启 | 无证据 PATCH 失效；需先观测，本包**不动** |
| Session-3 | 🔵-1 触控目标 ≥ 44 px | WCAG AAA，非 AA 强制项；移动端实际可点；留 UX-007 |
| Session-3 | 🔵-7 lucide 41 KB | 已 tree-shaken；Session-3 自承认"可不优先" |
| Session-3 | 🟡-M2 `px-4`→`px-3` | 视觉口味；本包不动 |
| Session-3 | 🟡-M3 顶栏右侧操作过密 | 非阻碍功能；留 UX-007 |

### 仍需用户决策才能进 scope（见 §11）

部分项不是"是否做"而是"做到什么程度"，需用户判断（见决策列表）。

---

## 2. 按用户旅程组织 scope

### 2-A. 部署与启动 / 运维上线 — "运维忘配 → 直接裸奔" 关停

| 旧 ID | 内容 | 文件 |
|---|---|---|
| **W1** | `Env=production` 且 `SSH_KNOWN_HOSTS_FILE` 为空 → `os.Exit(1)` | `internal/sshexec/runner.go:350-364` + `cmd/server/main.go` |
| **W2** | `Env=production` 且 `CLUSTER_CA_FILE` 为空 → `os.Exit(1)` | `internal/cluster/manager.go:191-201` + main |
| **W3** | `Env=production` 且 `PASSWORD_ENCRYPTION_KEY` 为空 → `os.Exit(1)` | `internal/auth/password_crypto.go:42` + `cmd/server/main.go:163-166` |
| **W3+** | `repository/vm.go.encryptForWrite` 加密失败：`Env=production` 不再 silent fallback 明文，与 `UpdatePassword` 对称 fail-closed | `internal/repository/vm.go:26-40` |
| **F-03** | `cluster/scripts/join-node.sh` 与 embedded 副本对齐：补 OPS-046 的 4 处 VLAN-pub 子接口逻辑；CI gate `diff -q` | `cluster/scripts/join-node.sh` ⇄ `internal/sshexec/embedded/scripts/join-node.sh` |
| **F-04** | `runtime.Stop(ctx)` 真实存在并被 server.Run 在 SIGTERM 时显式调用（带 30s 超时）；in-flight job 收到 cancel 后写"中断"步骤再退出 | `internal/server/server.go:446` + `internal/service/jobs/runtime.go:207` |
| **F-31** | `runtime.runOne` 不再用 `context.WithTimeout(context.Background(), 30m)`；改注入 graceful ctx，Stop 时 cancel | `internal/service/jobs/runtime.go:207` |
| **F-29** | emergency login per-IP rate limit + 恒等控制流（先 token compare 再 lock check） | `internal/server/server.go:489-536` |
| **3.1 / F-02** | `single/scripts/create-vm.sh` 不再 append 明文密码到 `/root/.vm-credentials` | `single/scripts/create-vm.sh:322` |

**联动**：`deploy/incus-admin.env.example` 把上述 3 个 env 标 `# REQUIRED`，并在 README 部署章节加迁移说明。

### 2-B. 登录 / Auth / step-up — 多租户隔离与会话安全

| 旧 ID | 内容 |
|---|---|
| **W4** | 关键端点（`/api/auth/stepup/*`、emergency endpoint、login callback）独立 5/min 限流；登录前阶段从 `X-Forwarded-For` 取真实 IP（带信任代理白名单） |
| **W5** | 所有写入 Incus REST 的 path/query 段统一 `url.PathEscape` / `url.QueryEscape` |
| **W6** | `auditwrite.go` 对 `r.URL.Query()` 走相同 redact，扩 `code` / `state` 关键词 |
| **W7** | emergency cookie 改 `email|expires_unix|hmac(...)`，5–15 min TTL（默认 10 min） |
| **W8** | WebSocket 控制台 Origin 严格化：`origin == ""` 拒绝；保留显式的 API token 路径例外 |
| **N-03** | 路由 root + admin 都加 `errorComponent`：loader 失败显示 fallback 而非白屏 |

### 2-C. Pay → Provision —— 资金 + IP + VM row 原子化

| 旧 ID | 内容 |
|---|---|
| **F-06** | `OrderHandler.Pay` 引入"saga 兜底" 单事务核心：`PayWithBalance + UpdateOrderStatus + vmRepo.Create + jobRepo.Create` 用单 SQL tx；`allocateIP + Enqueue` 留 tx 外但记 `pending_ip` 列与 `job_pending` 标记，并由 sweeper 在重启 / 失败时收尾。`rollbackPayment` 走 detached `context.WithTimeout(context.Background(), 5s)` |
| **F-26** | `checkQuota` 改 fail-closed（DB 错误返 503 而非放行）|
| **F-25** | `OrderHandler.UpdateStatus` 加 FSM transition 表，副作用（refund / quota release）由 transition 触发 |

### 2-D. VM 列表 / 详情 / 操作 —— admin 路径数据保护 + 减少抖动

| 旧 ID | 内容 |
|---|---|
| **F-01** | `redactInstanceMap` 用前缀规则：`for k := range cfg { if strings.HasPrefix(k, "cloud-init.") || k == "user.cloud-init" { delete(cfg, k) } }`，并补 `redact_test.go` 覆盖新 key |
| **F-50** | `features/vms/api.ts` 13 处 `invalidateQueries({queryKey: vmKeys.all})` 缩窄到 `vmKeys.myList()` / `vmKeys.myDetail(id)` / `vmKeys.clusterList(cluster)`，单次 mutation 不再级联 6+ endpoint refetch |
| **F-54 / F-56** | `useEnableStatefulBatchMutation` / `useEnableStatefulMutation` / `useMigrateBatchMutation` 加 onSuccess invalidate `vmKeys.clusterList(cluster)` |
| **F-58** | admin/vm-detail.tsx `runResetPwd` 加 `confirm({ destructive: true, typeToConfirm: name })`，与 reinstall/delete 对齐 |
| **F-59** | `vms.tsx` `runBatchTrash` 撤销路径区分 `okIds` / `failIds`，仅对 ok 集合调 restoreMutation |
| **F-60** | `cluster-vms-table.runBatch` 改 `Promise.allSettled` per-group + 单点聚合（参考 `vms.tsx runBatchAction`） |
| **F-66** | 后端补原子 `POST /admin/users:batch-topup`，前端 `useBatchTopUpMutation` 包装；invalidate 完成前禁用对话框 |
| **F-65** | `data-table.tsx` 列宽持久化 cleanup 改 `useEffectEvent`（React 19）做 flush；或加 `dirtyRef` + `beforeunload` 收口；拖动期间不每 frame schedule 新 timer |
| **F-72** | `admin/vm-detail.tsx` xterm iframe 加 `sandbox="allow-scripts allow-same-origin"` + `useMemo` 稳定 src（O7 同条目） |
| **N-15** | Floating IP `RELEASE` 二次确认：N>1 强制输 `释放 N 个 IP`，N=1 输入 IP 自身 |
| **F-57** | `nodes/api.ts:241-246` 多个 query 加 `staleTime: 10_000`，避免 focus 风暴 |

### 2-E. Reinstall / 重置密码 —— cloud-init key 一致 + 错误透明

| 旧 ID | 内容 |
|---|---|
| **F-05** | `service/vm.go:598`、`service/jobs/vm_reinstall.go:90` 把 `user.cloud-init` 改 `cloud-init.user-data`；新增 round-trip 测试覆盖"reinstall → 用响应密码登录" |
| **F-37** | `vm_reinstall.go:76,117,138` 三处 `_ = json.Unmarshal(...)` 加 err 检查；async + op.ID 空视为失败 |
| **F-45** | `repository/vm.go:42-55` `decryptOnRead` 解密失败返 sentinel error（不是 nil）；admin 详情接口暴露 `password_status: "decrypt_failed"` 字段，前端用专用文案，区分"未设"vs"密钥轮换" |
| **F-39** | `runtime.runOne` defer `params.Cred.Wipe()` 集中执行，executors 不再各自负责 |

### 2-F. Firewall —— N+1 / DoS / 跨用户绑定 / 长事务

| 旧 ID | 内容 |
|---|---|
| **F-20** | `ListGroups` / `PortalListDefaults` / `PortalListGroups` 改单 SQL JOIN `firewall_groups + firewall_rules`，Go 端按 group_id bucket |
| **F-21** | `replaceDefaultsReq.GroupIDs` 加 `validate:"max=20"`；改 `WHERE id = ANY($1)` |
| **F-22** | `portalRunBatch` 走 jobs runtime（参考 `vm_migrate_batch`）；至少加 worker pool（per-source ≤ 2、global ≤ 4）+ per-item context timeout |
| **F-23** | `AdminBindVM` / `AdminUnbindVM` 检查 `g.OwnerID != nil && *g.OwnerID != vm.UserID` → 422 |
| **F-41** | `EnsureACL` 跨 cluster 任一失败：先记 `firewall_apply_ops` 状态行，sweeper 重做未完成集群 |
| **F-42** | `stop/patch/start` 失败时写 `firewall_apply_ops` 失败行 + sweeper 重做；start 失败的 VM 留 stopped 不再静默 |

### 2-G. Node-join —— 自动化稳定性 + 凭据探测向导

| 旧 ID | 内容 |
|---|---|
| **F-33** | `cluster_node_add.onLine` 500ms tick 批量 flush；环形缓冲只 flush 末尾 N 行 |
| **F-34** | `requestJoinToken` async 分支用 WaitForOperation 拿 token，不再 `return "", "not implemented"` |
| **F-62** | `node-join.tsx` sessionStorage 写入 debounce 300 ms，或只持久化轻量 stage |
| **F-63** | 前端 `computeHeuristics` 删除，全靠后端 ranker；ranked 为空时 NIC 表默认展开 |
| **F-64 / N-13** | `node-join.tsx` reducer 在 `stage/back` 跨阶段回退时清 `lastError`、`fingerprint`、`confirm` 子状态 |
| **3.3** | `cluster/scripts/join-node.sh` `incus cluster list | grep -q "${NODE_NAME}"` 改 `awk -F, '$1==n && $3=="ONLINE"'`（embedded 同步）|
| **3.5** | `apt-get install` 去掉 `2>/dev/null \|\| true` |
| **3.7 / 3.9** | `single/scripts/create-vm.sh` IP 校验复用 `validate_ip` octet 范围；log/err 函数前置 |

### 2-H. SSE / Jobs 进度 —— 重连熔断 + graceful

| 旧 ID | 内容 |
|---|---|
| **N-01 / N-16** | `sse-client.ts` 加 `maxAttempts` / `maxAccumulatedMs`；超过后 `onError(...)` 返 `false` 终止；`use-job-stream.ts` `onError` 累计 5 次或 60s 后 dispatch terminal=`failed` + toast"连接中断，请刷新" |
| **F-28** | `chimw.Timeout(60s)` 移到 sub-router；`/portal/jobs/{id}/stream`、`/console` WS 注册到无 timeout 子 router |
| **F-40** | `broker.go:64-73` Publish 改 RWMutex；snapshot subscribers 后释锁再发 |

### 2-I. i18n / 错误 UX —— 中文用户看到中文

| 旧 ID | 内容 |
|---|---|
| **N-04 / N-05** | 抽 `formatError(e: unknown, t: TFunction): string` helper：识别 `HttpError.code` → i18n 表 → 退回 `e.message`。35+ 处 `toast.error((err as Error).message)` 与 `<AlertDescription>{(...).message}</AlertDescription>` 全部接入 |
| **N-02** | `routes/admin.tsx:31,36` notFoundComponent 走 `t()`，zh/en common.json 各加 `admin.notFound.title` / `admin.notFound.cta`；`href` 与 `admin.tsx:24` 默认 redirect 一致 |
| **N-06** | VM/Node/IP 状态字符串走 `formatVmStatus` / `formatNodeStatus`；归一化为 enum 常量 |
| **N-07** | products / os-templates / firewall description / ticket reply / ssh-key name 加 `maxLength`（与后端 schema 一致），文案 `{n}/{max}` |
| **N-08** | admin/firewall 创建组 + admin/portal tickets reply mutation 前 `trim()` |
| **N-09** | firewall rule 编辑 port-range / CIDR onBlur 校验 + 错误标红 + disabled save |
| **N-10** | top-up customAmount 加 `max`（默认与单次充值上限对齐）+ exceeds 派生态 |
| **N-11** | `MigrateBatchSheet.enableStateful` 失败时清 banner，挂 retry CTA |
| **N-12** | `routes/tickets.$id.tsx` 新增 path-param 子路由（兼容邮件深链）|
| **F-73** | `vm-detail.tsx` portal toast effect deps 去掉 `t`；改用 `firedRef` once-guard |

### 2-J. 性能（Session-3 Phase 2/3） —— 不阻塞功能但量化收益足

| 旧 ID | 内容 |
|---|---|
| **🔴-3a** | CommandPalette 懒加载（lazy + Suspense + 仅 commandOpen 触发） |
| **🔴-3b** | Sonner Toaster 懒加载 |
| **🟡-1** | fontsource @font-face 抽出独立 stylesheet，`<link rel="preload" as="style">` |
| **🟡-5** | i18n 当前语言 `common.json` inline 到 entry chunk；未到时 `<Suspense>` 等 ready |
| **🟡-2** | `index.html` modulepreload 实测命中率 < 50% 的链接降级为 `<link rel="prefetch">` |
| **🟡-4** | `DataTable` 接 `@tanstack/react-virtual`，≥ 100 行启用 |
| **🟡-3** | ws-aware 自适应轮询：ws 已连接时 vms 轮询升 60s |
| **🟡-M1** | `admin/vms` mobile 改卡片视图（仿 portal `/vms` `VMCard`，加批量选择 toolbar）|
| **🔵-5** | xterm `useEffect` 顶部立刻 `new WebSocket(...)`，buffer 后再 `terminal.write` |
| **F-69** | DataTable columns 数组外置，`t()` 移到 cell 内 |
| **F-70** | `TrashBanner` 提取 `<Countdown />` 子组件持有 1s tick |
| **F-68** | `cluster-vms-table.tsx:276-279` `selectedNames` 用 `Set` |
| **F-13 / F-14** | `aiRate` / `probeCache` 后台 60s ticker 清理 |
| **F-7** | `vmListCache` 删（每次走 DB）|
| **F-46 / F-47** | `repository/vm.go` ListPaged 改 `COUNT(*) OVER ()`；IPsByNames 改 `pq.Array(names)` + chunk 1000 |

### 2-K. 杂项卫生

| 旧 ID | 内容 |
|---|---|
| **N-17** | `ai-diagnose-panel.tsx` 顶部加注释 + ESLint 规则禁止该文件用 `dangerouslySetInnerHTML` |
| **N-18** | `web/public/favicon.ico` 加 16x16 fallback |
| **N-19** | SSH key 名 `maxLength={64}` |
| **N-20** | firewall warning 模板走 i18n key 表 |
| **N-21** | MigrateBatchSheet SheetDescription 加 `预计 {{n*30}}–{{n*120}} 秒` |
| **F-67** | dead `useTestSSHMutation` / `useExecSSHMutation` 删除 |
| **F-55** | `downloadClusterEnvScript` AbortController + try/finally revoke blob URL |
| **F-61** | `useGlobalShortcut(key, handler, opts)` helper 抽出，`vms.tsx` + `command-palette.tsx` 共用 |
| **F-30 / S1 O8** | `crypto/rand.Read` 在 `apitoken.Create` 检查 err；`writeJSON` Encode 错误打 slog warn |

---

## 3. 实施顺序（依赖关系）

```
Phase 1：后端安全 + 启动闭环（部署相关，不破前端）
  2-A 全部 → 2-B → 2-C → 2-E (F-39/F-45)

Phase 2：后端正确性
  2-F → 2-H → 2-G 后端部分 (F-33/F-34/3.3/3.5)

Phase 3：前端 UX + i18n + 状态机
  2-D → 2-I → 2-K

Phase 4：性能
  2-J（Session-3 Phase 2 + 3 项目）
```

每个 Phase 内部任务无依赖，可并行；Phase 间串行。

---

## 4. 验收

| 项 | 命令 / 验证 |
|---|---|
| 后端 typecheck + test | `cd incus-admin && go vet ./... && go test ./...` |
| 前端 typecheck + lint + test | `cd incus-admin/web && bun run typecheck && bun run lint && bun test` |
| 构建 | `task web-build && cd incus-admin && go build -trimpath ./cmd/server` |
| Pay 原子性 | 新增 e2e：mock allocateIP fail → 余额不扣、订单 cancelled、无 vm row、无 job row |
| graceful shutdown | 新增集成：触发 SIGTERM 中 in-flight job → DB 看到 `interrupted` step |
| firewall N+1 | `EXPLAIN` ListGroups 单语句 plan tree |
| `redactInstanceMap` | 单测覆盖 `cloud-init.user-data` / `cloud-init.network-config` 都被删 |
| reinstall round-trip | 新增 e2e：触发 reinstall → 拿响应密码 → SSH login 成功 |
| SSE 熔断 | 单测：mock 5 次失败连续触发后 stream.terminal === "failed" |
| 性能 | `curl -I` 含 `content-encoding: gzip` + immutable cache（已落地）；Lighthouse mobile ≥ 80 |
| typed-confirm | 手测 admin 重置密码必须输入 vm name |

---

## 5. 风险

| 风险 | 缓解 |
|---|---|
| W1/W2/W3 fail-fast 让现有 `vmc.5ok.co` 启动失败 | 上线前确认 3 个 env 已落地；无则先做 PR1 配 env，再做 PR2 fail-fast |
| F-06 引入事务可能与现有 `OrderHandler` 中的 PayWithBalance 内部事务嵌套 | 先读 `PayWithBalance` 看是否已 begin/commit；外层用 `tx, err := db.BeginTx(...)` 时只调 repository 而非 handler |
| 限流变化 W4 可能误伤合法重试 | 仅对登录 / step-up / emergency 三类高敏端点；正常 API 不变 |
| N-04/05 formatError 大改 | 迁移用机械替换 + lint 规则禁止"`(err as Error).message` 在 toast/alert 直显" |
| F-50 缩窄 invalidate 漏掉某条 → 用户看不到状态变化 | 每个 key 改动配 e2e；保留 5s `staleTime` 兜底 |
| 卡片视图（🟡-M1）admin/vms 失去批量选择手感 | 复用现有 BatchToolbar 组件；mobile 头部固定 batch 按钮 |
| graceful shutdown 30s 太短 / 太长 | 配置化 `JOBS_GRACEFUL_TIMEOUT`，默认 30s，运维可调 |

---

## 6. 估算

- 后端 Go：~2,500 行（含测试）
- 前端 TS：~1,800 行（含 formatError 抽 + DataTable 虚拟化 + lazy loaders）
- Bash：~150 行（join-node 对齐 + create-vm 修复）
- 文档：env.example / README / changelog

---

## 7. 不在 scope（已识别但本次不做）

- F-08 死代码删除 / F-15/16/18/19/30/36/49 卫生项 → 留 OPS-053
- F-10/F-12 god file 拆分 → 留 OPS-053
- F-43 `/26` 硬编码 → 留 OPS-054（多集群上线时）
- F-44 `updateVMFiltering` 不重启 → 需先观测 Incus 行为
- WCAG 2.5.5 AAA 触控目标 → 留 UX-007
- O3 step-up PKCE / O6 cloud-init 模板白名单 → 见 §11 决策列表（要先决定）
- O1 密码不出响应 → 见 §11 决策列表（涉及前端流程）
- 已落地：Session-3 Phase 1（gzip / asset cache / refetchOnWindowFocus）

---

## 8. 关联任务

OPS-047 / OPS-048 / OPS-049（QA-009 三个修复包提议）→ 全部并入 PLAN-051。

---

附录 A：验证表见 §1。
