#!/bin/bash
# ============================================================
# 灾备故障切换 / 回切脚本
# 用途: 主集群故障时切换到备集群，或故障恢复后回切到主集群
#
# 用法:
#   disaster-recovery-failover.sh <操作>
#
# 操作:
#   failover        - 故障切换（主→备）
#   failback        - 故障回切（备→主）
#   promote         - 将备集群提升为主
#   demote          - 将主集群降级为备
#   resync          - 重新同步（回切后）
#   status          - 查看当前灾备状态
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
DR_SECONDARY_HOST="${DR_SECONDARY_HOST:-}"
DR_SECONDARY_USER="${DR_SECONDARY_USER:-root}"
DR_POOL_NAME="${DR_POOL_NAME:-${CEPH_POOL_NAME}}"

run_on() {
  local node="$1"; shift
  local ip
  ip=$(get_node_field "$node" 3)
  ssh -o StrictHostKeyChecking=no "${SSH_USER}@${ip}" "$@"
}

run_on_secondary() {
  [[ -z "$DR_SECONDARY_HOST" ]] && err "未配置备集群地址 (DR_SECONDARY_HOST)"
  ssh -o StrictHostKeyChecking=no "${DR_SECONDARY_USER}@${DR_SECONDARY_HOST}" "$@"
}

# 获取池中所有 image
get_pool_images() {
  local where="$1"  # primary 或 secondary
  if [[ "$where" == "primary" ]]; then
    run_on "${DR_PRIMARY_NODE}" "rbd ls ${DR_POOL_NAME} 2>/dev/null" || true
  else
    run_on_secondary "rbd ls ${DR_POOL_NAME} 2>/dev/null" || true
  fi
}

# ==================== 故障切换 (主→备) ====================
do_failover() {
  step "故障切换 (Failover)"
  warn "即将将备集群提升为主集群，请确认主集群已不可用！"
  warn "此操作将："
  warn "  1. 在备集群将所有 image 提升为 primary"
  warn "  2. 备集群可读写"
  echo ""

  # 安全确认
  read -rp "输入 'FAILOVER' 确认执行故障切换: " confirm
  if [[ "$confirm" != "FAILOVER" ]]; then
    log "操作已取消"
    return
  fi

  # 1. 尝试降级主集群（如果可达）
  log "尝试降级主集群..."
  if run_on "${DR_PRIMARY_NODE}" "ceph health --connect-timeout 5" >/dev/null 2>&1; then
    log "主集群可达，执行优雅降级..."
    do_demote
  else
    warn "主集群不可达，执行强制切换"
  fi

  # 2. 在备集群提升所有 image
  do_promote

  log "=========================================="
  log "故障切换完成！备集群已提升为主"
  log "请更新 DNS / 负载均衡 指向备集群"
  log "=========================================="
}

# ==================== 故障回切 (备→主) ====================
do_failback() {
  step "故障回切 (Failback)"
  warn "即将将流量从备集群切回主集群"
  warn "此操作将："
  warn "  1. 在备集群降级所有 image"
  warn "  2. 在主集群提升为 primary"
  warn "  3. 重新建立镜像同步"
  echo ""

  read -rp "输入 'FAILBACK' 确认执行回切: " confirm
  if [[ "$confirm" != "FAILBACK" ]]; then
    log "操作已取消"
    return
  fi

  # 检查主集群是否恢复
  log "检查主集群状态..."
  run_on "${DR_PRIMARY_NODE}" "ceph health --connect-timeout 10" >/dev/null 2>&1 || \
    err "主集群仍不可用，无法回切"

  local primary_health
  primary_health=$(run_on "${DR_PRIMARY_NODE}" "ceph health")
  log "主集群状态: ${primary_health}"

  # 1. 降级备集群
  log "降级备集群..."
  local images
  images=$(get_pool_images "secondary")
  while IFS= read -r image; do
    [[ -z "$image" ]] && continue
    log "  降级: ${image}..."
    run_on_secondary "rbd mirror image demote ${DR_POOL_NAME}/${image}" 2>/dev/null || \
      warn "  降级 ${image} 失败（可能已是 secondary）"
  done <<< "$images"

  # 2. 提升主集群
  log "提升主集群..."
  images=$(get_pool_images "primary")
  while IFS= read -r image; do
    [[ -z "$image" ]] && continue
    log "  提升: ${image}..."
    run_on "${DR_PRIMARY_NODE}" "rbd mirror image promote ${DR_POOL_NAME}/${image}" 2>/dev/null || \
      warn "  提升 ${image} 失败"
  done <<< "$images"

  # 3. 重新同步
  do_resync

  log "=========================================="
  log "故障回切完成！主集群已恢复服务"
  log "请更新 DNS / 负载均衡 指向主集群"
  log "=========================================="
}

