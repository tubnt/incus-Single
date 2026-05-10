# Session-1 — 安全审计报告

- 仓库：`/workspace/incus`（incus-admin Go 后端 + React/TS 前端 + cluster/single shell 脚本）
- 时间：2026-05-09
- 范围：完整代码库的安全风险扫描，覆盖注入、越权、密钥与加密、依赖漏洞、前端 XSS/CSRF、SSH/远程执行、审计与日志、配置与部署
- 方法：code-review-graph 概览 + 6 个并行 Explore agent 专题取证 + 关键文件手工复验调用链
- 严重程度：🔴严重（生产环境可被利用 / 已确认风险）/ 🟡警告（条件性可利用或部署陷阱）/ 🔵优化（防御加固建议）

---

## 总览

| 等级 | 数量 |
| ---- | ---- |
| 🔴 严重 | 0 |
| 🟡 警告 | 8 |
| 🔵 优化 | 11 |

整体安全态势良好，未发现可被未授权用户直接利用的高危漏洞。SQL 注入、命令注入两类经典风险经全量扫描确认不存在（所有数据库操作走 `database/sql` 占位符；外部命令一律走 `sshexec.Runner.RunArgs` POSIX 单引号转义；项目从不调用 `os/exec`）。主要问题集中在**部署默认值不安全**与**深度防御不足**两类：若运维按 `deploy/incus-admin.env.example` 默认部署而忽略安全提示，会出现 SSH 主机密钥不校验、VM 密码明文落库、Incus mTLS 不校验 CA 等"配置失守即裸奔"的局面。

---

## 🟡 警告

### W1. SSH 主机密钥校验默认 fail-open（MITM 风险）
- 文件：`incus-admin/internal/sshexec/runner.go:350-364`
- 风险：未配置 `SSH_KNOWN_HOSTS_FILE` 时，`hostKeyCallback()` 直接返回 `ssh.InsecureIgnoreHostKey()`，仅打 warn 日志放行，所有 SSH 流（节点加入、Ceph 部署、节点维护、cloud-init 注入、env-script 同步）都会接受任意服务器密钥。生产链路若网络出现 MITM（云厂商内部网络、wg 隧道劫持），可被攻击者中间人窃取节点 SSH 凭据/私钥。
- 修复：启动时若 `Config.Monitor.SSHKnownHostsFile` 为空且 `Env=production` 应直接 `os.Exit(1)`；保留警告回退仅在 `Env=test/dev`。`deploy/incus-admin.env.example:33` 改为强制非空示例值并提供生成脚本。

### W2. Incus 集群 mTLS 在无 CA 时退化为 `InsecureSkipVerify=true`
- 文件：`incus-admin/internal/cluster/manager.go:191-201`
- 风险：`CLUSTER_CA_FILE` 为空时 `tlsConfig.InsecureSkipVerify=true`。当前依赖 `BuildPinnedTLSConfig` 的 SPKI TOFU 兜底（首次连接学习指纹），但**第一次连接没有任何保护**。如果首次启动的网络已被劫持，pin 会被钉到攻击者证书上。生产部署初次接管集群时风险最高。
- 修复：`Env=production` 且 `CAFile==""` 启动直接 fail；或要求运维通过带外通道（hand-verify fingerprint）落地首次 pin 后再起服务。

### W3. VM 密码加密"静默 passthrough"模式
- 文件：`incus-admin/internal/auth/password_crypto.go:42`、`80-82`；`incus-admin/cmd/server/main.go:163-166`
- 风险：`PASSWORD_ENCRYPTION_KEY` 为空时 `EncryptPassword` 直接 passthrough 把明文写入 `vms.password`，仅 `slog.Warn` 一行启动日志。运维忘配 env / 误清空 → 全部新建 VM 密码明文落库。OPS-022 设计本意是"过渡期兼容"，但生产无安全网。
- 修复：与 W1/W2 同理，`Env=production` 且 key 为空启动 fail；或在 main.go:166 后加 `if cfg.Server.Env == "production" && cfg.Auth.PasswordEncryptionKey == "" { os.Exit(1) }`。

