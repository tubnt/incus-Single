#!/usr/bin/env bash
# =============================================================================
# Incus 集群 Auto-Healing 配置和验证脚本
#
# 功能:
#   - 设置 cluster.offline_threshold 和 cluster.healing_threshold
#   - 验证 healing 前提条件（Ceph 存储、无本地绑定、voter 数量）
#   - --dry-run 模式：检查哪些 VM 可被 heal，列出不符合条件的
#
# 原理:
#   auto-healing = 源节点已挂，Incus 自动将 VM 冷启动到其他节点
#   前提: VM 的根磁盘和所有数据盘都在 Ceph 共享存储上
#   停机时间: ~5 分钟（offline_threshold + healing_threshold + 启动时间）
#
# 用法:
#   setup-healing.sh --apply     应用 healing 配置
#   setup-healing.sh --dry-run   仅检查，不修改
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

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_step()  { echo -e "\n${BLUE}====== $* ======${NC}"; }

# ==================== 参数 ====================
MODE=""
FORCE=false

usage() {
  cat <<EOF
用法: $(basename "$0") <模式> [选项]

Incus 集群 auto-healing 配置和验证。

模式:
  --apply     应用 healing 阈值参数
  --dry-run   仅检查 VM 是否满足 healing 前提条件（不修改配置）
  --help      显示帮助

选项:
  --force     前提检查失败时仍强制应用（需明确确认风险）

参数说明:
  cluster.offline_threshold = ${CLUSTER_OFFLINE_THRESHOLD}s  节点离线判定
  cluster.healing_threshold = ${CLUSTER_HEALING_THRESHOLD}s  触发自动恢复

预计停机时间: ~$((CLUSTER_OFFLINE_THRESHOLD + CLUSTER_HEALING_THRESHOLD + 30))s
  (offline_threshold + healing_threshold + VM 启动时间)
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)   MODE="apply";   shift ;;
    --dry-run) MODE="dry-run"; shift ;;
    --force)   FORCE=true;     shift ;;
    --help|-h) usage ;;
    *)         log_error "未知参数: $1"; usage ;;
  esac
done

if [[ -z "$MODE" ]]; then
  log_error "必须指定 --apply 或 --dry-run"
  usage
fi

if [[ $EUID -ne 0 ]]; then
  log_error "请以 root 权限运行"
  exit 1
fi

