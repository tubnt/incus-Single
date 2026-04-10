#!/usr/bin/env bash
# 集群环境配置 — 所有集群脚本的公共变量
# 使用方式: source "$(dirname "$0")/../configs/cluster-env.sh"

# ── 网络配置 ──────────────────────────────────────────────
CLUSTER_SUBNET="202.151.179.224/27"
CLUSTER_NETMASK="255.255.255.224"
CLUSTER_GATEWAY="202.151.179.225"

# 宿主机 IP 范围: .226 ~ .231
HOST_IP_START="202.151.179.226"
HOST_IP_END="202.151.179.231"

# VM 可用 IP 范围: .232 ~ .254
VM_IP_START="202.151.179.232"
VM_IP_END="202.151.179.254"

# ── 桥接接口 ──────────────────────────────────────────────
BRIDGE_IFACE="br-pub"

# ── Ceph 网络 ─────────────────────────────────────────────
CEPH_PUBLIC_NETWORK="10.0.20.0/24"
CEPH_CLUSTER_NETWORK="10.0.30.0/24"

# ── 集群节点列表 ──────────────────────────────────────────
# 格式: "节点名:管理IP"
# 实际部署时按需修改
CLUSTER_NODES=(
    "node1:202.151.179.226"
    "node2:202.151.179.227"
    "node3:202.151.179.228"
    "node4:202.151.179.229"
    "node5:202.151.179.230"
)

# ── GARP 配置 ─────────────────────────────────────────────
GARP_COUNT=3          # 发送 GARP 包数量
GARP_INTERVAL=0.5     # GARP 包间隔（秒）

# ── 迁移配置 ──────────────────────────────────────────────
MIGRATE_TIMEOUT=300   # 迁移超时（秒）

# ── 辅助函数 ──────────────────────────────────────────────

log_info()  { echo "[INFO]  $(date '+%H:%M:%S') $*"; }
log_warn()  { echo "[WARN]  $(date '+%H:%M:%S') $*" >&2; }
log_error() { echo "[ERROR] $(date '+%H:%M:%S') $*" >&2; }
log_ok()    { echo "[OK]    $(date '+%H:%M:%S') $*"; }

# 检查命令是否存在
require_cmd() {
    local cmd="$1"
    if ! command -v "$cmd" &>/dev/null; then
        log_error "缺少命令: $cmd"
        return 1
    fi
}

# 获取节点名列表
get_node_names() {
    for entry in "${CLUSTER_NODES[@]}"; do
        echo "${entry%%:*}"
    done
}

# 获取节点 IP
get_node_ip() {
    local name="$1"
    for entry in "${CLUSTER_NODES[@]}"; do
        if [[ "${entry%%:*}" == "$name" ]]; then
            echo "${entry#*:}"
            return 0
        fi
    done
    return 1
}
