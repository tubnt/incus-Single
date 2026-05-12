# PLAN-043 一键 Bootstrap CLI —— 5 分钟出私有云

- **status**: completed
- **createdAt**: 2026-05-09 13:30
- **approvedAt**: 2026-05-09 14:00
- **completedAt**: 2026-05-09 15:00
- **relatedTask**: INFRA-011

## 现状

### 已有

- `cmd/server/main.go` + `cmd/scheduler-probe/main.go`：两个 binary 入口
- `internal/sshexec/embedded/scripts/`：成熟脚本群 —— `join-node.sh`（OPS-026 加 bonded NIC + skip-network）/ `apply-network.sh` / `probe-node.sh` / `scale-node.sh`，全部走 `//go:embed` 打包
- `internal/sshexec/embedded/configs/cluster-env.sh`：网络/Ceph 拓扑常量
- `internal/service/nodeprobe/probe.go`：节点探测能力（PLAN-033 / OPS-039 留下，已能识别网卡 / 磁盘 / OS / 已装组件）
- `internal/service/aiassist/`：PLAN-038 留下的 AI 辅助诊断框架，可在 bootstrap 失败时提建议（可选）

### 缺失

- **没有"零节点 → 第一个节点"的引导器**：join-node.sh 只能加节点
- **没有交互式向导 / 配置 yaml**：现在装个 incus-admin 要手工：装 Incus → `incus admin init` → 装 PG → 配 oauth2-proxy → 写 systemd unit → 装 binary → 起服务，零失败概率几乎为 0
- **没有 5 分钟体验文档**

## 方案

### A. 命令组织

新增子命令而非新 binary（与 server / scheduler-probe 同模式），在 `cmd/server/main.go` 顶部加 cobra：

```
incus-admin server               # 现有默认行为（启动 HTTP 服务）
incus-admin scheduler-probe      # 现有 cmd/scheduler-probe 等价
incus-admin bootstrap detect     # 探测主机能力（JSON 报告）
incus-admin bootstrap first-node # 交互式向导
incus-admin bootstrap apply      # 用 plan 文件 apply（dry-run 优先）
```

入口：`cmd/server/main.go` 改造为 cobra 顶层 + 把现有逻辑挪到 `server` 子命令；新建 `cmd/server/bootstrap.go`（同 package main）实现 bootstrap 子树。

> **决策点**：是否更激进地把 scheduler-probe 也合到 `incus-admin scheduler-probe` 子命令？建议合并，少一个 binary 部署。

### B. `bootstrap detect`

- 探测项：
  - OS（lsb_release / /etc/os-release，要求 Ubuntu 22.04+ / Debian 12+ 一期）
  - CPU vcpu / 内存 GB / 磁盘列表（`/proc/cpuinfo` + `lsblk -J`）
  - 网卡列表 + IPv4 / IPv6 + 默认路由网卡（`ip -j addr` + `ip -j route`）
  - 是否已装：incus / docker / postgresql / nftables
  - netplan vs ifupdown vs systemd-networkd（避免装错）
  - 端口占用：80 / 443 / 5432 / 8443（incus）
  - 是否已有 incus cluster（`incus cluster show` 不报错就是有）
- 输出：`stdout` 一份 JSON 报告，`stderr` 关键警告（红/黄）；exit code：0=干净可跑 first-node / 2=有阻塞项

### C. `bootstrap first-node`

交互式向导（terminal UI，用 `survey` 或 `huh`）：

1. 节点信息：节点名 / 公网 IP（默认 detect 出的网关网卡 IPv4）
2. 角色：`single`（单机不上集群） / `cluster-first`（首节点，未来要加节点）
3. 网络模式：`bridge`（默认 incusbr0） / `vlan`（让用户填 VLAN ID）
4. 存储：`zfs`（推荐，自动挑空闲磁盘）/ `dir`（默认 /var/lib/incus）/ `ceph`（高级，要先有 Ceph 集群）
5. 业务域名 + TLS：让用户选 `local-self-signed`（默认）/ `letsencrypt`（要域名 + 80 可达）
6. 认证：`local-admin`（默认，自动生成 admin 密码）/ `oidc-logto`（高级，问 issuer / client_id / client_secret）
7. PostgreSQL：`embedded-docker`（默认起 docker 单容器）/ `external`（让用户填 DSN）

输出：把所有答案写到 `/etc/incus-admin/bootstrap.yaml`（ownership root:root, mode 0600，secret 现场加密）+ 立刻问"现在 apply 吗？(Y/n)"

### D. `bootstrap apply`

- 默认走 `--dry-run`：列出每一步的实际命令，不执行
- `--apply` 才真跑
- 步骤（每步幂等 + 失败回滚标记）：
  1. **预检**：再跑一次 detect，对比 bootstrap.yaml 的假设
  2. **包安装**：`apt-get install -y incus docker.io nftables`（若需）
  3. **Incus init**：用 preseed YAML（`incus admin init --preseed < ./preseed.yaml`），preseed 模板放 `internal/sshexec/embedded/configs/incus-preseed.tmpl.yaml`
  4. **PostgreSQL**：起 docker 容器（PG 16）+ migrations 跑一次（复用现有 goose）
  5. **incus-admin systemd**：写 unit + env file（`/etc/incus-admin/env` 0600）+ enable + start
  6. **TLS**：self-signed 现场生成 / certbot 拿证书
  7. **oauth2-proxy**（可选 OIDC 模式）：装 + 写 cfg + systemd
  8. **健康检查**：`curl localhost:8080/api/health` 期望 200 + dist_hash 非空
  9. **打印总结**：admin URL / admin 密码（首次） / 下一步加节点的命令模板（直接给 join-node.sh 模板 + 自动生成的 token）