### W4. RateLimit 单一限流策略 + 代理后退化为单 key
- 文件：`incus-admin/internal/middleware/ratelimit.go:59-78`
- 风险：(a) 全局 30/分钟 单一限流，没有针对 step-up 入口、emergency cookie 验证、API token 验证、登录回调等高敏端点的强限流；(b) 限流 key 优先用 `r.RemoteAddr`，但当 oauth2-proxy 或 nginx 在前置时所有请求 RemoteAddr 是代理本地地址，全集群共享一个桶，登录前任意用户可互相耗尽彼此的配额（DoS 用户登录），或攻击者借此造成所有未登录请求被 429。
- 修复：(1) 关键端点 `/api/auth/stepup/*`、`/login`、emergency endpoint 注册独立 5/分钟 限流器；(2) 登录前阶段从 `X-Forwarded-For` 取真实客户端 IP（注意做信任代理白名单避免伪造头）。

### W5. Incus REST 路径段未做 URL 编码
- 文件：`incus-admin/internal/handler/portal/console.go:77`、`clustermgmt.go:309`、`clustermgmt.go:380`、`vm_create.go:92` 等
- 代码：`fmt.Sprintf("/1.0/instances/%s/exec?project=%s", vmName, project)`、`fmt.Sprintf("/1.0/cluster/members/%s", nodeName)`
- 风险：VM 名 / 节点名 / project 名直接拼入 URL path 与 query，未经 `url.PathEscape` / `url.QueryEscape`。当前模型层正则阻止特殊字符是主要防线，但纵深防御缺失：若任何一处校验被绕过（admin 后门 import、未来新接口忘了校验、`project` query 完全没校验），可造成 path traversal（`vmName="x/../../cluster"`）或 query 参数覆盖（`vmName="x?project=admin"`）。
- 修复：所有写入 Incus REST 的 path/query 段统一用 `url.PathEscape` / `url.QueryEscape` 包裹；非 admin 路径中 `project` 字段也应做白名单校验（仅允许已配置的 project name 集合）。

### W6. 审计中间件未对 query string 做 redact
- 文件：`incus-admin/internal/middleware/auditwrite.go:111-113`
- 风险：`details["query"] = r.URL.RawQuery` 原样写库，但 `redactJSONBody` 仅对 body JSON 递归 redact。如果敏感参数（OIDC `code` / `state` / 一次性 token / 短期访问令牌）以 query 形式出现，会落入 `audit_logs.details`，DBA 与 admin 可见——审计日志成为二次泄露源。
- 修复：对 `r.URL.Query()` 按相同 `sensitiveKeyFragments` 列表 redact 后再写入；扩展 fragments 至少加入 `code`、`state`。

### W7. emergency cookie 仅做 HMAC 校验，无 nonce / 不撤销 / 不限期
- 文件：`incus-admin/internal/middleware/auth.go:57-65`、`113-122`
- 风险：cookie 格式是 `email|hmac(secret, email)`，HMAC 一签终身有效。没有 issued-at / expires-at / nonce / 黑名单。任何一次 emergency cookie 泄露 → 该 email 永久可冒认登录，直到 `EMERGENCY_TOKEN` 轮换为止（轮换会让所有 emergency cookie 同时失效）。emergency 是 oauth2-proxy 离线时的"应急通道"，应当短时有效。
- 修复：cookie 改成 `email|expires_unix|hmac(secret, email|expires_unix)` 加 5–15 分钟 TTL；配合服务端记录使用次数或 nonce 实现一次性。

### W8. WebSocket 控制台 Origin 校验对空 Origin 放行
- 文件：`incus-admin/internal/handler/portal/console.go:19-28`
- 风险：`CheckOrigin` 在 `origin == ""` 时直接 `return true`。现代浏览器对 WebSocket upgrade 一定会带 `Origin`，但 (a) 部分基于 NSURLSession / 早期 Edge 等环境不送，(b) 反向代理重写头可能把 Origin 削掉。空 Origin 场景下 CSRF 防护失效，攻击者可通过 SSRF（本地服务发出 ws 请求）跨用户接入控制台 WebSocket。
- 修复：`origin == ""` 改为拒绝；或仅在明确的非浏览器 token 路径（API token + Origin 空）下放行。

