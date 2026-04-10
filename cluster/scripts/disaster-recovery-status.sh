#!/bin/bash
# ============================================================
# 灾备状态监控脚本
# 用途: 检查 RBD mirroring 同步状态、延迟、健康度
#
# 用法:
#   disaster-recovery-status.sh [选项]
#
# 选项:
#   --summary       简要状态（默认）
#   --detail        详细状态（含每个 image）
#   --json          JSON 格式输出
#   --watch         持续监控（每 30 秒刷新）
#   --check         健康检查模式（返回退出码: 0=正常, 1=降级, 2=故障）
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../configs/cluster-env.sh"

# ==================== 日志 ====================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERR]${NC} $*" >&2; }
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
  ssh -o StrictHostKeyChecking=no "${SSH_USER}@${ip}" "$@" 2>/dev/null
}

run_on_secondary() {
  [[ -z "$DR_SECONDARY_HOST" ]] && return 1
  ssh -o StrictHostKeyChecking=no "${DR_SECONDARY_USER}@${DR_SECONDARY_HOST}" "$@" 2>/dev/null
}

# ==================== 简要状态 ====================
do_summary() {
  step "灾备状态概览"

  local ts
  ts=$(date '+%Y-%m-%d %H:%M:%S')
  echo -e "${CYAN}检查时间: ${ts}${NC}"
  echo ""

  # 主集群
  echo -e "${BLUE}[主集群]${NC}"
  local primary_ok=false
  if run_on "${DR_PRIMARY_NODE}" "ceph health --connect-timeout 5" >/dev/null 2>&1; then
    local health
    health=$(run_on "${DR_PRIMARY_NODE}" "ceph health")
    echo -e "  集群健康: ${health}"
    primary_ok=true

    local mirror_status
    mirror_status=$(run_on "${DR_PRIMARY_NODE}" "rbd mirror pool status ${DR_POOL_NAME} --format json" 2>/dev/null) || mirror_status="{}"

    local pool_health images_total images_ok images_warn images_err
    pool_health=$(echo "$mirror_status" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    s = d.get('summary', {})
    print(s.get('health', 'UNKNOWN'))
except: print('UNKNOWN')
" 2>/dev/null) || pool_health="UNKNOWN"

    images_total=$(echo "$mirror_status" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    s = d.get('summary', {}).get('states', {})
    print(sum(s.values()))
except: print(0)
" 2>/dev/null) || images_total=0

    case "$pool_health" in
      OK)      echo -e "  镜像健康: ${GREEN}${pool_health}${NC}" ;;
      WARNING) echo -e "  镜像健康: ${YELLOW}${pool_health}${NC}" ;;
      *)       echo -e "  镜像健康: ${RED}${pool_health}${NC}" ;;
    esac
    echo "  镜像 Image 数: ${images_total}"
  else
    echo -e "  状态: ${RED}不可达${NC}"
  fi

  echo ""

  # 备集群
  echo -e "${BLUE}[备集群]${NC}"
  local secondary_ok=false
  if [[ -n "$DR_SECONDARY_HOST" ]] && run_on_secondary "ceph health --connect-timeout 5" >/dev/null 2>&1; then
    local health
    health=$(run_on_secondary "ceph health")
    echo -e "  集群健康: ${health}"
    secondary_ok=true

    local mirror_status
    mirror_status=$(run_on_secondary "rbd mirror pool status ${DR_POOL_NAME} --format json" 2>/dev/null) || mirror_status="{}"

    local daemon_status
    daemon_status=$(echo "$mirror_status" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    daemons = d.get('daemons', [])
    if daemons:
        print(f\"运行中 ({len(daemons)} 个守护进程)\")
    else:
        print('无守护进程')
except: print('UNKNOWN')
" 2>/dev/null) || daemon_status="UNKNOWN"
    echo "  rbd-mirror: ${daemon_status}"

    local pool_health
    pool_health=$(echo "$mirror_status" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('summary', {}).get('health', 'UNKNOWN'))
except: print('UNKNOWN')
" 2>/dev/null) || pool_health="UNKNOWN"

    case "$pool_health" in
      OK)      echo -e "  镜像健康: ${GREEN}${pool_health}${NC}" ;;
      WARNING) echo -e "  镜像健康: ${YELLOW}${pool_health}${NC}" ;;
      *)       echo -e "  镜像健康: ${RED}${pool_health}${NC}" ;;
    esac
  else
    if [[ -z "$DR_SECONDARY_HOST" ]]; then
      echo -e "  状态: ${YELLOW}未配置${NC}"
    else
      echo -e "  状态: ${RED}不可达${NC}"
    fi
  fi

  echo ""

  # 综合判定
  if $primary_ok && $secondary_ok; then
    echo -e "${GREEN}综合状态: 灾备正常${NC}"
  elif $primary_ok && ! $secondary_ok; then
    echo -e "${YELLOW}综合状态: 备集群异常，灾备降级${NC}"
  elif ! $primary_ok && $secondary_ok; then
    echo -e "${RED}综合状态: 主集群故障，需要故障切换${NC}"
  else
    echo -e "${RED}综合状态: 双集群故障${NC}"
  fi
}

