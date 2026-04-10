#!/bin/bash
# ============================================================
# Ceph RBD Mirroring 异地灾备配置脚本
# 用途: 在主备两个 Ceph 集群间配置 RBD 镜像同步
#
# 前置条件:
#   - 主集群 (primary) 和备集群 (secondary) 的 Ceph 已部署
#   - 两集群之间网络互通
#   - 已配置 cluster-env.sh 中的灾备参数
#
# 用法:
#   setup-disaster-recovery.sh <步骤>
#
# 步骤:
#   preflight       - 前置检查
#   enable-mirror   - 在两端启用 RBD mirroring
#   bootstrap       - 生成并交换 bootstrap token
#   add-peer        - 建立 peer 关系
#   enable-pool     - 对目标池启用镜像
#   enable-images   - 对已有 image 启用 journaling
#   deploy-daemon   - 部署 rbd-mirror 守护进程
#   verify          - 验证镜像状态
#   all             - 按顺序执行以上全部步骤
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../configs/cluster-env.sh"

# ==================== 日志 ====================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERR]${NC} $*" >&2; exit 1; }
step() { echo -e "\n${BLUE}========== $* ==========${NC}"; }

# ==================== 灾备配置 ====================
DR_PRIMARY_NODE="${DR_PRIMARY_NODE:-node1}"
DR_SECONDARY_HOST="${DR_SECONDARY_HOST:-}"           # 备集群管理 IP
DR_SECONDARY_USER="${DR_SECONDARY_USER:-root}"
DR_POOL_NAME="${DR_POOL_NAME:-${CEPH_POOL_NAME}}"    # 需要镜像的池
DR_MIRROR_MODE="${DR_MIRROR_MODE:-pool}"             # pool 或 image 模式
DR_BOOTSTRAP_TOKEN_PATH="/tmp/rbd-mirror-bootstrap-token"

# 远程执行
run_on() {
  local node="$1"; shift
  local ip
  ip=$(get_node_field "$node" 3)
  ssh -o StrictHostKeyChecking=no "${SSH_USER}@${ip}" "$@"
}

# 在备集群上执行
run_on_secondary() {
  [[ -z "$DR_SECONDARY_HOST" ]] && err "未配置备集群地址 (DR_SECONDARY_HOST)"
  ssh -o StrictHostKeyChecking=no "${DR_SECONDARY_USER}@${DR_SECONDARY_HOST}" "$@"
}

# ==================== 前置检查 ====================
do_preflight() {
  step "前置检查"

  [[ -z "$DR_SECONDARY_HOST" ]] && err "请设置 DR_SECONDARY_HOST（备集群管理 IP）"

  log "检查主集群状态..."
  local primary_health
  primary_health=$(run_on "${DR_PRIMARY_NODE}" "ceph health --connect-timeout 10" 2>/dev/null) || \
    err "无法连接主集群"
  log "主集群状态: ${primary_health}"

  log "检查备集群连通性..."
  if ! ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 \
       "${DR_SECONDARY_USER}@${DR_SECONDARY_HOST}" "echo ok" >/dev/null 2>&1; then
    err "无法连接备集群 (${DR_SECONDARY_HOST})"
  fi

  local secondary_health
  secondary_health=$(run_on_secondary "ceph health --connect-timeout 10" 2>/dev/null) || \
    err "备集群 Ceph 不可用"
  log "备集群状态: ${secondary_health}"

  log "检查目标存储池..."
  run_on "${DR_PRIMARY_NODE}" "ceph osd pool ls | grep -q '^${DR_POOL_NAME}$'" || \
    err "主集群存储池 ${DR_POOL_NAME} 不存在"
  run_on_secondary "ceph osd pool ls | grep -q '^${DR_POOL_NAME}$'" || \
    err "备集群存储池 ${DR_POOL_NAME} 不存在"
  log "存储池 ${DR_POOL_NAME} 在两端均存在"

  log "检查 rbd-mirror 包..."
  run_on "${DR_PRIMARY_NODE}" "command -v rbd >/dev/null 2>&1" || \
    err "主集群未安装 rbd 工具"
  run_on_secondary "command -v rbd >/dev/null 2>&1" || \
    err "备集群未安装 rbd 工具"

  log "前置检查完成"
}

