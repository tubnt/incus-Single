#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# disaster-recovery-status.sh — 灾备状态监控脚本
# 功能：检查镜像同步延迟、健康状态、RPO 估算
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../configs/cluster-env.sh"

# ---------- 默认参数 ----------
DR_POOL="${DR_POOL:-incus-pool}"
DR_WARN_DELAY_SEC="${DR_WARN_DELAY_SEC:-60}"
DR_CRIT_DELAY_SEC="${DR_CRIT_DELAY_SEC:-300}"

# ---------- 日志工具 ----------
log_info()  { echo "[INFO]  $(date '+%Y-%m-%d %H:%M:%S') $*"; }
log_warn()  { echo "[WARN]  $(date '+%Y-%m-%d %H:%M:%S') $*" >&2; }
log_error() { echo "[ERROR] $(date '+%Y-%m-%d %H:%M:%S') $*" >&2; }

# ---------- 颜色输出 ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

color_status() {
    local status="$1"
    case "${status}" in
        OK|ok|healthy)           echo -e "${GREEN}${status}${NC}" ;;
        WARNING|warning)         echo -e "${YELLOW}${status}${NC}" ;;
        CRITICAL|critical|error) echo -e "${RED}${status}${NC}" ;;
        *)                       echo "${status}" ;;
    esac
}

# ---------- 获取 pool 镜像摘要 ----------
get_pool_mirror_summary() {
    log_info "========== Pool 镜像摘要 =========="
    echo ""

    local pool_status
    pool_status=$(rbd mirror pool status "${DR_POOL}" --format=json 2>/dev/null)

    if [[ -z "${pool_status}" ]]; then
        log_error "无法获取 pool '${DR_POOL}' 的镜像状态"
        return 1
    fi

    # 解析摘要信息
    echo "${pool_status}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
summary = data.get('summary', {})
states = summary.get('states', {})
health = summary.get('health', 'UNKNOWN')
images = data.get('images', [])

print(f'  Pool:       ${DR_POOL}')
print(f'  健康状态:   {health}')
print(f'  守护进程:   {summary.get(\"daemon_health\", \"UNKNOWN\")}')
print(f'  镜像健康:   {summary.get(\"image_health\", \"UNKNOWN\")}')
print()
print('  镜像状态分布:')
for state, count in states.items():
    print(f'    {state}: {count}')
print(f'\n  镜像总数:   {len(images)}')
"

    echo ""
}

# ---------- 逐镜像同步状态 ----------
get_image_sync_status() {
    log_info "========== 镜像同步详情 =========="
    echo ""

    local images
    images=$(rbd ls "${DR_POOL}" 2>/dev/null || true)

    if [[ -z "${images}" ]]; then
        log_warn "Pool '${DR_POOL}' 中无镜像"
        return
    fi

    printf "  %-30s %-12s %-15s %-10s\n" "镜像名称" "状态" "同步延迟" "级别"
    printf "  %-30s %-12s %-15s %-10s\n" "-----" "----" "------" "----"

    local total=0 healthy=0 warning=0 critical=0

    while IFS= read -r img; do
        (( total++ ))

        local mirror_status
        mirror_status=$(rbd mirror image status "${DR_POOL}/${img}" --format=json 2>/dev/null || echo "{}")

        local state description delay_sec level
        state=$(echo "${mirror_status}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('state','unknown'))" 2>/dev/null || echo "unknown")
        description=$(echo "${mirror_status}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('description',''))" 2>/dev/null || echo "")

        # 解析同步延迟（从 description 提取）
        delay_sec=0
        if echo "${description}" | grep -qoP 'replaying.*?(\d+)s' 2>/dev/null; then
            delay_sec=$(echo "${description}" | grep -oP '(\d+)s' | grep -oP '\d+' | head -1)
        fi

        # 判断告警级别
        if [[ "${state}" == "up+replaying" || "${state}" == "up+stopped" ]]; then
            if (( delay_sec >= DR_CRIT_DELAY_SEC )); then
                level="CRITICAL"
                (( critical++ ))
            elif (( delay_sec >= DR_WARN_DELAY_SEC )); then
                level="WARNING"
                (( warning++ ))
            else
                level="OK"
                (( healthy++ ))
            fi
        elif [[ "${state}" == "up+syncing" ]]; then
            level="WARNING"
            (( warning++ ))
        else
            level="CRITICAL"
            (( critical++ ))
        fi

        printf "  %-30s %-12s %-15s " "${img}" "${state}" "${delay_sec}s"
        color_status "${level}"
    done <<< "${images}"

    echo ""
    echo "  汇总: 总计 ${total} | 健康 ${healthy} | 警告 ${warning} | 严重 ${critical}"
    echo ""
}

