# INFRA-010 OpenAPI 规范 + Terraform Provider

- **status**: completed
- **priority**: P1
- **owner**: claude-code
- **createdAt**: 2026-05-09 13:30
- **claimedAt**: 2026-05-09 14:00
- **completedAt**: 2026-05-09 14:45

## 描述

把"内部 API"升级为"DevOps 能用 IaC 描述的标准产品"。两段：

**Phase A**：80+ admin/portal handler 全量挂 swaggo/swag v2 注释 → 生成 OpenAPI 3 spec → 暴露 `/api/openapi.json` + `/api/docs` Swagger UI + CI 防漂移。

**Phase B**：Terraform provider（terraform-plugin-framework v1）骨架，5 个核心资源：
- `incusadmin_vm` / `incusadmin_firewall_group` / `incusadmin_floating_ip` / `incusadmin_user` / `incusadmin_ssh_key`

订单 / 余额只做 datasource（避免 Terraform 误重建乱扣费）。

详细设计见 [PLAN-042](../plan/PLAN-042.md)。

## 验收标准

- [ ] 全部 admin/portal handler 注释覆盖率 100%（按 endpoint 数量）
- [ ] CI 加 `swag fmt --check` + 比对 swagger.json 防漂移
- [ ] `/api/openapi.json` + `/api/docs` Swagger UI 可访问
- [ ] terraform-provider-incusadmin 独立 go.mod，5 资源 + 3 datasource 能跑通 examples/basic/
- [ ] terraform-plugin-docs 自动生成资源文档
- [ ] acceptance smoke test：`terraform apply` + `terraform destroy` 全流程过
- [ ] README 含 provider block 配置例 + Bearer token 安全告警

## 进行时描述

落地 OpenAPI 规范 + Terraform Provider

## 依赖

- **blocked by**: (无)
- **blocks**: 未来 Pulumi / SDK（Python / TS）生成都依赖 OpenAPI spec

## 笔记

- 不用 Huma v2 自动派生方案（改造面太大），留作 v2 重构
- Phase A 与 Phase B 可拆，Phase A 先发布给客户尝鲜
- backup / alert 资源等 INFRA-008/009 落地后增量加进来
