#!/usr/bin/env bash
# =============================================================================
# 新节点加入集群一站式脚本
#
# 在新节点上执行，完成以下步骤：
#   1. 前置检查（硬件、OS、网络）
#   2. 安装 Incus + ceph-common + 必要包
#   3. 生成并安全应用 netplan 网络配置
#   4. 加入 Incus 集群
#   5. 加入 Ceph 集群（添加 OSD）
#   6. 部署 nftables 防火墙规则
#   7. 最终验证
#
# 用法:
#   join-node.sh --name <节点名> --pub-ip <公网IP> --incus-token <token>
#
# 依赖: 需在已有集群节点上预先生成 Incus join token
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../configs/cluster-env.sh
source "${SCRIPT_DIR}/../configs/cluster-env.sh"

# ==================== 日志 ====================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $(date '+%H:%M:%S') $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $(date '+%H:%M:%S') $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $(date '+%H:%M:%S') $*" >&2; }
log_step()  { echo -e "\n${BLUE}====== $* ======${NC}"; }

# ==================== 参数 ====================
NODE_NAME=""
PUB_IP=""
INCUS_TOKEN=""
# OPS-026：NIC 名称 + IP 覆盖（默认从 cluster-env.sh / pub IP 反推）
OVR_NIC_PRIMARY=""
OVR_NIC_CLUSTER=""
OVR_BRIDGE_NAME=""
OVR_MGMT_IP=""
OVR_CEPH_PUB_IP=""
OVR_CEPH_CLUSTER_IP=""
SKIP_NETWORK=false

usage() {
  cat <<EOF
用法: $(basename "$0") [选项]

新节点加入 Incus + Ceph 集群的一站式脚本。

必填:
  --name <name>          节点名称（如 node6）
  --pub-ip <ip>          节点公网 IP
  --incus-token <token>  Incus 集群 join token

可选（OPS-026 兼容 bonded NIC / 异构拓扑）:
  --nic-primary <name>   主网卡名（默认从 cluster-env.sh: ${NIC_PRIMARY}）
  --nic-cluster <name>   集群网卡名（默认 cluster-env.sh: ${NIC_CLUSTER}）
  --bridge-name <name>   桥接名（默认 cluster-env.sh: ${BRIDGE_NAME}）
  --mgmt-ip <ip>         mgmt 网 IP（默认按 pub IP 末位推算 10.0.10.X）
  --ceph-pub-ip <ip>     Ceph public 网 IP（默认 10.0.20.X）
  --ceph-cluster-ip <ip> Ceph cluster 网 IP（默认 10.0.30.X）
  --skip-network         跳过 do_network（节点已由运维预配 IP/路由/桥接）；
                         preflight 改为验证 mgmt IP / 默认路由是否到位
  --help                 显示帮助

示例:
  # 标准 5 节点同款拓扑（eno1 单网卡 + VLAN）：
  $(basename "$0") --name node3 --pub-ip 202.151.179.228 --incus-token eyJ...

  # bonded NIC + 预配网络（如 node6）：
  $(basename "$0") --name node6 --pub-ip 202.151.179.231 --incus-token eyJ... \\
    --skip-network --mgmt-ip 10.0.10.6 --ceph-pub-ip 10.0.20.6 --ceph-cluster-ip 10.0.30.6
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)             NODE_NAME="$2";          shift 2 ;;
    --pub-ip)           PUB_IP="$2";             shift 2 ;;
    --incus-token)      INCUS_TOKEN="$2";        shift 2 ;;
    --nic-primary)      OVR_NIC_PRIMARY="$2";    shift 2 ;;
    --nic-cluster)      OVR_NIC_CLUSTER="$2";    shift 2 ;;
    --bridge-name)      OVR_BRIDGE_NAME="$2";    shift 2 ;;
    --mgmt-ip)          OVR_MGMT_IP="$2";        shift 2 ;;
    --ceph-pub-ip)      OVR_CEPH_PUB_IP="$2";    shift 2 ;;
    --ceph-cluster-ip)  OVR_CEPH_CLUSTER_IP="$2"; shift 2 ;;
    --skip-network)     SKIP_NETWORK=true;       shift 1 ;;
    --help|-h)          usage ;;
    *)                  log_error "未知参数: $1"; usage ;;
  esac