# ---------- RPO 估算 ----------
estimate_rpo() {
    log_info "========== RPO (恢复点目标) 估算 =========="
    echo ""

    local pool_status
    pool_status=$(rbd mirror pool status "${DR_POOL}" --format=json 2>/dev/null)

    if [[ -z "${pool_status}" ]]; then
        log_error "无法获取镜像状态，RPO 无法估算"
        return 1
    fi

    echo "${pool_status}" | python3 -c "
import json, sys, re

data = json.load(sys.stdin)
images = data.get('images', [])
if not images:
    print('  无镜像数据，RPO 无法估算')
    sys.exit(0)

max_delay = 0
total_delay = 0
count = 0

for img in images:
    desc = img.get('description', '')
    match = re.search(r'(\d+)s', desc)
    if match:
        delay = int(match.group(1))
        max_delay = max(max_delay, delay)
        total_delay += delay
        count += 1

avg_delay = total_delay / count if count > 0 else 0

print(f'  监控镜像数:     {len(images)}')
print(f'  有延迟数据的:   {count}')
print(f'  最大同步延迟:   {max_delay}s')
print(f'  平均同步延迟:   {avg_delay:.1f}s')
print()
print(f'  估算 RPO:       {max_delay}s ({max_delay/60:.1f} 分钟)')
print()
if max_delay < 60:
    print('  RPO 评级: 优秀 (< 1 分钟)')
elif max_delay < 300:
    print('  RPO 评级: 良好 (< 5 分钟)')
elif max_delay < 900:
    print('  RPO 评级: 一般 (< 15 分钟)')
else:
    print('  RPO 评级: 需要关注 (>= 15 分钟)')
"
    echo ""
}

# ---------- Peer 连接状态 ----------
check_peer_status() {
    log_info "========== Peer 连接状态 =========="
    echo ""

    local peers
    peers=$(rbd mirror pool peer list "${DR_POOL}" --format=json 2>/dev/null || echo "[]")

    echo "${peers}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
if not data:
    print('  未配置镜像 Peer')
else:
    for peer in data:
        print(f'  UUID:        {peer.get(\"uuid\", \"-\")}')
        print(f'  集群名:     {peer.get(\"cluster_name\", \"-\")}')
        print(f'  客户端:     {peer.get(\"client_name\", \"-\")}')
        print(f'  站点名:     {peer.get(\"site_name\", \"-\")}')
        print(f'  方向:       {peer.get(\"direction\", \"-\")}')
        print()
"
}

# ---------- 使用说明 ----------
usage() {
    cat <<EOF
用法: $(basename "$0") [命令]

命令:
  all          显示全部状态（默认）
  summary      Pool 镜像摘要
  images       逐镜像同步状态
  rpo          RPO 估算
  peers        Peer 连接状态

环境变量:
  DR_POOL              目标 pool (默认: incus-pool)
  DR_WARN_DELAY_SEC    警告阈值 (秒，默认: 60)
  DR_CRIT_DELAY_SEC    严重阈值 (秒，默认: 300)

示例:
  $(basename "$0")              # 全部状态
  $(basename "$0") rpo          # 仅 RPO 估算
  DR_POOL=vm-pool $(basename "$0") images
EOF
}

# ---------- 主入口 ----------
main() {
    local cmd="${1:-all}"

    case "${cmd}" in
        all)
            get_pool_mirror_summary
            get_image_sync_status
            estimate_rpo
            check_peer_status
            ;;
        summary)
            get_pool_mirror_summary
            ;;
        images)
            get_image_sync_status
            ;;
        rpo)
            estimate_rpo
            ;;
        peers)
            check_peer_status
            ;;
        -h|--help|help)
            usage
            ;;
        *)
            usage
            exit 1
            ;;
    esac
}

main "$@"
