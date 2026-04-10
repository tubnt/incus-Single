# 安全渗透测试清单

> 适用范围：5 节点 Incus + Ceph 集群（202.151.179.224/27）
> 用途：上线前安全验收 + 定期安全审计

---

## 测试前准备

- [ ] 获取明确的授权书和测试范围确认
- [ ] 准备测试用 VM（不影响生产客户）
- [ ] 记录所有测试操作，便于复盘
- [ ] 准备回滚方案

---

## 1. VM 网络隔离测试

### 1.1 RFC1918 阻断验证

**目标**：验证 VM 无法访问集群内部私有网络

| 编号 | 测试项 | 测试方法 | 预期结果 |
|------|--------|----------|----------|
| 1.1.1 | VM → 管理网 | 从 VM 内 `ping 10.0.10.1`（管理网） | 超时/不可达 |
| 1.1.2 | VM → Ceph Public | 从 VM 内 `ping 10.0.20.1`（Ceph 网络） | 超时/不可达 |
| 1.1.3 | VM → Ceph Cluster | 从 VM 内 `ping 10.0.30.1`（Ceph 复制网络） | 超时/不可达 |
| 1.1.4 | VM → 10.0.0.0/8 | 从 VM 内扫描 `nmap -sn 10.0.0.0/8` | 无任何响应 |
| 1.1.5 | VM → 172.16.0.0/12 | 从 VM 内 `ping 172.16.0.1` | 超时/不可达 |
| 1.1.6 | VM → 192.168.0.0/16 | 从 VM 内 `ping 192.168.0.1` | 超时/不可达 |
| 1.1.7 | VM → 100.64.0.0/10 (CGNAT) | 从 VM 内 `ping 100.64.0.1` | 超时/不可达 |
| 1.1.8 | VM → 169.254.0.0/16 (link-local) | 从 VM 内 `ping 169.254.1.1` | 超时/不可达 |

**验证方法**：
```bash
# 在测试 VM 内执行
for net in 10.0.10.1 10.0.20.1 10.0.30.1 172.16.0.1 192.168.1.1 100.64.0.1 169.254.1.1; do
  timeout 3 ping -c1 $net && echo "FAIL: $net reachable" || echo "PASS: $net blocked"
done
```

### 1.2 VM 间隔离验证

| 编号 | 测试项 | 测试方法 | 预期结果 |
|------|--------|----------|----------|
| 1.2.1 | VM 间直接通信 | VM-A `ping` VM-B 的公网 IP | 正常（公网可互通） |
| 1.2.2 | VM 间 ARP 欺骗 | 从 VM-A 发送伪造 ARP 指向 VM-B | 被 MAC 过滤阻断 |
| 1.2.3 | port_isolation 生效 | 从 VM-A 通过二层直接访问 VM-B | 被端口隔离阻断 |

---

### 1.3 IPv6 隔离验证

**目标**：验证 VM 无法通过 IPv6 绕过隔离访问集群内部服务

| 编号 | 测试项 | 测试方法 | 预期结果 |
|------|--------|----------|----------|
| 1.3.1 | VM → 宿主机 IPv6 link-local | 从 VM 内 `ping6 fe80::1%eth0` | 超时/不可达 |
| 1.3.2 | VM → 管理端口(IPv6) | 从 VM 内 `nc -6 -zv <host-ipv6> 8443` | 不可达 |
| 1.3.3 | VM IPv6 源地址伪造 | VM 配置非分配的 IPv6 地址 | 网络中断 |
| 1.3.4 | VM → 其他 VM (IPv6 二层) | VM-A 通过 IPv6 link-local 访问 VM-B | 被端口隔离阻断 |

**验证方法**：
```bash
# 在测试 VM 内执行
# 测试 IPv6 link-local 到宿主机
timeout 3 ping6 -c1 fe80::1%eth0 && echo "FAIL" || echo "PASS"

# 测试 IPv6 访问管理端口
for port in 8443 9090 9100 22; do
  timeout 3 nc -6 -zv fe80::1%eth0 $port 2>&1 && echo "FAIL: port $port open" || echo "PASS: port $port closed"
done
```

---

## 2. IP 伪造测试

