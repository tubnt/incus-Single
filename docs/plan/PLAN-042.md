# PLAN-042 OpenAPI 规范 + Terraform Provider

- **status**: completed
- **createdAt**: 2026-05-09 13:30
- **approvedAt**: 2026-05-09 14:00
- **completedAt**: 2026-05-09 14:45
- **relatedTask**: INFRA-010

## 现状

### 已有

- `internal/handler/portal/`：30+ 个 handler 文件，含 admin + portal 双路由
- `internal/server/server.go`：所有路由集中注册（`Handlers` 结构体 + `srv.Run()`）
- `internal/middleware/token.go`：Bearer API token 认证已就绪（用户可创建 API token）
- `cmd/server/main.go` 注释里有大量"自然语言文档"，但**0 个 swag 注释**（grep `@Summary|@Tags|@Param` 0 命中）
- portal handler 数量保守估算 ≥ 80 个 endpoint（admin + portal）
- 后端 Go 风格已用 `golangci-lint v2`，CI 有 `bun run typecheck` + `go test ./...`

### 缺失

- 没有 OpenAPI / Swagger 描述
- 没有公开的 `/api/docs` 端点
- 没有 Terraform provider
- 用户 / DevOps 没法用 IaC 描述 `incusadmin_vm` 资源

## 方案

### Phase A：OpenAPI 规范（基础）

#### A.1 选型

两条路：
- **A.1-α swaggo/swag v2**：传统注释 → CLI 生成 `docs/openapi.json`。优点：老牌，社区文档最多。缺点：注释和代码"双事实"漂移；改 struct 必须改注释，CI 防漂移用 `swag fmt --check`。
- **A.1-β Huma v2 / oapi-codegen**：从 Go struct 自动派生 OpenAPI。优点：单一事实，零漂移。缺点：要重写 handler 签名（router 注入参数），改造面 30+ 文件。

**选 swaggo/swag v2**：增量友好，handler 签名零改动；CI 加 `swag fmt --check` + 审阅在 PR 自动 diff openapi.json 即可。Huma 这种深度改造留到后续重构。

#### A.2 注释挂载

- 全部 admin / portal handler 加 `@Summary` `@Tags` `@Param` `@Success` `@Failure`
- `@Security ApiKey`（Bearer token）/ `@Security Cookie`（admin web）
- 标签按 handler 文件分组：`vm` / `firewall` / `floating-ip` / `snapshot` / `order` / `user` / `audit` / `cluster` / `backup`（PLAN-040 接好后）/ `alert`（PLAN-041 接好后）

#### A.3 生成 + 暴露

- `Taskfile.yml` 加 `swag-gen`：`swag init -g cmd/server/main.go -o docs/openapi --parseDependency`
- 输出 `docs/openapi/swagger.json` + `docs/openapi/swagger.yaml`
- 新 handler `internal/handler/openapi/handler.go`：
  - `GET /api/openapi.json` 直接 serve embed 的 swagger.json（//go:embed）
  - `GET /api/docs` —— 用 `github.com/swaggo/http-swagger/v2` 起 Swagger UI
  - 可选鉴权（env `OPENAPI_PUBLIC=true` 时匿名，否则要登录或 Bearer）
- CI 加 `swag fmt --check` + 比对 `docs/openapi/swagger.json` 与 working tree 是否一致（防止漏 commit）

### Phase B：Terraform Provider 骨架

#### B.1 选型

用 **terraform-plugin-framework v1.x**（最新官方推荐，Plugin Framework 已稳定）；不用过时的 SDK v2。

#### B.2 目录

```
incus-admin/
└── terraform-provider-incusadmin/
    ├── go.mod                 # 独立 module，避免污染主 incus-admin 的依赖
    ├── main.go                # provider entry
    ├── internal/
    │   ├── provider/provider.go
    │   └── resources/
    │       ├── vm.go
    │       ├── firewall_group.go
    │       ├── floating_ip.go
    │       ├── snapshot_policy.go     # PLAN-040 backup_policies 落地后接
    │       ├── user.go
    │       └── ssh_key.go
    ├── examples/
    │   └── basic/main.tf
    ├── docs/
    └── Taskfile.yml
```

#### B.3 一期资源（5 个）

| 资源 | Create | Read | Update | Delete | Import |
|---|---|---|---|---|---|
| `incusadmin_vm` | ✓ | ✓ | size_gb / firewall_groups / sshkeys | ✓（走 trash） | ID |
| `incusadmin_firewall_group` | ✓ | ✓ | rules patch | ✓ | ID |
| `incusadmin_floating_ip` | ✓ | ✓ | bind/unbind | ✓ | ID |
| `incusadmin_user` | ✓（admin only） | ✓ | role/balance/quota | ✗（不删，避免误操作） | ID |
| `incusadmin_ssh_key` | ✓ | ✓ | ✗ | ✓ | ID |

订单 / 余额这种带钱的资源**只做 datasource**，不做 resource（避免 Terraform 误重建造成乱扣费）：
- `data.incusadmin_orders` / `data.incusadmin_invoices` / `data.incusadmin_balance`

#### B.4 鉴权