# ==================== 详细状态 ====================
do_detail() {
  do_summary

  step "Image 级同步详情"

  local images
  images=$(run_on "${DR_PRIMARY_NODE}" "rbd ls ${DR_POOL_NAME}" 2>/dev/null) || \
    images=$(run_on_secondary "rbd ls ${DR_POOL_NAME}" 2>/dev/null) || \
    images=""

  if [[ -z "$images" ]]; then
    warn "无法获取 image 列表"
    return
  fi

  printf "%-30s %-12s %-12s %-20s\n" "IMAGE" "主集群角色" "备集群角色" "同步状态"
  printf "%-30s %-12s %-12s %-20s\n" "-----" "--------" "--------" "--------"

  while IFS= read -r image; do
    [[ -z "$image" ]] && continue

    local primary_role="N/A" secondary_role="N/A" sync_state="N/A"

    # 主集群 image 状态
    if run_on "${DR_PRIMARY_NODE}" "ceph health --connect-timeout 3" >/dev/null 2>&1; then
      primary_role=$(run_on "${DR_PRIMARY_NODE}" "
        rbd mirror image status ${DR_POOL_NAME}/${image} --format json 2>/dev/null | \
        python3 -c \"import sys,json; print(json.load(sys.stdin).get('state','unknown'))\" 2>/dev/null
      ") || primary_role="N/A"
    fi

    # 备集群 image 状态
    if [[ -n "$DR_SECONDARY_HOST" ]] && run_on_secondary "ceph health --connect-timeout 3" >/dev/null 2>&1; then
      local sec_info
      sec_info=$(run_on_secondary "
        rbd mirror image status ${DR_POOL_NAME}/${image} --format json 2>/dev/null
      ") || sec_info="{}"

      secondary_role=$(echo "$sec_info" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('state', 'unknown'))
except: print('N/A')
" 2>/dev/null) || secondary_role="N/A"

      sync_state=$(echo "$sec_info" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    desc = d.get('description', '')
    if 'replaying' in desc:
        print('同步中')
    elif 'stopped' in desc:
        print('已停止')
    else:
        print(desc[:20] if desc else 'N/A')
except: print('N/A')
" 2>/dev/null) || sync_state="N/A"
    fi

    printf "%-30s %-12s %-12s %-20s\n" "$image" "$primary_role" "$secondary_role" "$sync_state"
  done <<< "$images"
}

# ==================== JSON 格式输出 ====================
do_json() {
  local result="{}"

  # 主集群
  local primary_health="unreachable" primary_mirror="{}"
  if run_on "${DR_PRIMARY_NODE}" "ceph health --connect-timeout 5" >/dev/null 2>&1; then
    primary_health=$(run_on "${DR_PRIMARY_NODE}" "ceph health")
    primary_mirror=$(run_on "${DR_PRIMARY_NODE}" "rbd mirror pool status ${DR_POOL_NAME} --format json" 2>/dev/null) || primary_mirror="{}"
  fi

  # 备集群
  local secondary_health="unreachable" secondary_mirror="{}"
  if [[ -n "$DR_SECONDARY_HOST" ]] && run_on_secondary "ceph health --connect-timeout 5" >/dev/null 2>&1; then
    secondary_health=$(run_on_secondary "ceph health")
    secondary_mirror=$(run_on_secondary "rbd mirror pool status ${DR_POOL_NAME} --format json" 2>/dev/null) || secondary_mirror="{}"
  fi

  python3 -c "
import json, sys
result = {
    'timestamp': '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
    'pool': '${DR_POOL_NAME}',
    'primary': {
        'health': '${primary_health}',
        'mirror': ${primary_mirror}
    },
    'secondary': {
        'health': '${secondary_health}',
        'mirror': ${secondary_mirror}
    }
}
print(json.dumps(result, indent=2))
"
}

# ==================== 健康检查模式 ====================
do_check() {
  local exit_code=0

  # 检查主集群
  if ! run_on "${DR_PRIMARY_NODE}" "ceph health --connect-timeout 5" >/dev/null 2>&1; then
    err "主集群不可达"
    exit_code=2
  fi

  # 检查备集群
  if [[ -z "$DR_SECONDARY_HOST" ]]; then
    err "备集群未配置"
    exit_code=1
  elif ! run_on_secondary "ceph health --connect-timeout 5" >/dev/null 2>&1; then
    err "备集群不可达"
    [[ $exit_code -lt 2 ]] && exit_code=1
  fi

  # 检查镜像健康
  if [[ $exit_code -eq 0 ]]; then
    local mirror_health
    mirror_health=$(run_on_secondary "
      rbd mirror pool status ${DR_POOL_NAME} --format json 2>/dev/null | \
      python3 -c \"import sys,json; print(json.load(sys.stdin).get('summary',{}).get('health','UNKNOWN'))\" 2>/dev/null
    ") || mirror_health="UNKNOWN"

    case "$mirror_health" in
      OK)
        log "灾备状态正常"
        exit_code=0
        ;;
      WARNING)
        warn "灾备降级"
        exit_code=1
        ;;
      *)
        err "灾备异常: ${mirror_health}"
        exit_code=2
        ;;
    esac
  fi

  exit $exit_code
}

# ==================== 持续监控 ====================
do_watch() {
  local interval="${1:-30}"
  log "持续监控模式，每 ${interval} 秒刷新 (Ctrl+C 退出)"

  while true; do
    clear
    do_summary
    sleep "$interval"
  done
}

# ==================== 主入口 ====================
usage() {
  echo "用法: $0 [选项]"
  echo ""
  echo "选项:"
  echo "  --summary    简要状态（默认）"
  echo "  --detail     详细状态"
  echo "  --json       JSON 格式输出"
  echo "  --watch [N]  持续监控（每 N 秒，默认 30）"
  echo "  --check      健康检查（退出码: 0=正常, 1=降级, 2=故障）"
  exit 1
}

main() {
  local action="${1:---summary}"

  case "$action" in
    --summary)  do_summary ;;
    --detail)   do_detail ;;
    --json)     do_json ;;
    --watch)    do_watch "${2:-30}" ;;
    --check)    do_check ;;
    -h|--help)  usage ;;
    *)          usage ;;
  esac
}

main "$@"