---

## 🔵 优化

### O1. 订单 pay 接口在 HTTP 响应里返回 VM 明文密码
- 文件：`incus-admin/internal/handler/portal/order.go:400-406`
- 风险：响应 body 包含 `password: result.Password`。虽然是用户自己的 VM、且只此一次，但浏览器开发者工具历史、扩展、第三方 JS、CDN 边缘日志都可能截获。前端虽然不主动 console.log，但响应一旦被审计中间件 / nginx access log 记录就泄露。
- 缓解：(a) 已不让 audit 中间件记录响应 body（auditwrite.go 只记 request body）；(b) 改为仅返回 `password_token`，前端再用 step-up gated 一次性接口拉取密码后立即 redact 到内存。

### O2. SessionSecret 被多协议复用为 HMAC 密钥
- 文件：`incus-admin/cmd/server/main.go:191-194`、`215-218`
- 现状：`StepUpStateSecret` 与 `ShadowSessionSecret` 都允许回退到 `Server.SessionSecret`。同一密钥同时签 OIDC state、shadow session cookie、可能还有其他 HMAC 用途。
- 风险：跨协议密钥混用历来是 OAuth/OIDC 安全分析里的常见缺陷，理论上若某条协议有 padding 或长度泄露副信道，会污染另一协议。生产应每条协议独立 secret。
- 修复：部署文档明确要求三个 secret 分别用 `openssl rand -base64 32` 独立生成；或在代码层把回退路径加 `slog.Warn("HMAC secret reuse detected")`。

### O3. step-up 流程未启用 PKCE
- 文件：`incus-admin/internal/auth/oidc.go:57-61`、`internal/handler/auth/stepup.go:47-60`
- 现状：仅依赖签名 state 防 CSRF，未带 `code_challenge` / `code_verifier`。
- 风险：如果 Logto 端开放重定向或浏览器扩展嗅到 authorization code，攻击者可直接换 token。属于 OAuth 2.1 推荐的纵深防御。
- 修复：`AuthCodeURL` 加上 `oauth2.S256ChallengeOption(verifier)`，回调端验证 verifier。

### O4. console.go admin 完全跳过 VM 所有权检查
- 文件：`incus-admin/internal/handler/portal/console.go:50-57`
- 现状：`role == "admin"` 时不验证 vmName 是否真实存在 / 用户能访问。设计意图是 admin 全权访问。
- 风险：因 W5 路径未编码，攻击者若取得 admin shadow session 可通过构造 vmName 的特殊字符遍历到非预期资源；admin 无 step-up gate 也是策略选择。
- 修复：admin 路径增加最少检查"vm 在 DB 里存在"，并对每次 console.session_open 强制 step-up（与节点维护一致）。

### O5. cloud-init network-config YAML 字符串化，依赖输入预校验
- 文件：`incus-admin/internal/service/vm.go:891-904`
- 现状：`buildNetworkConfig` 用 `fmt.Sprintf` 直接拼 IP/CIDR/Gateway 进 YAML，未做引号转义。当前调用链 IP/CIDR/Gateway 来自服务端 IP 池配置，由 admin 在 `IP_POOLS_*` env 中配置，非用户直接控制。
- 风险：若未来扩展用户自定义 IP（VPC、绑定外部 IP），且未补 IP 格式校验，会注入 YAML（多行字段串接 `\nrunmcd:` 等）。
- 修复：直接用 `gopkg.in/yaml.v3` 序列化 map，避免字符串拼接；或在 `service.BuildNetworkConfig` 入口做 `net.ParseIP/net.ParseCIDR` 严格校验。