- 失败：第 N 步失败 → 打印已完成步骤 / 失败步骤 / 建议命令；不自动回滚（破坏性 vs 失败重启友好，选后者；用户重跑 apply 是幂等的）
- 日志：`/var/log/incus-admin/bootstrap-{timestamp}.log`

### E. 5 分钟体验文档

新文档 `docs/bootstrap-quickstart.md`（中文优先）：
- 5 分钟 demo：`curl install.sh | bash` → `incus-admin bootstrap first-node` → 浏览器开 admin URL
- install.sh 是新文件 `scripts/install.sh`，做的事：检测 arch + 下载对应 release binary + 装到 /usr/local/bin → 提示用户跑 `incus-admin bootstrap`
- 截图 / 录屏（README 引用）
- 故障排查清单（最常见 5 个错：80 端口被占 / netplan vs networkd 冲突 / 没 sudo / Postgres 容器起不来 / DNS 解析不通）

### F. 测试

- 单元测试：detect 用 fakeRunner 注入命令输出
- E2E：lima ubuntu 22.04 镜像（macOS 也能跑）跑完整流程；CI 起一台 GitHub Actions ubuntu-22.04 runner 跑 `bootstrap apply` 全流程
- 注意 CI 不能用 docker-in-docker 装 PG，改用 systemd-pg 路径或者 services: postgres

## 风险

1. **root 权限破坏性操作**：apply 必须明确确认 `--apply` flag + `--yes`；改 netplan 前自动备份 `.bak`；启动 incus 后第一时间打 snapshot
2. **多发行版差异**：Ubuntu / Debian 还好，Rocky / Alma 走 dnf 路径完全不一样 → 一期只支持 Ubuntu 22.04+ / Debian 12+，README 明示
3. **网络模式踩坑**：netplan + cloud-init 在虚拟机上经常被覆盖；apply 末尾打印"已修改 /etc/netplan/X.yaml，下次 cloud-init 会覆盖，建议禁用 cloud-init network 配置"
4. **Postgres 默认 docker 容器在生产不健康**：dev/PoC 默认 docker，生产文档提示用 external
5. **回滚困难**：incus admin init 后再撤销很麻烦；apply 前打印明确警告 + 建议在新机器跑
6. **bootstrap 失败 = 客户首屏体验崩**：每一步都加详细错误信息 + 复现指令，比"silently exit 1"好十倍
7. **install.sh 中间人攻击**：脚本走 https + 校验 SHA256（release 一起发）；README 给手工 wget 替代命令
8. **与现有部署冲突**：detect 检到 incus 已在跑就 exit 2，给"如何接管"指引

## 工作量

- A 命令重组（cobra 引入 + 现有逻辑迁移）：≈ 1 天
- B detect：≈ 1.5 天
- C 向导（survey + secret 处理）：≈ 2 天
- D apply（步骤 + 幂等 + 回滚标记）：≈ 4-5 天（每步要测）
- E 文档 + install.sh：≈ 1.5 天
- F E2E（lima + GitHub Actions）：≈ 2 天
- **合计 ≈ 12-13 天**（一人）

## 备选方案

| 方案 | 优点 | 缺点 | 选用 |
|---|---|---|---|
| Go binary 子命令（本方案） | 单一发行物 / 可复用现有 embed scripts | 包体积稍大 | ✅ |
| Bash 巨型脚本 | 无依赖 | 调试地狱 / 跨发行版难 | ❌ |
| Ansible playbook | 行业标准 / 幂等强 | 需要客户先装 ansible，5 分钟体验破坏 | ❌ |
| MicroCloud 风格 snap | 自动更新 | snap 锁定 / Ubuntu 之外不友好 | ❌ |
| 提供 ISO 安装镜像 | 极致开箱即用 | 工作量 ×3，超出 P2 | 留作 v2 |

## 批注

### 2026-05-09 14:00 用户批注（深度审查后批准）

**决策**：
- D26 = A（apply 失败不自动 rollback；幂等 rerun 友好）
- D27 = B（TUI 用 `huh` v2 charmbracelet，替代不维护的 survey）
- D28 调整 = 一期 Type=simple；二期 OPS 升级到 notify（避免本期引入 go-systemd 集成代码风险；systemctl restart 短暂 LB 5xx 暴露窗口可接受）
- D29 = C（PG 部署模式由向导问，dev 默 docker / prod 默 apt 装系统 PG）
- D30 = A（一期仅 Ubuntu 22.04+ / Debian 12+；Rocky/Alma exit + 友好提示）

**额外参考**：
- MicroCloud 3.2 preseed schema 对照（避免重复造轮子）
- install.sh 抄 k3s/Tailscale 模式（SHA256 + GPG keyring + sudo auto-elevate）
- huh v2 已发，新项目用 v2

**视觉**：本 plan 是 CLI + 文档，无前端视觉。