done

if [[ -z "$NODE_NAME" || -z "$PUB_IP" || -z "$INCUS_TOKEN" ]]; then
  log_error "必须指定 --name, --pub-ip, --incus-token"
  usage
fi

# OPS-026：让 cluster-env.sh 默认值被命令行覆盖
[[ -n "$OVR_NIC_PRIMARY" ]] && NIC_PRIMARY="$OVR_NIC_PRIMARY"
[[ -n "$OVR_NIC_CLUSTER" ]] && NIC_CLUSTER="$OVR_NIC_CLUSTER"
[[ -n "$OVR_BRIDGE_NAME" ]] && BRIDGE_NAME="$OVR_BRIDGE_NAME"

# 校验 IP 格式和子网范围
validate_ip() {
  local ip="$1"
  if ! [[ "$ip" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]]; then
    return 1
  fi
  local i
  for i in 1 2 3 4; do
    local octet="${BASH_REMATCH[$i]}"
    if [[ "$octet" -gt 255 ]]; then
      return 1
    fi
  done
  return 0
}

if ! validate_ip "$PUB_IP"; then
  log_error "公网 IP 格式非法: ${PUB_IP}"
  exit 1
fi

# 校验节点名（防止拼入 SSH 远程命令时的注入攻击）
if ! [[ "$NODE_NAME" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,62}[a-zA-Z0-9])?$ ]]; then
  log_error "节点名格式非法（仅允许字母、数字、连字符，不以连字符开头或结尾）: ${NODE_NAME}"
  exit 1
fi

# 校验 IP 在集群子网范围内（202.151.179.224/27 → .225-.254）
pub_last_octet=$(echo "$PUB_IP" | cut -d. -f4)
if [[ "$PUB_IP" != 202.151.179.* ]] || [[ "$pub_last_octet" -lt 225 ]] || [[ "$pub_last_octet" -gt 254 ]]; then
  log_error "公网 IP 不在集群子网 ${PUBLIC_NETWORK} 范围内: ${PUB_IP}"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  log_error "请以 root 权限运行"
  exit 1
fi

# ==================== 从节点名推算内网 IP ====================
# 规则: 公网 IP 末位数字作为内网 IP 后缀
# 例如: 202.151.179.231 → 10.0.10.231, 10.0.20.231, 10.0.30.231
# OPS-026: --mgmt-ip / --ceph-pub-ip / --ceph-cluster-ip 命令行覆盖 derive
derive_internal_ips() {
  local octet
  octet=$(echo "$PUB_IP" | cut -d. -f4)
  MGMT_IP="${OVR_MGMT_IP:-10.0.10.${octet}}"
  CEPH_PUB_IP="${OVR_CEPH_PUB_IP:-10.0.20.${octet}}"
  CEPH_CLUSTER_IP="${OVR_CEPH_CLUSTER_IP:-10.0.30.${octet}}"
}

derive_internal_ips

log_info "节点: ${NODE_NAME}"
log_info "公网 IP: ${PUB_IP}"
log_info "管理网: ${MGMT_IP}  Ceph Public: ${CEPH_PUB_IP}  Ceph Cluster: ${CEPH_CLUSTER_IP}"