### O6. OS Template `cloud_init_template` 字段无内容白名单（admin only）
- 文件：`incus-admin/internal/handler/portal/template.go:76`、`94`、`120`、`146`
- 现状：admin 可写入任意 8KB cloud-init YAML，注入用户 VM 在启动期以 root 运行的 runcmd / write_files。
- 风险：admin 入侵或恶意管理员可在所有新建 VM 内悄悄植入后门。属于"信任 admin"模型下的设计取舍。
- 修复：(a) 模板写入前用 yaml.v3 解析检查仅含白名单字段（`users`、`packages`、`write_files`、`runcmd`），并把 runcmd/bootcmd 限制为枚举命令；(b) 模板修改强制 step-up 且写入完整 audit 含旧/新内容 diff。

### O7. `iframe` 缺少 `sandbox` 属性
- 文件：`incus-admin/web/src/app/routes/admin/observability.tsx:93`、`incus-admin/web/src/app/routes/admin/vm-detail.tsx:394-398`
- 现状：observability 仪表板嵌入第三方监控 URL（Grafana/Prometheus），VM detail 嵌入 `/console` 自家 xterm 路由，均无 `sandbox`。
- 风险：xterm.js 历史上有 ANSI 注入 / 链接劫持 CVE，第三方监控页面若被替换可执行同源脚本。
- 修复：xterm iframe 用 `sandbox="allow-scripts allow-same-origin"`；外部监控用 `sandbox="allow-scripts"` + 强制 HTTPS。

### O8. `apitoken.Create` 忽略 `crypto/rand.Read` 返回错误
- 文件：`incus-admin/internal/repository/apitoken.go:24-25`
- 现状：`raw := make([]byte, 32); rand.Read(raw)` 未检 err。
- 风险：crypto/rand 在 Linux 实际不会失败，但若运行在受限沙箱（无 /dev/urandom）会返回零字节 token，整个 token 字段全是预测值。
- 修复：`if _, err := rand.Read(raw); err != nil { return nil, err }`，与 `Renew()` 第 134 行写法保持一致。

### O9. Go build 未带 `-trimpath` / `-buildvcs`
- 文件：`incus-admin/Taskfile.yml`、CI workflow 未启用
- 风险：编译产物嵌入构建路径与 VCS 元数据，泄露内部目录结构与构建机用户名。
- 修复：build 命令统一为 `CGO_ENABLED=0 go build -trimpath -buildvcs=false`。

### O10. `@base-ui-components/react` 仍是 `1.0.0-rc.0`
- 文件：`incus-admin/web/package.json:17`
- 现状：生产依赖锁定 RC 版本。
- 风险：RC 不享受正式版安全公告流程；若 base-ui 出 advisory，需自己跟踪。
- 修复：等正式 v1.0.0 发布后切换；或暂时锁定到 commit hash。

### O11. emergency cookie 路径未使用 `Secure` / `HttpOnly` 属性显式约束
- 文件：`incus-admin/internal/middleware/auth.go:113`（cookie 读取处）、签发逻辑分散
- 现状：审查中未发现统一签发处，仅消费端读取。如果签发处遗漏 `Secure: true`，emergency cookie 可能在 HTTP 通道泄露。
- 修复：补单测覆盖 emergency cookie 签发路径，断言 `Secure=true && HttpOnly=true && SameSite=Strict`。

---

## ✅ 已确认安全（防御正常）

为避免重复审计，以下项已逐一核验、不存在通常的风险：

