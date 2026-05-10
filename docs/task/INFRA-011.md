# INFRA-011 一键 Bootstrap CLI —— 5 分钟出私有云

- **status**: completed
- **priority**: P2
- **owner**: claude-code
- **createdAt**: 2026-05-09 13:30
- **claimedAt**: 2026-05-09 14:00
- **completedAt**: 2026-05-09 15:00

## 描述

新增 `incus-admin bootstrap` 子命令组，让客户拿到 5 台裸机后能"5 分钟出私有云"——补 join-node.sh 之外的"零节点 → 第一个节点"引导。

子命令：
- `incus-admin bootstrap detect` —— 探测主机 / 输出 JSON 报告
- `incus-admin bootstrap first-node` —— 交互向导写 bootstrap.yaml
- `incus-admin bootstrap apply [--dry-run|--apply]` —— 按步骤幂等装 Incus + Postgres + admin + systemd

配套：`scripts/install.sh` + `docs/bootstrap-quickstart.md`（中文优先）。

详细设计见 [PLAN-043](../plan/PLAN-043.md)。

## 验收标准

- [ ] 单台 Ubuntu 22.04 GitHub Actions runner 跑完 `bootstrap apply` ≤ 5 分钟
- [ ] `bootstrap detect` 输出含 OS / CPU / 内存 / 磁盘 / 网卡 / 已装组件 / 端口占用
- [ ] `bootstrap apply --dry-run` 列出每步实际命令，零副作用
- [ ] `bootstrap apply --apply` 重复跑幂等（第 2 次跑无副作用）
- [ ] 步骤失败时打印明确恢复指令 + 已完成步骤摘要
- [ ] netplan 修改前自动备份 `.bak`
- [ ] install.sh 校验 SHA256
- [ ] docs/bootstrap-quickstart.md 中文优先 + 5 分钟体验流程 + 故障排查清单
- [ ] 一期支持 Ubuntu 22.04+ / Debian 12+；其他发行版友好 exit + 错误信息
- [ ] cobra 重构后 `incus-admin server` / `scheduler-probe` / `bootstrap` 三个子命令并存

## 进行时描述

落地一键 Bootstrap CLI

## 依赖

- **blocked by**: (无)
- **blocks**: 未来 ISO 镜像 / Cloudinit 模板 / SaaS 自动化部署

## 笔记

- 复用 internal/service/nodeprobe / internal/sshexec/embedded 现有能力
- AI 诊断（aiassist）可在 apply 失败时给建议，但不阻塞主路径
- 安全：apply 需要双确认（`--apply --yes`）