| 编号 | 测试项 | 测试方法 | 预期结果 |
|------|--------|----------|----------|
| 2.1 | 源 IP 伪造 | VM 使用 `hping3 --spoof <other-ip> <target>` | 包被丢弃 |
| 2.2 | IP 地址变更 | VM 内手动修改 IP 为未分配地址 | 网络中断 |
| 2.3 | MAC 地址变更 | VM 内手动修改 MAC 地址 | 网络中断 |
| 2.4 | DHCP 欺骗 | VM 内启动 DHCP 服务器 | 无其他 VM 受影响 |
| 2.5 | ARP 泛洪 | VM 发送大量伪造 ARP 包 | 包被丢弃，不影响其他 VM |

**验证方法**：
```bash
# 在测试 VM 内（需要 root 权限）
# 测试 IP 伪造
apt install -y hping3
hping3 --spoof 202.151.179.240 -c 3 202.151.179.225
# 在网关或目标抓包验证：不应看到伪造源地址的包

# 测试 MAC 变更
ip link set eth0 address aa:bb:cc:dd:ee:ff
ping -c3 202.151.179.225
# 预期：ping 失败
```

---

## 3. 管理端口暴露测试

**目标**：验证集群管理端口不对 VM 和外网暴露

| 编号 | 端口 | 服务 | 从 VM 测试 | 从外网测试 | 预期 |
|------|------|------|-----------|-----------|------|
| 3.1 | 8443 | Incus API | `nc -zv 10.0.10.1 8443` | 外部扫描 | 仅管理网/WireGuard 可达 |
| 3.2 | 9090 | Prometheus | `nc -zv <node-ip> 9090` | 外部扫描 | 仅管理网可达 |
| 3.3 | 9093 | Alertmanager | `nc -zv <node-ip> 9093` | 外部扫描 | 仅管理网可达 |
| 3.4 | 9100 | node_exporter | `nc -zv <node-ip> 9100` | 外部扫描 | 仅管理网可达 |
| 3.5 | 3100 | Loki | `nc -zv <node-ip> 3100` | 外部扫描 | 仅管理网可达 |
| 3.6 | 22 | SSH | `nc -zv <node-ip> 22` | 外部扫描 | 仅管理网可达 |
| 3.7 | 51820 | WireGuard | 外部扫描 | `nmap -sU -p 51820` | 仅 Paymenter 端 IP 可达 |

**验证方法**：
```bash
# 从测试 VM 内部扫描宿主机管理端口
for port in 8443 9090 9093 9100 3100 22; do
  timeout 3 nc -zv 202.151.179.226 $port 2>&1 && echo "FAIL: port $port open" || echo "PASS: port $port closed"
done
```

---

## 4. Ceph 端口访问控制测试

| 编号 | 端口范围 | 服务 | 测试方法 | 预期 |
|------|----------|------|----------|------|
| 4.1 | 6789 | Ceph MON | 从 VM `nc -zv 10.0.20.1 6789` | 不可达（RFC1918 阻断） |
| 4.2 | 3300 | Ceph MON (msgr2) | 从 VM `nc -zv 10.0.20.1 3300` | 不可达 |
| 4.3 | 6800-7300 | Ceph OSD | 从 VM 扫描 OSD 端口范围 | 不可达 |
| 4.4 | 9283 | Ceph MGR Prometheus | 从 VM `nc -zv 10.0.20.1 9283` | 不可达 |
| 4.5 | 8443 | Ceph Dashboard | 从 VM `nc -zv 10.0.20.1 8443` | 不可达 |

**补充验证**：
```bash
# 从集群外部（非管理网）扫描 Ceph 端口
nmap -sT -p 3300,6789,6800-7300,9283 202.151.179.226
# 预期：所有端口 filtered 或 closed
```

---

## 5. Paymenter 证书权限范围测试

### 5.1 证书作用域验证

| 编号 | 测试项 | 测试方法 | 预期结果 |
|------|--------|----------|----------|
| 5.1.1 | Paymenter 证书访问 customers 项目 | 使用 paymenter 证书调用 API | 成功 |
| 5.1.2 | Paymenter 证书访问 default 项目 | 使用 paymenter 证书调用 API | 403 拒绝 |
| 5.1.3 | Paymenter 证书执行集群操作 | 尝试 `cluster list` 等管理操作 | 403 拒绝 |
| 5.1.4 | Console 证书仅限 exec/console | 使用 console 证书尝试创建 VM | 403 拒绝 |
| 5.1.5 | 过期证书访问 | 使用过期证书调用 API | 拒绝连接 |