# ==================== 步骤 1: 前置检查 ====================
do_preflight() {
  log_step "步骤 1/7: 前置检查"

  # 检查 OS 版本
  if [[ ! -f /etc/os-release ]]; then
    log_error "无法检测 OS 版本"
    exit 1
  fi
  # shellcheck source=/dev/null
  source /etc/os-release
  log_info "操作系统: ${PRETTY_NAME}"

  if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
    log_error "仅支持 Ubuntu/Debian 系统"
    exit 1
  fi

  # OPS-026：skip-network 模式下，不检查 NIC 名（运维已预配），改为
  # 验证 mgmt IP 是否在本机存在 + 默认路由 + 公网可达
  if [[ "$SKIP_NETWORK" == "true" ]]; then
    log_info "skip-network 模式：跳过 NIC 名称检查"
    if ! ip -4 addr show | grep -q "inet ${MGMT_IP}/"; then
      log_error "mgmt IP ${MGMT_IP} 未在本机任何网卡上配置（skip-network 模式要求运维预配）"
      exit 1
    fi
    log_info "mgmt IP ${MGMT_IP} 已就位"
    if ! ip route show default | grep -q "default"; then
      log_error "默认路由不存在"
      exit 1
    fi
    log_info "默认路由就位"
  else
    # 检查双网卡
    if ! ip link show "${NIC_PRIMARY}" &>/dev/null; then
      log_error "主网卡 ${NIC_PRIMARY} 不存在"
      exit 1
    fi
    log_info "主网卡 ${NIC_PRIMARY} 存在"

    if ! ip link show "${NIC_CLUSTER}" &>/dev/null; then
      log_error "集群网卡 ${NIC_CLUSTER} 不存在"
      exit 1
    fi
    log_info "集群网卡 ${NIC_CLUSTER} 存在"
  fi

  # 检查磁盘（至少有可用的数据盘）
  local avail_disks
  avail_disks=$(lsblk -dno NAME,TYPE | awk '$2=="disk"' | wc -l)
  log_info "检测到 ${avail_disks} 块磁盘"
  if [[ "$avail_disks" -lt 2 ]]; then
    log_warn "磁盘数量较少（${avail_disks}），确保有独立的 OSD 数据盘"
  fi

  # 检查网络连通性（网关）
  if ping -c 2 -W 3 "${PUBLIC_GATEWAY}" &>/dev/null; then
    log_info "网关 ${PUBLIC_GATEWAY} 可达"
  else
    log_warn "网关 ${PUBLIC_GATEWAY} 暂不可达（网络配置后应可达）"
  fi

  # 检查 DNS
  if host -W 3 archive.ubuntu.com &>/dev/null 2>&1 || \
     ping -c 1 -W 3 1.1.1.1 &>/dev/null; then
    log_info "外网连通性正常"
  else
    log_warn "外网暂不可达，安装步骤可能失败"
  fi

  log_info "前置检查完成"
}

# ==================== 步骤 2: 安装软件包 ====================
do_install_packages() {
  log_step "步骤 2/7: 安装必要软件包"

  apt-get update -qq

  # 安装 Incus（如未安装）
  if ! command -v incus &>/dev/null; then
    log_info "安装 Incus..."
    # 添加 Incus 官方源（Zabbly）
    if [[ ! -f /etc/apt/sources.list.d/zabbly-incus-stable.sources ]]; then
      curl -fsSL https://pkgs.zabbly.com/key.asc | gpg --dearmor -o /usr/share/keyrings/zabbly.gpg
      # shellcheck source=/dev/null
      source /etc/os-release
      cat > /etc/apt/sources.list.d/zabbly-incus-stable.sources <<ZABBLY
Types: deb
URIs: https://pkgs.zabbly.com/incus/stable
Suites: ${VERSION_CODENAME}
Components: main
Signed-By: /usr/share/keyrings/zabbly.gpg
ZABBLY
      apt-get update -qq
    fi
    apt-get install -y incus
  else
    log_info "Incus 已安装: $(incus version 2>/dev/null || echo 'unknown')"
  fi

  # 安装 ceph-common（Ceph 客户端）
  if ! command -v ceph &>/dev/null; then
    log_info "安装 ceph-common..."
    apt-get install -y ceph-common
  else
    log_info "ceph-common 已安装"
  fi

  # 安装 cephadm（OSD 部署需要）
  if ! command -v cephadm &>/dev/null; then
    log_info "安装 cephadm..."
    apt-get install -y cephadm
  else
    log_info "cephadm 已安装"
  fi

  # 其他工具
  apt-get install -y -qq jq nftables python3 bridge-utils 2>/dev/null || true

  log_info "软件包安装完成"
}