- **SQL 注入**：全代码库 grep `fmt\.Sprintf.*(SELECT|UPDATE|INSERT|DELETE|WHERE)` 零结果；所有 repository 层使用 `database/sql` 占位符（`$1, $2, ...`）。
- **命令注入**：`os/exec` 完全不使用；远程命令一律走 `sshexec.Runner.RunArgs`，对每个参数做 POSIX 单引号转义（`runner.go:329-344`）。
- **shell 脚本注入**：`cluster/scripts/join-node.sh:132` 节点名正则白名单 `^[a-zA-Z0-9]([a-zA-Z0-9-]{0,62}[a-zA-Z0-9])?$`；用户传入参数走环境变量 `_NODE_NAME` 给 Python，不进入 shell eval。
- **API token 存储**：`crypto/rand` 32 字节 + SHA256 hash 仅存哈希、明文一次性返回；`apitoken.go:42-90`。SHA256 对 256-bit 高熵 token 等价于安全（参考 GitHub PAT / Vault 实践），无需 bcrypt。
- **越权 (IDOR)**：portal 下 vm.go / sshkey.go / firewall.go / ticket.go / order.go / floating_ip.go 全部 handler 校验 `owner_id == userID`；ticket admin 路由通过 `RequireRole("admin")` 中间件保护（`server.go:247`）。
- **shadow session cookie**：`HttpOnly + SameSite=Strict + Secure`（`shadow.go:132-141`），HMAC 签名带 TTL。
- **OIDC state**：HMAC + 10 分钟 TTL，`oidc.go:94-152`；callback 通过 IDP 签名 id_token 校验邮箱再匹配本地用户，不能伪造他人身份。
- **CSRF（non-WebSocket）**：依赖 oauth2-proxy 的 SameSite cookie + Bearer token 路径无 cookie 即不可 CSRF；shadow_session SameSite=Strict 阻断跨站。
- **前端 XSS**：全代码库 grep `dangerouslySetInnerHTML` / `eval` / `new Function` 零结果；i18next `escapeValue: false` 是 react-i18next 推荐配置（React 已自动转义文本节点）。
- **localStorage / sessionStorage 敏感数据**：未存放 token / 密码 / 私钥；仅存 UI 状态（主题、列宽、pending intent 5 分钟 TTL）。
- **SSRF**：HTTP client 调用目标限于配置中的 Incus API + image server URL，不接受用户传 URL。
- **路径遍历**：未发现 `filepath.Join(userInput, ...)` 后未 Clean / 未做前缀校验的写文件路径。
- **CI**：`.github/workflows` 不使用 `pull_request_target`，无 PR 代码注入特权步骤的常见陷阱。

---

## 修复优先级建议

1. **立即（部署前必须）**：W1（SSH known_hosts）、W2（CA file）、W3（password key）三项配置默认值。三者都属于"运维忘配 → 直接裸奔"型，应改为生产环境 fail-fast 而非 warn 放行。配套更新 `deploy/incus-admin.env.example` 把对应 env 标记为 `# REQUIRED`。
2. **本迭代**：W4（限流分级 + 真 IP）、W5（URL 编码统一）、W6（审计 query redact）、W7（emergency cookie 加 TTL）、W8（WebSocket Origin 严格化）。
3. **下一迭代**：O1（密码不出响应）、O2（HMAC 密钥拆分）、O3（step-up PKCE）、O5（YAML 序列化替换字符串拼接）、O6（cloud-init 模板白名单 + diff 审计）。

---

## 复验路径（可独立验证）

| 发现 | 关键文件 | 验证命令 |
| ---- | -------- | -------- |
| W1 | `internal/sshexec/runner.go:351` | `grep -n InsecureIgnoreHostKey internal/sshexec/runner.go` |
| W2 | `internal/cluster/manager.go:200` | `grep -n InsecureSkipVerify internal/cluster/manager.go` |
| W3 | `internal/auth/password_crypto.go:42` | `grep -n passthrough internal/auth/password_crypto.go` |
| W4 | `internal/middleware/ratelimit.go:69` | `grep -n RemoteAddr internal/middleware/ratelimit.go` |
| W5 | `internal/handler/portal/console.go:77` | `grep -n Sprintf.*1.0/ internal/handler/portal/*.go` |
| W6 | `internal/middleware/auditwrite.go:112` | `grep -n RawQuery internal/middleware/auditwrite.go` |
| W7 | `internal/middleware/auth.go:57` | `grep -n verifyEmergencyCookie internal/middleware/auth.go` |
| W8 | `internal/handler/portal/console.go:22` | `grep -n CheckOrigin internal/handler/portal/console.go` |
