#!/usr/bin/env bash
# 批量迁移工具 — 疏散指定节点上的所有 VM
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../configs/cluster-env.sh"

usage() {
    cat <<EOF
用法: $(basename "$0") --from <node> [选项]

将指定节点上的所有 VM 逐个热迁移到负载最低的其他节点，
用于节点维护前的疏散操作。

选项:
  --from <node>      源节点名称（必填）
  --cold             使用冷迁移模式
  --dry-run          仅显示迁移计划，不实际执行
  --help             显示帮助

示例:
  $(basename "$0") --from node3
  $(basename "$0") --from node3 --dry-run
  $(basename "$0") --from node3 --cold
EOF
    exit 0
}

# ── 参数解析 ──────────────────────────────────────────────
SOURCE_NODE=""
MIGRATE_MODE="--live"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --from)     SOURCE_NODE="$2"; shift 2 ;;
        --cold)     MIGRATE_MODE="--cold"; shift ;;
        --dry-run)  DRY_RUN=true; shift ;;
        --help)     usage ;;
        -*)         log_error "未知选项: $1"; exit 1 ;;
        *)          log_error "多余参数: $1"; exit 1 ;;
    esac
done

if [[ -z "$SOURCE_NODE" ]]; then
    log_error "缺少 --from 参数"
    usage
fi

# ── 前置检查 ──────────────────────────────────────────────
require_cmd incus || exit 1

# ── 获取源节点上的 VM 列表 ────────────────────────────────
log_info "获取 ${SOURCE_NODE} 上的 VM 列表..."
mapfile -t VM_LIST < <(incus list --format csv -c nL 2>/dev/null | awk -F, -v node="$SOURCE_NODE" '$2 == node {print $1}')

if [[ ${#VM_LIST[@]} -eq 0 ]]; then
    log_info "节点 ${SOURCE_NODE} 上没有 VM，无需迁移"
    exit 0
fi

log_info "找到 ${#VM_LIST[@]} 个 VM 需要迁移: ${VM_LIST[*]}"

# ── 获取负载最低的目标节点 ────────────────────────────────
# 统计每个节点上的 VM 数量，选择数量最少的节点
get_best_target() {
    local exclude="$1"
    local best_node=""
    local min_count=999999

    # 获取所有节点及其 VM 数量
    while IFS=, read -r node count; do
        node=$(echo "$node" | xargs)  # trim
        count=$(echo "$count" | xargs)
        if [[ "$node" != "$exclude" && "$count" -lt "$min_count" ]]; then
            min_count=$count
            best_node=$node
        fi
    done < <(
        # 先列出所有在线节点（VM 数为 0 的也包含）
        incus cluster list --format csv -c n 2>/dev/null | while read -r n; do
            n=$(echo "$n" | xargs)
            if [[ "$n" != "$exclude" ]]; then
                vm_count=$(incus list --format csv -c nL 2>/dev/null | awk -F, -v node="$n" '$2 == node' | wc -l)
                echo "${n},${vm_count}"
            fi
        done
    )

    if [[ -z "$best_node" ]]; then
        return 1
    fi
    echo "$best_node"
}

# ── 显示迁移计划 ──────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  批量迁移计划 — 疏散节点: ${SOURCE_NODE}"
echo "═══════════════════════════════════════════════════"
echo ""

# ── 执行迁移 ──────────────────────────────────────────────
TOTAL=${#VM_LIST[@]}
SUCCESS=0
FAILED=0
FAILED_VMS=()

for i in "${!VM_LIST[@]}"; do
    vm="${VM_LIST[$i]}"
    seq=$((i + 1))

    # 每次迁移前重新计算最佳目标节点
    target=$(get_best_target "$SOURCE_NODE")
    if [[ -z "$target" ]]; then
        log_error "无可用目标节点"
        exit 1
    fi

    echo "──────────────────────────────────────────────────"
    log_info "[${seq}/${TOTAL}] ${vm} → ${target}"

    if [[ "$DRY_RUN" == true ]]; then
        echo "  (dry-run) 将迁移 ${vm} 到 ${target}"
        SUCCESS=$((SUCCESS + 1))
        continue
    fi

    if "${SCRIPT_DIR}/migrate-vm.sh" "$vm" --target "$target" $MIGRATE_MODE; then
        SUCCESS=$((SUCCESS + 1))
    else
        FAILED=$((FAILED + 1))
        FAILED_VMS+=("$vm")
        log_error "迁移失败: ${vm}，继续处理下一个..."
    fi
done

# ── 汇总报告 ──────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  批量迁移报告"
echo "═══════════════════════════════════════════════════"
echo "  源节点:   ${SOURCE_NODE}"
echo "  总计:     ${TOTAL} 个 VM"
echo "  成功:     ${SUCCESS}"
echo "  失败:     ${FAILED}"
if [[ ${#FAILED_VMS[@]} -gt 0 ]]; then
    echo "  失败列表: ${FAILED_VMS[*]}"
fi
if [[ "$DRY_RUN" == true ]]; then
    echo "  模式:     dry-run（未实际执行）"
fi
echo "═══════════════════════════════════════════════════"

if [[ $FAILED -gt 0 ]]; then
    exit 1
fi