**验证方法**：
```bash
# 测试证书权限边界
INCUS_API="https://10.0.10.1:8443"

# Paymenter 证书 — 应该能访问 customers 项目
curl --cert paymenter.crt --key paymenter.key --cacert ca.crt \
  "$INCUS_API/1.0/instances?project=customers"
# 预期：200 OK

# Paymenter 证书 — 不应该能访问 default 项目
curl --cert paymenter.crt --key paymenter.key --cacert ca.crt \
  "$INCUS_API/1.0/instances?project=default"
# 预期：403 Forbidden

# Paymenter 证书 — 不应该能执行集群管理
curl --cert paymenter.crt --key paymenter.key --cacert ca.crt \
  "$INCUS_API/1.0/cluster"
# 预期：403 Forbidden
```

---

## 6. Web 应用安全测试（Paymenter）

### 6.1 SQL 注入

| 编号 | 测试项 | 测试位置 | 方法 |
|------|--------|----------|------|
| 6.1.1 | 登录表单注入 | 登录页面 | `' OR '1'='1` / `admin'--` |
| 6.1.2 | 搜索功能注入 | 搜索框/过滤器 | `' UNION SELECT * FROM users--` |
| 6.1.3 | API 参数注入 | REST API 端点 | 参数注入各种 SQL payload |
| 6.1.4 | 订单参数注入 | 下单/修改订单 | 订单 ID / 产品 ID 注入 |

**工具**：`sqlmap` 自动化测试

### 6.2 XSS（跨站脚本）

| 编号 | 测试项 | 测试位置 | 方法 |
|------|--------|----------|------|
| 6.2.1 | 反射型 XSS | 搜索/错误页面 | `<script>alert(1)</script>` |
| 6.2.2 | 存储型 XSS | 用户资料/备注 | `<img src=x onerror=alert(1)>` |
| 6.2.3 | DOM XSS | URL fragment | `#<script>alert(1)</script>` |
| 6.2.4 | VM 名称 XSS | VM 命名 | 特殊字符作为 VM 名称 |

### 6.3 CSRF（跨站请求伪造）

| 编号 | 测试项 | 方法 | 预期 |
|------|--------|------|------|
| 6.3.1 | 表单 CSRF Token | 检查所有 POST 表单是否有 CSRF token | 全部包含 |
| 6.3.2 | API CSRF 保护 | 无 token 发送修改请求 | 403 拒绝 |
| 6.3.3 | Referer 检查 | 伪造 Referer 发送请求 | 被拒绝 |

### 6.4 认证与会话安全

| 编号 | 测试项 | 方法 | 预期 |
|------|--------|------|------|
| 6.4.1 | 会话固定攻击 | 登录前后检查 session ID 是否变化 | 登录后重新生成 |
| 6.4.2 | 会话劫持 | 检查 cookie 是否设置 HttpOnly + Secure | 全部设置 |
| 6.4.3 | 密码存储 | 检查数据库中密码存储方式 | bcrypt/argon2 哈希 |
| 6.4.4 | 权限提升 | 普通用户尝试访问管理员端点 | 403 拒绝 |
| 6.4.5 | IDOR | 修改 URL 中的用户/订单 ID | 仅能访问自己的资源 |

---

## 7. 暴力破解防护测试

| 编号 | 测试项 | 方法 | 预期 |
|------|--------|------|------|
| 7.1 | SSH 暴力破解 | `hydra -l root -P wordlist.txt ssh://<target>` | fail2ban 封禁 IP |
| 7.2 | Paymenter 登录暴力破解 | 连续 10 次错误密码 | 账户锁定或 IP 限速 |
| 7.3 | API 速率限制 | 高频调用 API 端点 | 429 Too Many Requests |
| 7.4 | VM Console 暴力破解 | 连续发送无效 JWT token | 连接被拒绝/限速 |
| 7.5 | SSH 密钥认证 | 检查是否禁用密码登录 | `PasswordAuthentication no` |

**验证 fail2ban：**
```bash
# 检查 fail2ban 状态
fail2ban-client status
fail2ban-client status sshd

# 测试触发封禁
# 从测试 IP 连续尝试 5 次错误密码
# 预期：IP 被封禁 10 分钟以上
```

---

## 8. DDoS 缓解验证

| 编号 | 测试项 | 方法 | 预期 |
|------|--------|------|------|
| 8.1 | SYN Flood 防护 | 小规模 SYN Flood 测试 | syncookies 生效 |
| 8.2 | UDP Flood 防护 | 小规模 UDP Flood 测试 | 速率限制生效 |
| 8.3 | 上游 null-route 机制 | 确认上游 ISP null-route 流程 | 文档化且可操作 |
| 8.4 | 连接数限制 | 大量并发连接测试 | conntrack 限制生效 |
| 8.5 | Paymenter WAF | 恶意请求模式测试 | 被 WAF 规则拦截 |