- `provider "incusadmin"` block：`endpoint` + `api_token`（环境变量 `INCUSADMIN_API_TOKEN`）
- HTTP client 走 portal API token（已有，30d TTL，可续签）
- TLS 默认验证，支持 `insecure = true` 用于自签名

#### B.5 发布

- 一期不上 Terraform Registry（需要 GPG 签名 + GitHub release tag），先内部用 / `terraform { required_providers { incusadmin = { source = "5ok.co/incuscloud/incusadmin" } } }`
- README 含 `terraform-plugin-docs` 自动生成的资源文档
- examples/ 一个完整跑通用例（创 VM + bind firewall + bind floating IP）

### Phase C：CI + 发布

- `Taskfile.yml` 新 target：`swag-check` / `tf-build` / `tf-test`
- 后端 CI：`swag fmt --check` + `swag init` 失败即 fail
- TF provider 独立 CI：`go vet ./... && terraform-plugin-docs validate && acceptance test 跑 mock`（acceptance test 用本地起 incus-admin + Postgres testcontainers，不打真实集群）

## 风险

1. **swag 注释 ↔ struct 漂移**：CI `swag fmt --check` + 比对生成产物 + PR review 三道防线；接受小概率漂移
2. **80+ endpoint 注释爆炸性工作量**：用 codemod / 简单 awk 脚本生成模板注释（`@Tags` 按文件名 / `@Param` 按 handler 函数签名扫），人工只校对，预计原始批量 60% + 手工细调 40%
3. **TF provider 跨 Go module 维护**：terraform-provider-incusadmin/ 用独立 go.mod 后引用主项目类型会绕路 → DTO 类型在 provider 内重新定义，**不复用** internal/model；用 OpenAPI 生成 client 代码（oapi-codegen）即可
4. **provider 资源 schema 改动 → 用户 state 破坏**：一期 schema 标 `experimental`，README 警示，正式 GA 前不保证向后兼容
5. **acceptance test 难写**：第一版只做单元 + smoke，不做完整 acceptance；TF provider 0.x 版本声明
6. **Bearer token 长期暴露在 .tfstate**：Terraform 已有处理（state 加密 / remote backend），文档强调远端 state + 不上 git
7. **OpenAPI spec 暴露内部 admin 路径**：可选 split 成 admin + portal 两个 spec 文件；一期合并发布，标 `x-internal: true` 让客户端 SDK 生成时可以 filter

## 工作量

- A.1 + A.2（80 endpoint 注释 + 校对）：≈ 8-10 天
- A.3（端点 + Swagger UI + CI）：≈ 1 天
- B.1-B.4（5 资源 TF provider）：≈ 5-7 天
- B.5（example + docs + 内部发布）：≈ 1-2 天
- C（CI + acceptance smoke）：≈ 1 天
- **合计 ≈ 16-21 天**（一人）；可拆 Phase A 单独先发布，Phase B 滚动跟进

## 备选方案

| 方案 | 优点 | 缺点 | 选用 |
|---|---|---|---|
| swaggo/swag + plugin-framework（本方案） | 老牌 + 官方推荐组合，注释零侵入 | 注释维护成本 | ✅ |
| Huma v2（struct 派生） | 单一事实零漂移 | 改造面太大 | 留作 v2 重构方案 |
| oapi-codegen（先写 spec 再生成 handler） | 零漂移，spec-first | 现有 handler 全部要重写 | ❌ |
| Pulumi 替代 Terraform | 多语言支持 | 私有云客户多用 TF，受众更小 | ❌ |
| 不做 TF provider，只发 OpenAPI 让客户自生成 SDK | 工作量减半 | 失去"原生 TF 资源"卖点，DevOps 客户不买账 | ❌ |

## 批注

### 2026-05-09 14:00 用户批注（深度审查后批准）

**关键修正 F7**：swag v2 已死（卡 RC5 18 个月）。

**决策**：
- D19 = A（**swag v1 注释驱动**，社区放弃 v2，但 v1 仍维护；增量改造小、handler 签名零侵入）
- D20 = B（TF Provider import ID 用复合 `project/name`，HashiCorp nomad/consul 模式）
- D21 = A（一期 5 资源：VM / firewall_group / floating_ip / user / ssh_key；snapshot_policy 等 PLAN-040 落地后追加）
- D22 = A（API token 走 `INCUS_ADMIN_TOKEN` env + remote backend 加密；OIDC dynamic credentials 留 v2）
- D23 = A（一期不上 Terraform Registry，内部用）
- D24 = B（OpenAPI spec 拆 admin + portal 两份，避免 portal 客户暴露 admin 路径）
- D25 = A（acceptance test 用 httptest mock 一期；testcontainers smoke 兜底）

**实施分两阶段**：
- Phase A：swag v1 注释 + `/api/openapi.json` + `/api/docs` Swagger UI + CI 防漂移（先发布给客户尝鲜）
- Phase B：TF provider 骨架 + 5 资源（独立 go.mod）

**视觉**：本 plan 主要是后端 + Provider；前端只有 `/api/docs` Swagger UI 由库自带 + 一个跳转入口（在 settings 页）。无新视觉规则。

