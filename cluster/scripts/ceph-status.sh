#!/usr/bin/env bash
# ============================================================
# Ceph 集群状态面板
# 用途：一键查看集群健康、OSD 状态、存储用量、PG 状态
# 支持：--json 输出 | --watch N 秒刷新
# ============================================================
set -euo pipefail

# ==================== 颜色定义 ====================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ==================== 默认配置 ====================
JSON_MODE=false
WATCH_MODE=false
WATCH_INTERVAL=5
WARN_THRESHOLD=75
CRIT_THRESHOLD=85

# ==================== 帮助信息 ====================
usage() {
    cat << EOF
${CYAN}用法:${NC}
  $0 [选项]

${CYAN}选项:${NC}
  --json           JSON 格式输出（供监控系统解析）
  --watch [N]      每 N 秒刷新（默认 5 秒）
  --warn PCT       容量警告水位线（默认 75%）
  --crit PCT       容量严重水位线（默认 85%）
  -h, --help       显示帮助

${CYAN}示例:${NC}
  $0                       # 交互式面板
  $0 --json                # JSON 输出
  $0 --watch 10            # 每 10 秒刷新
  $0 --warn 70 --crit 80   # 自定义水位线

EOF
    exit 0
}

# ==================== 参数解析 ====================
while [[ $# -gt 0 ]]; do
    case "$1" in
        --json)
            JSON_MODE=true
            shift
            ;;
        --watch)
            WATCH_MODE=true
            if [[ "${2:-}" =~ ^[0-9]+$ ]]; then
                WATCH_INTERVAL="$2"
                shift
            fi
            shift
            ;;
        --warn)
            [[ "${2:-}" =~ ^[0-9]+$ ]] || { echo "错误: --warn 需要整数参数"; exit 1; }
            WARN_THRESHOLD="$2"
            shift 2
            ;;
        --crit)
            [[ "${2:-}" =~ ^[0-9]+$ ]] || { echo "错误: --crit 需要整数参数"; exit 1; }
            CRIT_THRESHOLD="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "未知选项: $1"
            usage
            ;;
    esac
done

# ==================== 前置检查 ====================
command -v ceph >/dev/null 2>&1 || { echo "错误: ceph 命令未找到"; exit 1; }

# ==================== 数据采集 ====================
collect_data() {
    HEALTH_JSON=$(ceph health detail --format=json 2>/dev/null || echo '{"status":"UNKNOWN"}')
    STATUS_JSON=$(ceph status --format=json 2>/dev/null || echo '{}')
    OSD_TREE_JSON=$(ceph osd tree --format=json 2>/dev/null || echo '{"nodes":[]}')
    DF_JSON=$(ceph df --format=json 2>/dev/null || echo '{}')
    OSD_DF_JSON=$(ceph osd df --format=json 2>/dev/null || echo '{"nodes":[]}')
}

# ==================== 容量水位检查 ====================
check_capacity_level() {
    local pct="$1"
    if (( pct >= CRIT_THRESHOLD )); then
        echo "CRITICAL"
    elif (( pct >= WARN_THRESHOLD )); then
        echo "WARNING"
    else
        echo "OK"
    fi
}