# ==================== 启用 RBD mirroring 功能 ====================
do_enable_mirror() {
  step "启用 RBD Mirroring"

  log "在主集群启用 mirroring (${DR_MIRROR_MODE} 模式)..."
  run_on "${DR_PRIMARY_NODE}" "
    rbd mirror pool enable ${DR_POOL_NAME} ${DR_MIRROR_MODE}
  " || err "主集群启用 mirroring 失败"

  log "在备集群启用 mirroring (${DR_MIRROR_MODE} 模式)..."
  run_on_secondary "
    rbd mirror pool enable ${DR_POOL_NAME} ${DR_MIRROR_MODE}
  " || err "备集群启用 mirroring 失败"

  log "RBD Mirroring 已在两端启用"
}

# ==================== 生成 Bootstrap Token ====================
do_bootstrap() {
  step "生成 Bootstrap Token"

  log "在主集群生成 bootstrap token..."
  run_on "${DR_PRIMARY_NODE}" "
    rbd mirror pool peer bootstrap create \
      --site-name primary \
      ${DR_POOL_NAME} > /tmp/bootstrap-token-primary.txt
  " || err "生成 bootstrap token 失败"

  # 将 token 复制到本地
  local primary_ip
  primary_ip=$(get_node_field "${DR_PRIMARY_NODE}" 3)
  scp -o StrictHostKeyChecking=no \
    "${SSH_USER}@${primary_ip}:/tmp/bootstrap-token-primary.txt" \
    "${DR_BOOTSTRAP_TOKEN_PATH}" || err "复制 bootstrap token 失败"

  log "Bootstrap token 已保存到 ${DR_BOOTSTRAP_TOKEN_PATH}"
}

# ==================== 建立 Peer 关系 ====================
do_add_peer() {
  step "建立 Peer 关系"

  [[ -f "${DR_BOOTSTRAP_TOKEN_PATH}" ]] || err "Bootstrap token 不存在，请先执行 bootstrap 步骤"

  # 将 token 复制到备集群
  scp -o StrictHostKeyChecking=no \
    "${DR_BOOTSTRAP_TOKEN_PATH}" \
    "${DR_SECONDARY_USER}@${DR_SECONDARY_HOST}:/tmp/bootstrap-token-primary.txt" || \
    err "复制 token 到备集群失败"

  log "在备集群导入 bootstrap token..."
  run_on_secondary "
    rbd mirror pool peer bootstrap import \
      --site-name secondary \
      --direction rx-only \
      ${DR_POOL_NAME} \
      /tmp/bootstrap-token-primary.txt
  " || err "导入 bootstrap token 失败"

  log "Peer 关系建立完成"

  # 清理 token 文件
  rm -f "${DR_BOOTSTRAP_TOKEN_PATH}"
  run_on "${DR_PRIMARY_NODE}" "rm -f /tmp/bootstrap-token-primary.txt" 2>/dev/null
  run_on_secondary "rm -f /tmp/bootstrap-token-primary.txt" 2>/dev/null
  log "临时 token 文件已清理"
}

# ==================== 对目标池启用镜像 ====================
do_enable_pool() {
  step "配置存储池镜像策略"

  if [[ "${DR_MIRROR_MODE}" == "pool" ]]; then
    log "池级镜像模式：所有新 image 自动启用镜像"
  else
    log "镜像级模式：需要手动为每个 image 启用镜像"
  fi

  # 确认池的镜像状态
  log "主集群池镜像状态:"
  run_on "${DR_PRIMARY_NODE}" "rbd mirror pool info ${DR_POOL_NAME}"

  log "备集群池镜像状态:"
  run_on_secondary "rbd mirror pool info ${DR_POOL_NAME}"
}

# ==================== 为已有 image 启用 journaling ====================
do_enable_images() {
  step "为已有 Image 启用 Journaling"

  log "获取池中的 image 列表..."
  local images
  images=$(run_on "${DR_PRIMARY_NODE}" "rbd ls ${DR_POOL_NAME}" 2>/dev/null) || images=""

  if [[ -z "$images" ]]; then
    warn "池 ${DR_POOL_NAME} 中无 image，跳过"
    return
  fi

  local count=0
  while IFS= read -r image; do
    [[ -z "$image" ]] && continue
    log "启用 journaling: ${DR_POOL_NAME}/${image}..."

    # 启用 exclusive-lock 和 journaling feature
    run_on "${DR_PRIMARY_NODE}" "
      rbd feature enable ${DR_POOL_NAME}/${image} exclusive-lock 2>/dev/null || true
      rbd feature enable ${DR_POOL_NAME}/${image} journaling 2>/dev/null || true
    "

    if [[ "${DR_MIRROR_MODE}" == "image" ]]; then
      # image 模式下需要显式启用镜像
      run_on "${DR_PRIMARY_NODE}" "
        rbd mirror image enable ${DR_POOL_NAME}/${image} snapshot 2>/dev/null || true
      "
    fi

    count=$((count + 1))
  done <<< "$images"

  log "已为 ${count} 个 image 启用 journaling"
}