# ==================== 步骤 3: 网络配置 ====================
do_network() {
  log_step "步骤 3/7: 网络配置"

  if [[ "$SKIP_NETWORK" == "true" ]]; then
    log_info "skip-network 模式：跳过 netplan 生成 / 应用（运维已预配）"
    log_info "  mgmt:    ${MGMT_IP}"
    log_info "  ceph_pub: ${CEPH_PUB_IP}"
    log_info "  ceph_clu: ${CEPH_CLUSTER_IP}"
    return 0
  fi

  local netplan_file
  netplan_file=$(mktemp "/tmp/netplan-${NODE_NAME}-XXXXXX.yaml")
  trap 'rm -f "$netplan_file"' EXIT

  log_info "生成 netplan 配置..."
  cat > "$netplan_file" <<YAML
# ${NODE_NAME} netplan 配置
# 公网: ${PUB_IP}/27  管理网: ${MGMT_IP}/24
# Ceph Public: ${CEPH_PUB_IP}/24  Ceph Cluster: ${CEPH_CLUSTER_IP}/24
network:
  version: 2
  renderer: networkd

  ethernets:
    ${NIC_PRIMARY}:
      mtu: 9000
      dhcp4: false
      dhcp6: false
    ${NIC_CLUSTER}:
      mtu: 9000
      dhcp4: false
      dhcp6: false
      addresses:
        - ${CEPH_CLUSTER_IP}/24

  vlans:
    ${NIC_PRIMARY}.${VLAN_MGMT}:
      id: ${VLAN_MGMT}
      link: ${NIC_PRIMARY}
      mtu: 1500
      addresses:
        - ${MGMT_IP}/24
    ${NIC_PRIMARY}.${VLAN_CEPH_PUBLIC}:
      id: ${VLAN_CEPH_PUBLIC}
      link: ${NIC_PRIMARY}
      mtu: 9000
      addresses:
        - ${CEPH_PUB_IP}/24

  bridges:
    ${BRIDGE_NAME}:
      interfaces:
        - ${NIC_PRIMARY}
      mtu: 1500
      dhcp4: false
      dhcp6: false
      addresses:
        - ${PUB_IP}/27
      routes:
        - to: default
          via: ${PUBLIC_GATEWAY}
      nameservers:
        addresses:
          - 223.5.5.5
          - 8.8.8.8
YAML

  log_info "生成的 netplan 配置:"
  cat "$netplan_file"
  echo ""

  # 调用 apply-network.sh 安全应用（带回滚安全网）
  local apply_script="${SCRIPT_DIR}/apply-network.sh"
  if [[ -f "$apply_script" ]]; then
    log_info "调用 apply-network.sh 安全应用网络配置..."
    bash "$apply_script" "$netplan_file"
  else
    log_error "apply-network.sh 不存在，禁止无安全网直接应用网络配置"
    log_error "此集群无带外管理，网络中断不可恢复。请先部署 apply-network.sh"
    rm -f "$netplan_file"
    exit 1
  fi

  # 等待网络稳定
  sleep 3

  # 验证内网连通
  log_info "验证管理网连通性..."
  local bootstrap_mgmt_ip
  bootstrap_mgmt_ip=$(get_node_field "${CEPH_BOOTSTRAP_NODE}" 3)
  if ping -c 2 -W 3 "${bootstrap_mgmt_ip}" &>/dev/null; then
    log_info "管理网连通正常（可达 ${CEPH_BOOTSTRAP_NODE}: ${bootstrap_mgmt_ip}）"
  else
    log_warn "管理网暂不可达（${bootstrap_mgmt_ip}），请检查 VLAN 交换机配置"
  fi

  log_info "网络配置完成"
}