**注意**：DDoS 测试必须在受控环境下进行，不得影响同网段其他用户。架构设计上，DDoS 攻击由上游 ISP null-route 处理，集群本身不吸收攻击流量。

**验证 syncookies：**
```bash
# 检查 syncookies 是否开启
sysctl net.ipv4.tcp_syncookies
# 预期：net.ipv4.tcp_syncookies = 1
```

---

## 9. 密钥存储安全审计

| 编号 | 审计项 | 检查方法 | 预期 |
|------|--------|----------|------|
| 9.1 | 环境变量中的密钥 | 检查 `.env` 文件权限 | `chmod 600`，仅 root 可读 |
| 9.2 | 密钥硬编码检查 | `grep -r "password\|secret\|key" --include="*.sh"` | 无硬编码密钥 |
| 9.3 | Git 历史密钥泄露 | `git log --diff-filter=D -- "*.env"` | 无密钥泄露 |
| 9.4 | Ceph dmcrypt 密钥 | 检查密钥存储位置和权限 | 加密存储，受限访问 |
| 9.5 | TLS 私钥权限 | `ls -la /path/to/*.key` | `chmod 600`，仅 root |
| 9.6 | WireGuard 私钥 | `ls -la /etc/wireguard/private.key` | `chmod 600`，仅 root |
| 9.7 | Paymenter APP_KEY | 检查 Laravel `.env` 中 APP_KEY | 存在且随机生成 |
| 9.8 | MySQL root 密码 | 检查密码强度 | 随机生成 ≥ 24 字符 |
| 9.9 | Redis 密码 | 检查是否设置认证 | `requirepass` 已设置 |
| 9.10 | JWT 签名密钥 | 检查 console-proxy JWT secret | 随机生成，非硬编码 |

**自动化审计脚本：**
```bash
#!/bin/bash
echo "=== 密钥存储安全审计 ==="

# 检查 .env 文件权限
echo "--- .env 文件权限 ---"
find / -name ".env" -type f 2>/dev/null | while read f; do
  stat -c "%a %U:%G %n" "$f"
done

# 检查 TLS 私钥权限
echo "--- TLS 私钥权限 ---"
find / -name "*.key" -type f 2>/dev/null | while read f; do
  stat -c "%a %U:%G %n" "$f"
done

# 检查硬编码密码（排除 .env 和二进制文件）
echo "--- 硬编码密码检查 ---"
grep -rl "password\s*=" --include="*.sh" --include="*.yml" --include="*.yaml" \
  --include="*.conf" --include="*.php" /opt/ /etc/ 2>/dev/null | head -20
```

---

## 10. 其他安全检查

### 10.1 系统加固

| 编号 | 检查项 | 方法 | 预期 |
|------|--------|------|------|
| 10.1.1 | 内核安全参数 | `sysctl -a \| grep net.ipv4` | 已关闭 IP 转发（非路由节点） |
| 10.1.2 | 不必要的服务 | `systemctl list-units --type=service` | 无多余服务运行 |
| 10.1.3 | SUID 文件审计 | `find / -perm -4000` | 仅系统必要 SUID |
| 10.1.4 | 开放端口审计 | `ss -tlnp` | 仅必要端口监听 |
| 10.1.5 | 自动安全更新 | `apt list --upgradable` | 无 critical CVE 未修复 |

### 10.2 Incus 安全

| 编号 | 检查项 | 方法 | 预期 |
|------|--------|------|------|
| 10.2.1 | 项目隔离 | 检查 `restricted: true` | customers 项目已限制 |
| 10.2.2 | 资源配额 | 检查 limits 配置 | CPU/内存/磁盘/实例数均有上限 |
| 10.2.3 | 特权容器 | 检查是否允许特权模式 | 禁止（restricted 模式） |
| 10.2.4 | 设备访问 | 检查 restricted.devices | 仅允许 disk 类型 |

---

## 测试结果记录模板

| 编号 | 测试项 | 结果 | 发现 | 严重等级 | 修复状态 |
|------|--------|------|------|----------|----------|
| x.x.x | | PASS/FAIL | | P0-P3 | 待修复/已修复/接受风险 |

**测试执行人**：_______________
**测试日期**：_______________
**审核人**：_______________
