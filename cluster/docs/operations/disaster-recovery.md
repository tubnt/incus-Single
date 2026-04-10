# 异地灾备运维手册

## 1. 架构概述

本集群使用 **Ceph RBD Mirroring** 实现异地灾备，采用主备（Active-Standby）模式。

```
┌─────────────────┐         RBD Mirroring         ┌─────────────────┐
│   主集群 (Primary)  │ ──── journal 异步复制 ────→ │  备集群 (Secondary) │
│   node1-5        │                              │   remote site    │
│   读写服务        │                              │   只读镜像        │
└─────────────────┘                              └─────────────────┘
```

### 关键组件

| 组件 | 说明 |
|------|------|
| RBD Mirroring | Ceph 原生块设备镜像，基于 journal 异步复制 |
| rbd-mirror 守护进程 | 运行在备集群，负责拉取主集群的 journal 并回放 |
| radosgw-admin | RGW 管理工具（对象存储相关） |

### 镜像模式

- **pool 模式**（推荐）：池内所有 image 自动镜像
- **image 模式**：需手动为每个 image 启用镜像

## 2. 初始配置

### 前置条件

1. 主备两个 Ceph 集群已独立部署完成
2. 两集群之间网络互通（建议专线或 VPN）
3. 备集群有与主集群同名的存储池

### 配置步骤

```bash
# 设置备集群地址
export DR_SECONDARY_HOST="10.0.10.100"
export DR_SECONDARY_USER="root"

# 执行一键配置
./cluster/scripts/setup-disaster-recovery.sh all
```

或分步执行：

```bash
# 1. 前置检查
./cluster/scripts/setup-disaster-recovery.sh preflight

# 2. 启用镜像功能
./cluster/scripts/setup-disaster-recovery.sh enable-mirror

# 3. 生成 bootstrap token
./cluster/scripts/setup-disaster-recovery.sh bootstrap

# 4. 建立 peer 关系
./cluster/scripts/setup-disaster-recovery.sh add-peer

# 5. 配置池镜像策略
./cluster/scripts/setup-disaster-recovery.sh enable-pool

# 6. 为已有 image 启用 journaling
./cluster/scripts/setup-disaster-recovery.sh enable-images

# 7. 部署 rbd-mirror 守护进程
./cluster/scripts/setup-disaster-recovery.sh deploy-daemon

# 8. 验证
./cluster/scripts/setup-disaster-recovery.sh verify
```

## 3. 日常监控

### 状态检查

```bash
# 简要状态
./cluster/scripts/disaster-recovery-status.sh --summary

# 详细状态（含每个 image 同步情况）
./cluster/scripts/disaster-recovery-status.sh --detail

# JSON 格式（适合脚本/监控系统）
./cluster/scripts/disaster-recovery-status.sh --json

# 持续监控（每 30 秒刷新）
./cluster/scripts/disaster-recovery-status.sh --watch 30

# 健康检查（用于监控告警）
./cluster/scripts/disaster-recovery-status.sh --check
echo $?  # 0=正常, 1=降级, 2=故障
```

### 告警集成

在监控系统中添加定时检查：

```bash
# crontab 示例：每 5 分钟检查灾备状态
*/5 * * * * /path/to/disaster-recovery-status.sh --check || \
  curl -X POST "https://alerting-webhook/dr-alert" -d "status=$?"
```

### 关键指标

| 指标 | 正常值 | 告警阈值 |
|------|--------|----------|
| 镜像健康 | OK | WARNING / ERROR |
| rbd-mirror 进程 | 运行中 | 进程不存在 |
| 同步延迟 | < 30s | > 60s |
| image 状态 | replaying | stopped / error |

## 4. 故障切换

### 场景：主集群不可用

```bash
# 执行故障切换
./cluster/scripts/disaster-recovery-failover.sh failover
```

脚本执行流程：
1. 尝试降级主集群（如果可达则优雅降级）
2. 在备集群强制提升所有 image 为 primary
3. 备集群变为可读写

**切换后需要手动操作：**
- 更新 DNS 记录指向备集群
- 更新负载均衡配置
- 通知业务方切换完成

### 单独提升/降级

```bash
# 仅提升备集群
./cluster/scripts/disaster-recovery-failover.sh promote

# 仅降级主集群
./cluster/scripts/disaster-recovery-failover.sh demote
```

## 5. 故障回切

### 场景：主集群恢复后切回

```bash
# 确认主集群已恢复
ssh root@node1 "ceph health"

# 执行回切
./cluster/scripts/disaster-recovery-failover.sh failback
```

回切流程：
1. 检查主集群是否恢复
2. 降级备集群所有 image
3. 提升主集群所有 image
4. 触发重新同步

**回切后需要手动操作：**
- 更新 DNS 记录指回主集群
- 更新负载均衡配置
- 监控同步状态直到完全追赶

### 单独重新同步

```bash
./cluster/scripts/disaster-recovery-failover.sh resync
```

## 6. 故障排除

### rbd-mirror 进程不运行

```bash
# 检查守护进程
ceph orch ps --daemon-type rbd-mirror

# 重启
ceph orch restart rbd-mirror

# 查看日志
ceph log last 50 --channel cluster | grep mirror
```

### Image 同步停止

```bash
# 检查 image 状态
rbd mirror image status <pool>/<image>

# 强制重新同步
rbd mirror image resync <pool>/<image>

# 检查 journal 状态
rbd journal status <pool>/<image>
```

### Peer 连接失败

```bash
# 检查 peer 信息
rbd mirror pool info <pool>

# 删除并重新建立 peer
rbd mirror pool peer remove <pool> <peer-uuid>
./cluster/scripts/setup-disaster-recovery.sh bootstrap
./cluster/scripts/setup-disaster-recovery.sh add-peer
```

### 脑裂（Split-Brain）

当两端都变成 primary 时（脑裂），需要手动处理：

```bash
# 1. 确定权威数据源（通常是最新写入的一端）
# 2. 降级非权威端
rbd mirror image demote <pool>/<image>  # 在非权威端执行

# 3. 重新同步
rbd mirror image resync <pool>/<image>  # 在非权威端执行
```

## 7. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DR_PRIMARY_NODE` | node1 | 主集群管理节点 |
| `DR_SECONDARY_HOST` | （必填） | 备集群管理 IP |
| `DR_SECONDARY_USER` | root | 备集群 SSH 用户 |
| `DR_POOL_NAME` | incus-pool | 镜像目标存储池 |
| `DR_MIRROR_MODE` | pool | 镜像模式（pool/image） |

## 8. 演练计划

建议每季度进行一次灾备演练：

1. **通知相关方**：提前通知业务方演练时间窗口
2. **执行故障切换**：`failover` 到备集群
3. **验证业务**：确认备集群可正常读写
4. **执行回切**：`failback` 到主集群
5. **验证恢复**：确认主集群同步正常
6. **记录结果**：记录 RTO/RPO 实测数据

### RTO / RPO 参考

| 指标 | 目标值 | 说明 |
|------|--------|------|
| RPO | < 30 秒 | 异步复制延迟（取决于网络带宽） |
| RTO | < 15 分钟 | 故障切换 + DNS 更新 + 业务验证 |
