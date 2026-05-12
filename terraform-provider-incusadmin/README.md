# terraform-provider-incusadmin

incus-admin 的官方 Terraform Provider（PLAN-042 / INFRA-010 一期）。

## 状态

**实验性 / experimental** — schema 在 1.0 之前可能破坏性变更。生产前请固定版本。

## 资源

- `incusadmin_vm` — VM 创建 / 销毁（admin endpoint POST /admin/clusters/{cluster}/vms，跳过订单流；需 admin token）。所有字段修改触发 ForceNew（incus-admin 不支持 in-place resize；二期 OPS 接 admin PATCH 后改进）。Import ID `cluster/name`
- `incusadmin_firewall_group` — 防火墙组（slug / name / rules[]）。`slug` 不可改
- `incusadmin_floating_ip` — Floating IP 申请（admin endpoint）。`vm_id` 修改自动 attach / detach
- `incusadmin_ssh_key` — 用户 SSH 公钥。`name` / `public_key` 修改触发 ForceNew（portal sshkey API 无 PUT 端点）

## 数据源（Datasource，只读）

- `incusadmin_balance` — 当前 token user 的余额
- `incusadmin_orders` — 当前 token user 的订单列表
- `incusadmin_invoices` — 当前 token user 的发票列表
- `incusadmin_user` — 按 email 查询用户（admin only；用户由 OIDC 登录自动创建，无 Create 端点，故只读）

## 鉴权

强烈推荐用环境变量，避免 token 写入 `.tfstate`：

```bash
export INCUSADMIN_ENDPOINT=https://vmc.5ok.co
export INCUSADMIN_TOKEN=your-api-token
terraform plan
```

或在 provider block 显式（仅开发用）：

```hcl
provider "incusadmin" {
  endpoint  = "https://vmc.5ok.co"
  api_token = "..."   # 写入 .tfstate；生产请用 env
}
```

API Token 在 incus-admin portal 生成：`POST /portal/api-tokens`。一期 TTL 默认 24h，可续签。

## Import

复合 ID（与 incus-admin 命名一致）：

```bash
# VM 用 cluster/name（与 admin endpoint 路径一致）
terraform import incusadmin_vm.web default/tf-web-01

# 其他资源用 numeric ID
terraform import incusadmin_firewall_group.web 7
terraform import incusadmin_floating_ip.web 12
terraform import incusadmin_ssh_key.alice 3
```

## 一期范围（PLAN-042）

✅ 5 资源 + 3 datasource，CRUD + Import 全通  
✅ Step-up gating：触发敏感动作时返回 `step-up authentication required` 提示，让用户先在 Web UI 完成 OIDC re-auth  
❌ Acceptance test 套件（一期仅 smoke；OPS 后续补）  
❌ Terraform Registry 上架（一期内部用，二期上架）  

## 构建

```bash
cd terraform-provider-incusadmin
go build -o terraform-provider-incusadmin
mkdir -p ~/.terraform.d/plugins/5ok.co/incuscloud/incusadmin/0.1.0/$(go env GOOS)_$(go env GOARCH)
mv terraform-provider-incusadmin ~/.terraform.d/plugins/5ok.co/incuscloud/incusadmin/0.1.0/$(go env GOOS)_$(go env GOARCH)/
cd examples/basic && terraform init && terraform plan
```

## 决策记录

来自 PLAN-042 用户决策：

- **D19**：用 swag v1 + 手写 OpenAPI 混合（spec-first），不等 swag v2（卡 RC5 18 月）
- **D20**：`incusadmin_vm` import ID 用复合 `project/name`（HashiCorp nomad/consul 模式），其他用 numeric ID
- **D21**：一期仅 5 资源；snapshot_policy / backup_target 等 PLAN-040 落地后追加
- **D22**：默认 env var 鉴权；OIDC dynamic credentials 留 v2
- **D23**：一期不上 Terraform Registry，内部用 5ok.co/incuscloud/incusadmin
- **D25**：acceptance test 用 httptest mock 一期；testcontainers smoke 兜底（待 OPS 单独立项）

## License

Apache-2.0（与 incus-admin 主仓一致）