# ==================== JSON 输出 ====================
output_json() {
    collect_data

    local health_status
    health_status=$(echo "$HEALTH_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('status', 'UNKNOWN'))
" 2>/dev/null || echo "UNKNOWN")

    local total_bytes used_bytes avail_bytes used_pct
    total_bytes=$(echo "$DF_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
stats = data.get('stats', {})
print(stats.get('total_bytes', 0))
" 2>/dev/null || echo 0)
    used_bytes=$(echo "$DF_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
stats = data.get('stats', {})
print(stats.get('total_used_raw_bytes', 0))
" 2>/dev/null || echo 0)
    avail_bytes=$(echo "$DF_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
stats = data.get('stats', {})
print(stats.get('total_avail_bytes', 0))
" 2>/dev/null || echo 0)

    if [[ "$total_bytes" -gt 0 ]]; then
        used_pct=$((used_bytes * 100 / total_bytes))
    else
        used_pct=0
    fi

    local capacity_level
    capacity_level=$(check_capacity_level "$used_pct")

    local osd_total osd_up osd_in
    osd_total=$(echo "$STATUS_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
osdmap = data.get('osdmap', data.get('osd_map', {}))
print(osdmap.get('num_osds', 0))
" 2>/dev/null || echo 0)
    osd_up=$(echo "$STATUS_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
osdmap = data.get('osdmap', data.get('osd_map', {}))
print(osdmap.get('num_up_osds', 0))
" 2>/dev/null || echo 0)
    osd_in=$(echo "$STATUS_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
osdmap = data.get('osdmap', data.get('osd_map', {}))
print(osdmap.get('num_in_osds', 0))
" 2>/dev/null || echo 0)

    local pg_total
    pg_total=$(echo "$STATUS_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
pgmap = data.get('pgmap', {})
print(pgmap.get('num_pgs', 0))
" 2>/dev/null || echo 0)

    local pg_states
    pg_states=$(echo "$STATUS_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
pgmap = data.get('pgmap', {})
states = pgmap.get('pgs_by_state', [])
result = {s['state_name']: s['count'] for s in states}
print(json.dumps(result))
" 2>/dev/null || echo '{}')

    _TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    _HS="$health_status" _CL="$capacity_level" \
    _TB="$total_bytes" _UB="$used_bytes" _AB="$avail_bytes" _UP="$used_pct" \
    _WT="$WARN_THRESHOLD" _CT="$CRIT_THRESHOLD" \
    _OT="$osd_total" _OU="$osd_up" _OI="$osd_in" \
    _PT="$pg_total" _PS="$pg_states" \
    python3 -c "
import json, os
result = {
    'timestamp': os.environ['_TS'],
    'health': {
        'status': os.environ['_HS'],
        'capacity_level': os.environ['_CL'],
    },
    'capacity': {
        'total_bytes': int(os.environ['_TB']),
        'used_bytes': int(os.environ['_UB']),
        'avail_bytes': int(os.environ['_AB']),
        'used_percent': int(os.environ['_UP']),
        'warn_threshold': int(os.environ['_WT']),
        'crit_threshold': int(os.environ['_CT']),
    },
    'osd': {
        'total': int(os.environ['_OT']),
        'up': int(os.environ['_OU']),
        'in': int(os.environ['_OI']),
    },
    'pg': {
        'total': int(os.environ['_PT']),
        'by_state': json.loads(os.environ['_PS']),
    },
}
print(json.dumps(result, indent=2, ensure_ascii=False))
"
}

# ==================== 人类可读输出 ====================
human_readable_size() {
    local bytes=$1
    if [[ $bytes -ge 1099511627776 ]]; then
        echo "$(awk "BEGIN{printf \"%.1f\", $bytes/1099511627776}") TB"
    elif [[ $bytes -ge 1073741824 ]]; then
        echo "$(awk "BEGIN{printf \"%.1f\", $bytes/1073741824}") GB"
    elif [[ $bytes -ge 1048576 ]]; then
        echo "$(awk "BEGIN{printf \"%.1f\", $bytes/1048576}") MB"
    else
        echo "${bytes} B"
    fi
}

output_human() {
    collect_data

    local health_status
    health_status=$(echo "$HEALTH_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('status', 'UNKNOWN'))
" 2>/dev/null || echo "UNKNOWN")

    # 标题
    echo -e "\n${BOLD}═══════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}              Ceph 集群状态面板${NC}"
    echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
    echo -e "  时间: $(date '+%Y-%m-%d %H:%M:%S')"

    # 健康状态
    echo -e "\n${BOLD}── 集群健康 ──${NC}"
    case "$health_status" in
        HEALTH_OK)    echo -e "  状态: ${GREEN}● HEALTH_OK${NC}" ;;
        HEALTH_WARN)  echo -e "  状态: ${YELLOW}▲ HEALTH_WARN${NC}" ;;
        HEALTH_ERR)   echo -e "  状态: ${RED}✖ HEALTH_ERR${NC}" ;;
        *)            echo -e "  状态: ${RED}? UNKNOWN${NC}" ;;
    esac

    # 健康详情
    local checks
    checks=$(echo "$HEALTH_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
checks = data.get('checks', {})
for name, info in checks.items():
    severity = info.get('severity', 'UNKNOWN')
    summary = info.get('summary', {}).get('message', '')
    print(f'  {severity}: {name} — {summary}')
" 2>/dev/null || true)
    if [[ -n "$checks" ]]; then
        echo "$checks"
    fi

    # 存储用量
    echo -e "\n${BOLD}── 存储用量 ──${NC}"
    local total_bytes used_bytes avail_bytes used_pct
    total_bytes=$(echo "$DF_JSON" | python3 -c "
import sys, json; data = json.load(sys.stdin)
print(data.get('stats', {}).get('total_bytes', 0))" 2>/dev/null || echo 0)
    used_bytes=$(echo "$DF_JSON" | python3 -c "
import sys, json; data = json.load(sys.stdin)
print(data.get('stats', {}).get('total_used_raw_bytes', 0))" 2>/dev/null || echo 0)
    avail_bytes=$(echo "$DF_JSON" | python3 -c "
import sys, json; data = json.load(sys.stdin)
print(data.get('stats', {}).get('total_avail_bytes', 0))" 2>/dev/null || echo 0)

    if [[ "$total_bytes" -gt 0 ]]; then
        used_pct=$((used_bytes * 100 / total_bytes))
    else
        used_pct=0
    fi

    local cap_level
    cap_level=$(check_capacity_level "$used_pct")
    local pct_color="$GREEN"
    [[ "$cap_level" == "WARNING" ]] && pct_color="$YELLOW"
    [[ "$cap_level" == "CRITICAL" ]] && pct_color="$RED"

    echo -e "  总容量:   $(human_readable_size "$total_bytes")"
    echo -e "  已使用:   $(human_readable_size "$used_bytes") (${pct_color}${used_pct}%${NC})"
    echo -e "  可用:     $(human_readable_size "$avail_bytes")"

    if [[ "$cap_level" == "WARNING" ]]; then
        echo -e "  ${YELLOW}⚠ 警告: 容量已超过 ${WARN_THRESHOLD}% 水位线${NC}"
    elif [[ "$cap_level" == "CRITICAL" ]]; then
        echo -e "  ${RED}✖ 严重: 容量已超过 ${CRIT_THRESHOLD}% 水位线，请立即扩容！${NC}"
    fi

    # 存储池详情
    local pools
    pools=$(echo "$DF_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for pool in data.get('pools', []):
    name = pool.get('name', '?')
    stats = pool.get('stats', {})
    stored = stats.get('stored', 0)
    pct = stats.get('percent_used', 0) * 100
    objects = stats.get('objects', 0)
    # 人类可读
    if stored >= 1099511627776:
        stored_h = f'{stored/1099511627776:.1f} TB'
    elif stored >= 1073741824:
        stored_h = f'{stored/1073741824:.1f} GB'
    elif stored >= 1048576:
        stored_h = f'{stored/1048576:.1f} MB'
    else:
        stored_h = f'{stored} B'
    print(f'  {name:<20s} {stored_h:>10s}  {pct:5.1f}%  {objects:>8d} 对象')
" 2>/dev/null || true)
    if [[ -n "$pools" ]]; then
        echo -e "\n  ${CYAN}存储池              数据量    使用率     对象数${NC}"
        echo "$pools"
    fi

    # OSD 状态
    echo -e "\n${BOLD}── OSD 状态 ──${NC}"
    local osd_total osd_up osd_in
    osd_total=$(echo "$STATUS_JSON" | python3 -c "
import sys, json; data = json.load(sys.stdin)
osdmap = data.get('osdmap', data.get('osd_map', {}))
print(osdmap.get('num_osds', 0))" 2>/dev/null || echo 0)
    osd_up=$(echo "$STATUS_JSON" | python3 -c "
import sys, json; data = json.load(sys.stdin)
osdmap = data.get('osdmap', data.get('osd_map', {}))
print(osdmap.get('num_up_osds', 0))" 2>/dev/null || echo 0)
    osd_in=$(echo "$STATUS_JSON" | python3 -c "
import sys, json; data = json.load(sys.stdin)
osdmap = data.get('osdmap', data.get('osd_map', {}))
print(osdmap.get('num_in_osds', 0))" 2>/dev/null || echo 0)

    local osd_color="$GREEN"
    [[ "$osd_up" -lt "$osd_total" ]] && osd_color="$YELLOW"

    echo -e "  总数: ${osd_total}  运行: ${osd_color}${osd_up}${NC}  参与: ${osd_in}"

    # 每个 OSD 详情
    local osd_details
    osd_details=$(echo "$OSD_DF_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
nodes = data.get('nodes', [])
for osd in sorted(nodes, key=lambda x: x.get('id', 0)):
    oid = osd.get('id', '?')
    name = osd.get('name', f'osd.{oid}')
    status = osd.get('status', 'unknown')
    utilization = osd.get('utilization', 0)
    kb_total = osd.get('kb', 0) * 1024
    # 人类可读
    if kb_total >= 1099511627776:
        total_h = f'{kb_total/1099511627776:.1f}T'
    elif kb_total >= 1073741824:
        total_h = f'{kb_total/1073741824:.0f}G'
    else:
        total_h = f'{kb_total/1048576:.0f}M'
    status_sym = '●' if status == 'up' else '○'
    print(f'  {status_sym} {name:<8s} {total_h:>6s}  {utilization:5.1f}%')
" 2>/dev/null || true)
    if [[ -n "$osd_details" ]]; then
        echo "$osd_details"
    fi

    # PG 状态
    echo -e "\n${BOLD}── PG 状态 ──${NC}"
    local pg_total
    pg_total=$(echo "$STATUS_JSON" | python3 -c "
import sys, json; data = json.load(sys.stdin)
print(data.get('pgmap', {}).get('num_pgs', 0))" 2>/dev/null || echo 0)
    echo -e "  PG 总数: ${pg_total}"

    local pg_states
    pg_states=$(echo "$STATUS_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
states = data.get('pgmap', {}).get('pgs_by_state', [])
for s in sorted(states, key=lambda x: -x.get('count', 0)):
    name = s.get('state_name', '?')
    count = s.get('count', 0)
    if 'active+clean' == name:
        sym = '●'
    elif 'degraded' in name or 'down' in name:
        sym = '✖'
    elif 'recovering' in name or 'backfill' in name or 'peering' in name:
        sym = '▲'
    else:
        sym = '○'
    print(f'  {sym} {name:<35s} {count:>6d}')
" 2>/dev/null || true)
    if [[ -n "$pg_states" ]]; then
        echo "$pg_states"
    fi

    echo -e "\n${BOLD}═══════════════════════════════════════════════════${NC}"
}

# ==================== 主逻辑 ====================
if $JSON_MODE; then
    if $WATCH_MODE; then
        while true; do
            output_json
            sleep "$WATCH_INTERVAL"
        done
    else
        output_json
    fi
else
    if $WATCH_MODE; then
        while true; do
            clear
            output_human
            echo -e "\n  ${CYAN}每 ${WATCH_INTERVAL} 秒刷新 | Ctrl+C 退出${NC}"
            sleep "$WATCH_INTERVAL"
        done
    else
        output_human
    fi
fi