# ==================== 提升备集群 ====================
do_promote() {
  step "提升备集群为 Primary"

  local images
  images=$(get_pool_images "secondary")

  if [[ -z "$images" ]]; then
    warn "备集群池 ${DR_POOL_NAME} 中无 image"
    return
  fi

  local success=0 failed=0
  while IFS= read -r image; do
    [[ -z "$image" ]] && continue
    log "提升: ${DR_POOL_NAME}/${image}..."
    if run_on_secondary "rbd mirror image promote --force ${DR_POOL_NAME}/${image}" 2>/dev/null; then
      success=$((success + 1))
    else
      warn "提升 ${image} 失败"
      failed=$((failed + 1))
    fi
  done <<< "$images"

  log "提升完成: 成功 ${success}, 失败 ${failed}"
}

# ==================== 降级主集群 ====================
do_demote() {
  step "降级主集群为 Secondary"

  local images
  images=$(get_pool_images "primary")

  if [[ -z "$images" ]]; then
    warn "主集群池 ${DR_POOL_NAME} 中无 image"
    return
  fi

  local success=0 failed=0
  while IFS= read -r image; do
    [[ -z "$image" ]] && continue
    log "降级: ${DR_POOL_NAME}/${image}..."
    if run_on "${DR_PRIMARY_NODE}" "rbd mirror image demote ${DR_POOL_NAME}/${image}" 2>/dev/null; then
      success=$((success + 1))
    else
      warn "降级 ${image} 失败"
      failed=$((failed + 1))
    fi
  done <<< "$images"

  log "降级完成: 成功 ${success}, 失败 ${failed}"
}

# ==================== 重新同步 ====================
do_resync() {
  step "重新同步 (Resync)"

  log "触发备集群重新同步..."
  local images
  images=$(get_pool_images "secondary")

  while IFS= read -r image; do
    [[ -z "$image" ]] && continue
    log "  重新同步: ${image}..."
    run_on_secondary "rbd mirror image resync ${DR_POOL_NAME}/${image}" 2>/dev/null || \
      warn "  重新同步 ${image} 失败"
  done <<< "$images"

  log "重新同步已触发，请通过 disaster-recovery-status.sh 监控进度"
}

# ==================== 状态查看 ====================
do_status() {
  step "灾备状态"

  # 主集群状态
  log "--- 主集群 ---"
  if run_on "${DR_PRIMARY_NODE}" "ceph health --connect-timeout 5" >/dev/null 2>&1; then
    run_on "${DR_PRIMARY_NODE}" "rbd mirror pool status ${DR_POOL_NAME}" 2>/dev/null || \
      warn "主集群镜像状态不可用"
  else
    warn "主集群不可达"
  fi

  echo ""

  # 备集群状态
  log "--- 备集群 ---"
  if run_on_secondary "ceph health --connect-timeout 5" >/dev/null 2>&1; then
    run_on_secondary "rbd mirror pool status ${DR_POOL_NAME}" 2>/dev/null || \
      warn "备集群镜像状态不可用"
  else
    warn "备集群不可达"
  fi
}

# ==================== 主入口 ====================
usage() {
  echo "用法: $0 <操作>"
  echo ""
  echo "操作:"
  echo "  failover    故障切换（主→备）"
  echo "  failback    故障回切（备→主）"
  echo "  promote     将备集群提升为主"
  echo "  demote      将主集群降级为备"
  echo "  resync      重新同步"
  echo "  status      查看灾备状态"
  exit 1
}

main() {
  local action="${1:-}"
  [[ -z "$action" ]] && usage

  case "$action" in
    failover) do_failover ;;
    failback) do_failback ;;
    promote)  do_promote ;;
    demote)   do_demote ;;
    resync)   do_resync ;;
    status)   do_status ;;
    *) usage ;;
  esac
}

main "$@"