# ==================== 检查 1: Voter 节点数量 ====================
check_voters() {
  log_step "检查 voter 节点数量"

  local voter_count standby_count
  read -r voter_count standby_count < <(incus cluster list --format json 2>/dev/null | \
    python3 -c "
import sys, json
members = json.load(sys.stdin)
voters = 0
standbys = 0
for m in members:
    if m.get('status') != 'Online':
        continue
    # Incus 6.x: 'roles' 列表包含 'database', 'database-leader', 'database-standby'
    roles = m.get('roles', [])
    if 'database' in roles or 'database-leader' in roles:
        voters += 1
    elif 'database-standby' in roles:
        standbys += 1
    elif m.get('database', False):
        # 兼容旧版本：无 roles 字段时 fallback
        voters += 1
print(f'{voters} {standbys}')
" 2>/dev/null || echo "0 0")

  log_info "在线 voter 节点数: ${voter_count}（stand-by: ${standby_count}）"

  if [[ "$voter_count" -lt 3 ]]; then
    log_error "voter 节点不足 3 个（当前 ${voter_count}，stand-by ${standby_count} 不参与仲裁）"
    log_error "至少需要 3 个 voter 节点以保证 Raft 仲裁"
    return 1
  fi

  log_info "[OK] voter 节点数满足要求（${voter_count} >= 3）"
  return 0
}

# ==================== 检查 2: VM 存储和设备 ====================
check_vms() {
  log_step "检查 VM 存储和设备绑定"

  local vm_list

  vm_list=$(incus list --format json type=virtual-machine 2>/dev/null || echo "[]")

  local total
  total=$(echo "$vm_list" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

  if [[ "$total" -eq 0 ]]; then
    log_info "当前无 VM 实例，跳过存储检查"
    return 0
  fi

  log_info "共 ${total} 个 VM，逐一检查..."

  # 获取存储池驱动类型映射（用于交叉验证 VM 根磁盘）
  local pool_drivers
  pool_drivers=$(incus storage list --format json 2>/dev/null | \
    python3 -c "
import sys, json
pools = json.load(sys.stdin)
print(json.dumps({p['name']: p['driver'] for p in pools}))
" 2>/dev/null || echo "{}")

  # 解析每个 VM 的存储和设备
  local issues_json
  issues_json=$(echo "$vm_list" | python3 -c "
import sys, json

vms = json.load(sys.stdin)
pool_drivers = json.loads('''${pool_drivers}''')
results = []

for vm in vms:
    name = vm['name']
    location = vm.get('location', 'unknown')
    issues = []

    # 检查 devices
    devices = vm.get('devices', {})
    expanded = vm.get('expanded_devices', devices)

    for dev_name, dev_conf in expanded.items():
        dev_type = dev_conf.get('type', '')

        # 磁盘设备
        if dev_type == 'disk':
            pool = dev_conf.get('pool', '')
            source = dev_conf.get('source', '')
            # 本地路径挂载不可 heal
            if source and source.startswith('/'):
                issues.append(f'设备 {dev_name}: 使用本地路径 {source}')
            # 交叉验证存储池类型 — 非 Ceph 池上的磁盘不可 heal
            elif pool and pool in pool_drivers:
                driver = pool_drivers[pool]
                if driver not in ('ceph', 'ceph-rbd'):
                    issues.append(f'设备 {dev_name}: 存储池 {pool} 为本地类型 ({driver})，不支持 healing')
            elif pool and pool not in pool_drivers:
                issues.append(f'设备 {dev_name}: 存储池 {pool} 未找到')

        # GPU/USB 等物理设备绑定
        if dev_type in ('gpu', 'usb', 'unix-char', 'unix-block', 'unix-hotplug'):
            issues.append(f'设备 {dev_name}: 本地物理设备绑定 ({dev_type})')

    results.append({
        'name': name,
        'location': location,
        'issues': issues,
        'healable': len(issues) == 0
    })

json.dump(results, sys.stdout)
" 2>/dev/null || echo "[]")

  # 显示结果
  echo "$issues_json" | python3 -c "
import sys, json

results = json.load(sys.stdin)
healable = 0
unhealable = 0

for r in results:
    name = r['name']
    loc = r['location']
    if r['healable']:
        print(f'  \033[32m[OK]\033[0m {name} (节点: {loc}) — 可被 heal')
        healable += 1
    else:
        print(f'  \033[31m[FAIL]\033[0m {name} (节点: {loc}) — 不可 heal:')
        for issue in r['issues']:
            print(f'         - {issue}')
        unhealable += 1

print()
print(f'可 heal: {healable}  不可 heal: {unhealable}  总计: {healable + unhealable}')
" 2>/dev/null

  # 额外检查: VM 的存储池是否为 Ceph
  log_info "检查存储池类型..."
  local storage_pools
  storage_pools=$(incus storage list --format json 2>/dev/null || echo "[]")

  echo "$storage_pools" | python3 -c "
import sys, json

pools = json.load(sys.stdin)
for pool in pools:
    name = pool['name']
    driver = pool['driver']
    status = pool.get('status', 'unknown')
    if driver == 'ceph':
        print(f'  \033[32m[OK]\033[0m 存储池 {name}: {driver} (共享存储)')
    else:
        print(f'  \033[33m[WARN]\033[0m 存储池 {name}: {driver} (本地存储，不支持 healing)')
" 2>/dev/null

  return 0
}

# ==================== 检查 3: Ceph 集群健康状态 ====================
check_ceph_health() {
  log_step "检查 Ceph 集群健康状态"

  local ceph_status
  ceph_status=$(ceph health --format json 2>/dev/null || echo '{"status":"UNKNOWN"}')

  local health
  health=$(echo "$ceph_status" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('status', 'UNKNOWN'))
" 2>/dev/null || echo "UNKNOWN")

  log_info "Ceph 状态: ${health}"

  case "$health" in
    HEALTH_OK)
      log_info "[OK] Ceph 集群健康"
      return 0
      ;;
    HEALTH_WARN)
      log_warn "[WARN] Ceph 集群有告警，healing 后 VM 可能启动缓慢"
      # WARN 不阻塞，但记录详情
      ceph health detail 2>/dev/null | head -20 || true
      return 0
      ;;
    *)
      log_error "[FAIL] Ceph 集群状态异常（${health}），healing 后 VM 可能无法启动"
      return 1
      ;;
  esac
}

# ==================== 应用配置 ====================
apply_healing() {
  log_step "应用 auto-healing 配置"

  # 设置阈值
  log_info "设置 cluster.offline_threshold = ${CLUSTER_OFFLINE_THRESHOLD}..."
  incus config set cluster.offline_threshold="${CLUSTER_OFFLINE_THRESHOLD}"

  log_info "设置 cluster.healing_threshold = ${CLUSTER_HEALING_THRESHOLD}..."
  incus config set cluster.healing_threshold="${CLUSTER_HEALING_THRESHOLD}"

  # 验证设置
  local actual_offline actual_healing
  actual_offline=$(incus config get cluster.offline_threshold 2>/dev/null || echo "unknown")
  actual_healing=$(incus config get cluster.healing_threshold 2>/dev/null || echo "unknown")

  log_info "当前配置:"
  log_info "  cluster.offline_threshold = ${actual_offline}"
  log_info "  cluster.healing_threshold = ${actual_healing}"

  log_info "auto-healing 配置已应用"
  log_info "预计恢复时间: ~$((CLUSTER_OFFLINE_THRESHOLD + CLUSTER_HEALING_THRESHOLD + 30)) 秒"
}

# ==================== 主流程 ====================
main() {
  local check_errors=0

  log_step "Incus Auto-Healing 配置（模式: ${MODE}）"

  # 前提检查
  check_voters      || check_errors=$((check_errors + 1))
  check_vms         || check_errors=$((check_errors + 1))
  check_ceph_health || check_errors=$((check_errors + 1))

  if [[ "$MODE" == "apply" ]]; then
    if [[ $check_errors -gt 0 ]]; then
      if [[ "$FORCE" != true ]]; then
        log_error "存在 ${check_errors} 项前提检查未通过，拒绝应用"
        log_error "修复问题后重试，或使用 --force 强制应用（可能导致数据丢失）"
        exit 1
      fi
      log_warn "存在 ${check_errors} 项前提检查未通过，--force 强制应用"
      log_warn "警告: 本地存储上的 VM 在 healing 时会丢失数据！"
    fi
    apply_healing
    echo ""
    log_info "=========================================="
    log_info "  Auto-Healing 配置完成"
    log_info "=========================================="
  else
    echo ""
    if [[ $check_errors -eq 0 ]]; then
      log_info "=========================================="
      log_info "  所有前提检查通过，可执行 --apply"
      log_info "=========================================="
    else
      log_warn "=========================================="
      log_warn "  ${check_errors} 项检查未通过，请先修复"
      log_warn "=========================================="
      exit 1
    fi
  fi
}

main
