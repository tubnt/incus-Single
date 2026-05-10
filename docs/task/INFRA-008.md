# INFRA-008 备份与灾备一期 —— 策略 / 保留 / S3 后端

- **status**: closed
- **priority**: P0
- **owner**: (未分配)
- **createdAt**: 2026-05-09 13:30
- **closedAt**: 2026-05-09 14:00
- **closeReason**: 用户决策搁置；二期再立项

## 描述

为 incus-admin 增加企业级备份能力一期。snapshot CRUD 已存在但只是手动一次性，无法回答客户"机房着火怎么办"。本任务做：

1. 周期 snapshot 策略（cron-like）+ 保留 N 份
2. incus export 全量 → S3 / Ceph RGW 异地存储
3. admin 控制台 CRUD（targets / policies / runs）+ 用户视角"我的备份"

不做（拆 PLAN-044）：跨集群 RBD mirror / zfs send|recv / 增量备份 / 应用一致性 freeze。

详细设计见 [PLAN-040](../plan/PLAN-040.md)。

## 验收标准

- [ ] migration 025 上生产无错；3 张表（backup_targets / backup_policies / backup_runs）
- [ ] minio docker 跑通本地集成测试：策略触发 → export → 上传 S3 → 保留 N 份生效
- [ ] admin UI 能创建 target + policy + 立即触发 + 查看历史
- [ ] 用户视角能看到自己 VM 的备份记录
- [ ] backup 用独立 worker pool，不影响 jobs.Runtime（pool size 4）
- [ ] secret 加密复用 OPS-022 的 AES-256-GCM key
- [ ] 文档：runbook 含恢复步骤 + 故障排查

## 进行时描述

落地备份与灾备一期

## 依赖

- **blocked by**: (无)
- **blocks**: PLAN-044（跨集群复制二期，依赖一期数据模型）

## 笔记

- 一期与 minio-go SDK 集成；Ceph RGW 与 AWS S3 都覆盖
- 立即触发先走"写 backup_run + status=pending → scheduler 下一 tick 拾起"，避免同步 export 卡住 HTTP 请求
- 下次启动加一个迁移：把现有 snapshot.go 手动 snapshot 不动，只是新增并行能力
