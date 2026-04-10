#!/usr/bin/env bash
# =============================================================================
# 集群环境变量配置 — 所有集群脚本共享
# =============================================================================

# ----- 节点定义 -----
# 格式: 节点名称:公网IP:管理网IP:角色(voter|stand-by)
CLUSTER_NODES=(
  "node1:202.151.179.226:10.0.10.1:voter"
  "node2:202.151.179.227:10.0.10.2:voter"
  "node3:202.151.179.228:10.0.10.3:voter"
  "node4:202.151.179.229:10.0.10.4:stand-by"
  "node5:202.151.179.230:10.0.10.5:stand-by"
)

# ----- 网络 -----
PUBLIC_SUBNET="202.151.179.224/27"
PUBLIC_GATEWAY="202.151.179.225"
PUBLIC_NETMASK="255.255.255.224"

MGMT_SUBNET="10.0.10.0/24"
MGMT_VLAN=10

# ----- Incus 集群 -----
INCUS_CLUSTER_PORT=8443
CLUSTER_NAME="incus-cluster"

# 集群参数
CLUSTER_OFFLINE_THRESHOLD=20    # 节点离线判定（秒）
CLUSTER_HEALING_THRESHOLD=300   # 自动修复等待（秒）

# ----- 辅助函数 -----

# 解析节点信息
# 用法: parse_node "node1:202.151.179.226:10.0.10.1:voter"
# 设置变量: NODE_NAME, NODE_PUBLIC_IP, NODE_MGMT_IP, NODE_ROLE
parse_node() {
  local IFS=':'
  read -r NODE_NAME NODE_PUBLIC_IP NODE_MGMT_IP NODE_ROLE <<< "$1"
}

# 根据名称查找节点
# 用法: find_node "node1"  → 返回节点定义字符串
find_node() {
  local name="$1"
  for node in "${CLUSTER_NODES[@]}"; do
    if [[ "$node" == "${name}:"* ]]; then
      echo "$node"
      return 0
    fi
  done
  return 1
}

# 获取当前主机对应的节点信息（通过管理网 IP 匹配）
get_local_node() {
  for node in "${CLUSTER_NODES[@]}"; do
    parse_node "$node"
    if ip addr show | grep -q "inet ${NODE_MGMT_IP}/"; then
      echo "$node"
      return 0
    fi
  done
  return 1
}