# ==================== 步骤 4: 加入 Incus 集群 ====================
do_join_incus() {
  log_step "步骤 4/7: 加入 Incus 集群"

  local bind_addr="${MGMT_IP}:${INCUS_CLUSTER_PORT}"

  # 对 YAML 值进行转义：用单引号包裹，内部单引号用 '' 转义
  local escaped_token
  escaped_token=$(printf '%s' "${INCUS_TOKEN}" | sed "s/'/''/g")
  local escaped_name
  escaped_name=$(printf '%s' "${NODE_NAME}" | sed "s/'/''/g")

  local preseed
  preseed=$(cat <<YAML
config:
  core.https_address: '${bind_addr}'
  cluster.https_address: '${bind_addr}'
cluster:
  server_name: '${escaped_name}'
  enabled: true
  cluster_token: '${escaped_token}'
YAML
  )

  log_info "使用 preseed 加入集群（绑定: ${bind_addr}）..."
  printf '%s\n' "$preseed" | incus admin init --preseed

  log_info "等待集群同步..."
  sleep 5

  # 验证
  if incus cluster list 2>/dev/null | grep -q "${NODE_NAME}"; then
    log_info "节点 ${NODE_NAME} 已成功加入 Incus 集群"
    incus cluster list
  else
    log_error "加入 Incus 集群失败"
    exit 1
  fi
}

