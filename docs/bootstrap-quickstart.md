# incus-admin Bootstrap Quickstart

5 分钟从零裸机起一个私有云。

> PLAN-043 / INFRA-011 一期。仅支持 Ubuntu 22.04+ / Debian 12+。

## 前置条件

- 一台干净的 Ubuntu 22.04+ 或 Debian 12+（x86_64 / arm64）
- ≥ 2 vCPU、≥ 4 GB 内存、≥ 40 GB 磁盘（zfs 模式建议有专用磁盘）
- 可达公网（用于拉镜像 + 可选申请 Let's Encrypt 证书）
- root（或 sudo）

## 1. 安装

```bash
curl -fsSL https://vmc.5ok.co/install.sh | bash
```

（脚本自动 sudo 提权 + SHA256 校验 + 解压到 `/usr/local/bin/incus-admin`）

固定版本：

```bash
curl -fsSL https://vmc.5ok.co/install.sh | INSTALL_VERSION=0.5.0 bash
```

## 2. 探测

```bash
incus-admin bootstrap detect
```

输出 JSON 报告，含：

- OS / 架构 / CPU / 内存
- 磁盘列表 + 默认网卡
- 已装组件（incus / docker / postgres / nftables）
- 端口占用（80/443/5432/8443）
- `ready` 字段：true/false + blockers 列表

不 ready 时退出码 = 2。

## 3. 交互向导

```bash
incus-admin bootstrap first-node
```

回答 7 组问题：

1. **节点名** —— 默认主机名
2. **公网 IP** —— 默认网关网卡 IPv4
3. **角色** —— `single`（单机）或 `cluster-first`（首节点，未来加节点）
4. **网络模式** —— `bridge` / `vlan`
5. **存储模式** —— `zfs` / `dir` / `ceph`
6. **TLS** —— `local-self-signed` / `letsencrypt`
7. **认证** —— `local-admin` / `oidc-logto`
8. **PostgreSQL** —— `docker` / `system` / `external`

输出写到 `/etc/incus-admin/bootstrap.yaml`（mode 0600；含 OIDC secret 等敏感字段）。

## 4. Dry-run + Apply

```bash
# 1) 预演（默认）：列每一步的实际命令
incus-admin bootstrap apply

# 2) 真执行
sudo incus-admin bootstrap apply --apply
```

apply 步骤（每步幂等）：

1. 装 incus / nftables（apt-get）
2. `incus admin init --preseed`（preseed yaml 由模板渲染）
3. PostgreSQL（docker / system / external 三选一）
4. systemd unit（`Type=notify`）+ binary 安装到 `/usr/local/bin/`
5. 健康检查 `curl /api/health`

失败处理（D26 = A）：**不自动 rollback**。打印失败步骤 + 继续步骤建议。重跑 apply 是幂等的。

## 5. 验证

打开浏览器访问：

```
https://<DOMAIN>
```

用向导问的 admin 邮箱登录。第一次登录会发送一次性密码到邮箱（local-admin 模式）；OIDC 模式直接走 Logto。

## 6. 加节点（可选）

如果向导选了 `cluster-first`：

```bash
# 在首节点生成 token
ssh first-node sudo incus cluster add new-node-name

# 在新节点跑：
sudo incus-admin bootstrap detect       # 确认准备好
sudo bash /usr/local/bin/join-node.sh \
  --name new-node \
  --pub-ip 1.2.3.4 \
  --incus-token <token>
```

`join-node.sh` 在 PLAN-028 加入了 bonded NIC + skip-network 支持。

## 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `apply` 报 `port 8443 listen` | Incus 已在跑 | `incus admin init` 已经执行过；用 `incus admin recover` 接管 |
| `incus admin init --preseed` 报 cluster_certificate 解析失败 | YAML 缩进错 | 检查 `/etc/incus-admin/incus-preseed.yaml` 多行 PEM 缩进 |
| systemd `incus-admin` 不停重启 | env 文件缺关键变量 | `journalctl -u incus-admin -n 50` 看缺哪个 env |
| netplan 在 reboot 后被 cloud-init 覆盖 | cloud-init network 接管 | apply 末尾打印的提示有禁用方法 |
| docker PG 数据丢失 | 容器删除时挂载点没保留 | apply 会用 `-v /var/lib/incusadmin-pg:/var/lib/postgresql/data` |

## 规划

二期（PLAN-XXX 后续立项）：

- ISO 安装镜像（无需先装 OS）
- Rocky / Alma / RHEL 9+ 支持
- bootstrap upgrade 子命令（无停机滚动）
- Air-gapped 部署（私有镜像源）

## 决策记录（PLAN-043）

- D26 = A：apply 失败不自动 rollback，幂等 rerun
- D27 = stdlib bufio（不引 huh，简化依赖）
- D28 = 一期 Type=simple；二期 OPS 升级到 Type=notify + `SdNotify("READY=1")`（避免本期引入 go-systemd 集成调用，systemctl restart LB 5xx 暴露窗口接受）
- D29 = C：PG 部署模式由向导问
- D30 = A：仅 Ubuntu 22.04+ / Debian 12+