# ==================== 部署 rbd-mirror 守护进程 ====================
do_deploy_daemon() {
  step "部署 rbd-mirror 守护进程"

  log "在备集群部署 rbd-mirror..."
  run_on_secondary "
    # 使用 cephadm 部署
    if command -v cephadm >/dev/null 2>&1; then
      ceph orch apply rbd-mirror --placement='1' 2>/dev/null || true
    else
      # 回退到 systemd 方式
      apt-get install -y rbd-mirror 2>/dev/null || yum install -y rbd-mirror 2>/dev/null
      systemctl enable --now ceph-rbd-mirror@rbd-mirror.default
    fi
  " || err "部署 rbd-mirror 失败"

  # 等待守护进程启动
  log "等待 rbd-mirror 启动..."
  local retries=20
  while [[ $retries -gt 0 ]]; do
    if run_on_secondary "ceph orch ps --daemon-type rbd-mirror 2>/dev/null | grep -q running" 2>/dev/null || \
       run_on_secondary "systemctl is-active ceph-rbd-mirror@rbd-mirror.default" 2>/dev/null; then
      log "rbd-mirror 守护进程已启动"
      break
    fi
    retries=$((retries - 1))
    sleep 3
  done

  if [[ $retries -eq 0 ]]; then
    warn "rbd-mirror 启动超时，请手动检查"
  fi
}

# ==================== 验证 ====================
do_verify() {
  step "验证 RBD Mirroring 状态"

  log "主集群镜像状态:"
  run_on "${DR_PRIMARY_NODE}" "rbd mirror pool status ${DR_POOL_NAME}" || true

  log "备集群镜像状态:"
  run_on_secondary "rbd mirror pool status ${DR_POOL_NAME}" || true

  log "Peer 信息:"
  run_on "${DR_PRIMARY_NODE}" "rbd mirror pool info ${DR_POOL_NAME}"

  # 检查 image 同步状态
  log "Image 同步状态:"
  local images
  images=$(run_on "${DR_PRIMARY_NODE}" "rbd ls ${DR_POOL_NAME}" 2>/dev/null) || images=""

  if [[ -n "$images" ]]; then
    while IFS= read -r image; do
      [[ -z "$image" ]] && continue
      local status
      status=$(run_on_secondary \
        "rbd mirror image status ${DR_POOL_NAME}/${image} 2>/dev/null | head -5" 2>/dev/null) || \
        status="无法获取状态"
      log "  ${image}: ${status}"
    done <<< "$images"
  else
    warn "池 ${DR_POOL_NAME} 中无 image"
  fi

  log "验证完成"
}

# ==================== 主入口 ====================
usage() {
  echo "用法: $0 <步骤>"
  echo ""
  echo "步骤:"
  echo "  preflight       前置检查"
  echo "  enable-mirror   启用 RBD mirroring"
  echo "  bootstrap       生成 bootstrap token"
  echo "  add-peer        建立 peer 关系"
  echo "  enable-pool     配置池镜像策略"
  echo "  enable-images   为已有 image 启用 journaling"
  echo "  deploy-daemon   部署 rbd-mirror 守护进程"
  echo "  verify          验证镜像状态"
  echo "  all             执行全部步骤"
  exit 1
}

main() {
  local action="${1:-}"
  [[ -z "$action" ]] && usage

  case "$action" in
    preflight)      do_preflight ;;
    enable-mirror)  do_enable_mirror ;;
    bootstrap)      do_bootstrap ;;
    add-peer)       do_add_peer ;;
    enable-pool)    do_enable_pool ;;
    enable-images)  do_enable_images ;;
    deploy-daemon)  do_deploy_daemon ;;
    verify)         do_verify ;;
    all)
      do_preflight
      do_enable_mirror
      do_bootstrap
      do_add_peer
      do_enable_pool
      do_enable_images
      do_deploy_daemon
      do_verify
      ;;
    *) usage ;;
  esac
}

main "$@"