# ==================== 步骤 5: 加入 Ceph 集群 ====================
do_join_ceph() {
  log_step "步骤 5/7: 加入 Ceph 集群（添加 OSD）"

  local bootstrap_mgmt_ip
  bootstrap_mgmt_ip=$(get_node_field "${CEPH_BOOTSTRAP_NODE}" 3)

  # 通过 bootstrap 节点将本机添加到 Ceph 集群
  log_info "在 bootstrap 节点上添加 ${NODE_NAME} 到 Ceph..."

  # 确定标签
  local labels="osd"
  ssh -o StrictHostKeyChecking=accept-new "${SSH_USER}@${bootstrap_mgmt_ip}" \
    "ceph orch host add '${NODE_NAME}' '${CEPH_PUB_IP}' --labels ${labels}" || {
      log_warn "ceph orch host add 失败或主机已存在，继续..."
    }

  # 等待 cephadm agent 部署到新节点
  log_info "等待 cephadm agent 部署到 ${NODE_NAME}..."
  local retries=0
  while [[ $retries -lt 30 ]]; do
    local host_status
    # 通过环境变量传递 NODE_NAME 给 Python，避免代码注入
    host_status=$(ssh -o StrictHostKeyChecking=accept-new "${SSH_USER}@${bootstrap_mgmt_ip}" \
      "ceph orch host ls --format json 2>/dev/null" | \
      _NODE_NAME="${NODE_NAME}" python3 -c "import sys,json,os; hosts=json.load(sys.stdin); [print(h.get('status','')) for h in hosts if h['hostname']==os.environ['_NODE_NAME']]" 2>/dev/null || echo "unknown")
    if [[ "$host_status" != "unknown" ]]; then
      break
    fi
    sleep 5
    retries=$((retries + 1))
  done

  # OSD 将由已有的 OSD service spec 自动部署到新节点
  # 参考 deploy-ceph.sh 的 ceph-osd-spec.yaml（service_type: osd, host_pattern: '*'）
  log_info "OSD 将由 ceph orchestrator 根据已有 spec 自动部署"
  log_info "可在 bootstrap 节点上监控: ceph orch osd status"

  # 等待 OSD 启动
  log_info "等待 OSD 启动（超时 5 分钟）..."
  retries=0
  while [[ $retries -lt 30 ]]; do
    local osd_count
    # 通过环境变量传递 NODE_NAME 给 Python，避免代码注入
    osd_count=$(ssh -o StrictHostKeyChecking=accept-new "${SSH_USER}@${bootstrap_mgmt_ip}" \
      "ceph osd tree --format json 2>/dev/null" | \
      _NODE_NAME="${NODE_NAME}" python3 -c "
import sys, json, os
data = json.load(sys.stdin)
target = os.environ['_NODE_NAME']
count = sum(1 for n in data.get('nodes',[]) if n.get('type')=='osd' and n.get('host','')==target and n.get('status')=='up')
print(count)
" 2>/dev/null || echo "0")
    if [[ "$osd_count" -gt 0 ]]; then
      log_info "${NODE_NAME} 上 ${osd_count} 个 OSD 已启动"
      break
    fi
    if [[ $((retries % 6)) -eq 0 && $retries -gt 0 ]]; then
      log_info "  仍在等待 OSD 部署...（${retries}0s）"
    fi
    sleep 10
    retries=$((retries + 1))
  done

  if [[ $retries -ge 30 ]]; then
    log_warn "OSD 部署超时，请手动检查: ceph osd tree"
  fi

  log_info "Ceph 节点加入完成"
}

# ==================== 步骤 6: 防火墙 ====================
do_firewall() {
  log_step "步骤 6/7: 部署防火墙规则"

  if [[ "$SKIP_NETWORK" == "true" ]] && ! ip link show "${BRIDGE_NAME}" &>/dev/null; then
    log_info "skip-network 模式且 ${BRIDGE_NAME} 桥未配置：跳过防火墙（OSD-only 节点不需要 VM 网络规则）"
    return 0
  fi

  local firewall_script="${SCRIPT_DIR}/setup-firewall.sh"
  if [[ -f "$firewall_script" ]]; then
    log_info "调用 setup-firewall.sh 部署防火墙..."
    bash "$firewall_script" --apply --node-ip "${PUB_IP}" --bridge "${BRIDGE_NAME}"
  else
    log_warn "setup-firewall.sh 不存在，跳过防火墙配置"
  fi
}

# ==================== 步骤 7: 最终验证 ====================
do_verify() {
  log_step "步骤 7/7: 最终验证"

  local errors=0

  # 检查 Incus 集群状态
  log_info "检查 Incus 集群..."
  if incus cluster list 2>/dev/null | grep -q "${NODE_NAME}.*Online"; then
    log_info "  [OK] Incus 节点在线"
  else
    log_error "  [FAIL] Incus 节点不在线"
    errors=$((errors + 1))
  fi

  # OPS-026：skip-network 模式跳过 netplan 派生的检查（运维负责），但仍
  # 验证 mgmt IP / 默认路由是否就位
  if [[ "$SKIP_NETWORK" == "true" ]]; then
    log_info "检查网络（skip-network 模式）..."
    if ip -4 addr show | grep -q "inet ${MGMT_IP}/"; then
      log_info "  [OK] mgmt IP ${MGMT_IP} 已配置"
    else
      log_error "  [FAIL] mgmt IP ${MGMT_IP} 未配置"
      errors=$((errors + 1))
    fi
  else
    # 检查网桥
    log_info "检查网络接口..."
    if ip link show "${BRIDGE_NAME}" &>/dev/null; then
      log_info "  [OK] ${BRIDGE_NAME} 网桥存在"
    else
      log_error "  [FAIL] ${BRIDGE_NAME} 网桥不存在"
      errors=$((errors + 1))
    fi

    # 检查 VLAN 接口
    if ip link show "${NIC_PRIMARY}.${VLAN_MGMT}" &>/dev/null; then
      log_info "  [OK] VLAN ${VLAN_MGMT} 接口存在"
    else
      log_error "  [FAIL] VLAN ${VLAN_MGMT} 接口不存在"
      errors=$((errors + 1))
    fi
  fi

  # 检查 Ceph 连通
  log_info "检查 Ceph 连通..."
  if ceph -s &>/dev/null 2>&1; then
    log_info "  [OK] Ceph 集群可达"
  else
    log_warn "  [WARN] 本地 ceph -s 不可达（可能需从 bootstrap 节点检查）"
  fi

  # 检查 nftables
  log_info "检查防火墙..."
  if systemctl is-enabled nftables-vm-filter &>/dev/null 2>&1; then
    log_info "  [OK] nftables-vm-filter 服务已启用"
  else
    log_warn "  [WARN] nftables-vm-filter 服务未启用"
  fi

  # 总结
  echo ""
  if [[ $errors -eq 0 ]]; then
    log_info "=========================================="
    log_info "  节点 ${NODE_NAME} 加入集群成功！"
    log_info "=========================================="
  else
    log_error "=========================================="
    log_error "  存在 ${errors} 个错误，请检查上述输出"
    log_error "=========================================="
    exit 1
  fi
}

# ==================== 主流程 ====================
main() {
  log_step "开始将 ${NODE_NAME} 加入集群"

  do_preflight
  do_install_packages
  do_network
  do_join_incus
  do_join_ceph
  do_firewall
  do_verify
}

main
