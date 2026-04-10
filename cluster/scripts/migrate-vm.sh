#!/usr/bin/env bash
# VM 迁移工具 — 支持热迁移（live）和冷迁移（cold）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../configs/cluster-env.sh"

usage() {
    cat <<EOF
用法: $(basename "$0") <vm> --target <node> [选项]

将 VM 迁移到指定目标节点，迁移后自动发送 GARP 刷新交换机 MAC 表。

参数:
  <vm>               VM 名称
  --target <node>    目标节点名称

选项:
  --live             热迁移（默认）— 内存实时同步，VM 几乎无停机
  --cold             冷迁移 — 先停止 VM，迁移后重新启动
  --no-garp          跳过 GARP 发送
  --help             显示帮助

示例:
  $(basename "$0") web-01 --target node2
  $(basename "$0") web-01 --target node3 --cold
EOF
    exit 0
}

# ── 参数解析 ──────────────────────────────────────────────
VM_NAME=""
TARGET_NODE=""
MODE="live"
SEND_GARP=true

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target)   TARGET_NODE="$2"; shift 2 ;;
        --live)     MODE="live"; shift ;;
        --cold)     MODE="cold"; shift ;;
        --no-garp)  SEND_GARP=false; shift ;;
        --help)     usage ;;
        -*)         log_error "未知选项: $1"; exit 1 ;;
        *)
            if [[ -z "$VM_NAME" ]]; then
                VM_NAME="$1"; shift
            else
                log_error "多余参数: $1"; exit 1
            fi
            ;;
    esac
done

if [[ -z "$VM_NAME" ]]; then
    log_error "缺少 VM 名称"
    usage
fi
if [[ -z "$TARGET_NODE" ]]; then
    log_error "缺少 --target 参数"
    usage
fi

# 节点名格式校验
if ! [[ "$TARGET_NODE" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    log_error "无效节点名: ${TARGET_NODE}（只允许字母/数字/_-）"
    exit 1
fi

# ── 前置检查 ──────────────────────────────────────────────
require_cmd incus || exit 1

# 检查 VM 存在
if ! incus info "$VM_NAME" &>/dev/null; then
    log_error "VM 不存在: ${VM_NAME}"
    exit 1
fi

# 获取当前所在节点
CURRENT_NODE=$(incus list "$VM_NAME" --format csv -c L 2>/dev/null | head -1)
if [[ -z "$CURRENT_NODE" ]]; then
    log_error "无法获取 VM ${VM_NAME} 当前节点"
    exit 1
fi

if [[ "$CURRENT_NODE" == "$TARGET_NODE" ]]; then
    log_warn "VM ${VM_NAME} 已在目标节点 ${TARGET_NODE} 上，无需迁移"
    exit 0
fi

# 获取 VM 的 IP 地址（用于 GARP）
get_vm_ip() {
    local vm="$1"
    # 从 incus 网络信息中获取 VM 的 IPv4 地址（排除 loopback）
    incus list "$vm" --format csv -c 4 2>/dev/null | grep -oP '\d+\.\d+\.\d+\.\d+' | head -1
}

# ── 执行迁移 ──────────────────────────────────────────────
log_info "开始${MODE}迁移: ${VM_NAME} (${CURRENT_NODE} → ${TARGET_NODE})"

if [[ "$MODE" == "live" ]]; then
    # 热迁移：内存实时同步，VM 几乎无停机（~100ms 切换）
    log_info "模式: 热迁移（live migration）"
    if ! incus move "$VM_NAME" --target "$TARGET_NODE"; then
        log_error "热迁移失败: ${VM_NAME}"
        # 回滚：确认 VM 仍在原节点且运行中
        AFTER_NODE=$(incus list "$VM_NAME" --format csv -c L 2>/dev/null | head -1)
        AFTER_STATUS=$(incus list "$VM_NAME" --format csv -c s 2>/dev/null | head -1)
        if [[ "$AFTER_NODE" == "$CURRENT_NODE" && "$AFTER_STATUS" == "RUNNING" ]]; then
            log_warn "VM 仍在原节点 ${CURRENT_NODE} 运行中，无需回滚"
        elif [[ -n "$AFTER_NODE" ]]; then
            log_warn "VM 当前在 ${AFTER_NODE}（状态: ${AFTER_STATUS}），尝试恢复..."
            incus start "$VM_NAME" 2>/dev/null || true
        else
            log_error "VM ${VM_NAME} 状态不可达，需人工介入"
        fi
        exit 1
    fi
else
    # 冷迁移：先停机再迁移
    log_info "模式: 冷迁移（stop → move → start）"

    VM_STATUS=$(incus list "$VM_NAME" --format csv -c s 2>/dev/null | head -1)

    if [[ "$VM_STATUS" == "RUNNING" ]]; then
        log_info "停止 VM: ${VM_NAME}"
        if ! incus stop "$VM_NAME"; then
            log_error "停止 VM 失败: ${VM_NAME}"
            exit 1
        fi
    fi

    log_info "迁移 VM: ${VM_NAME} → ${TARGET_NODE}"
    if ! incus move "$VM_NAME" --target "$TARGET_NODE"; then
        log_error "冷迁移失败: ${VM_NAME}"
        # 回滚：确认 VM 位置后再尝试启动
        AFTER_NODE=$(incus list "$VM_NAME" --format csv -c L 2>/dev/null | head -1)
        if [[ "$AFTER_NODE" == "$CURRENT_NODE" ]]; then
            log_warn "VM 仍在原节点 ${CURRENT_NODE}，尝试重新启动..."
            incus start "$VM_NAME" 2>/dev/null || log_error "回滚启动失败，需人工介入"
        elif [[ -n "$AFTER_NODE" ]]; then
            log_warn "VM 已到 ${AFTER_NODE}（非预期），尝试在该节点启动..."
            incus start "$VM_NAME" 2>/dev/null || log_error "回滚启动失败，需人工介入"
        else
            log_error "VM ${VM_NAME} 状态不可达，需人工介入"
        fi
        exit 1
    fi

    log_info "启动 VM: ${VM_NAME}"
    if ! incus start "$VM_NAME"; then
        log_error "启动 VM 失败: ${VM_NAME}（已迁移到 ${TARGET_NODE}）"
        exit 1
    fi
fi

# ── 验证迁移结果 ──────────────────────────────────────────
NEW_NODE=$(incus list "$VM_NAME" --format csv -c L 2>/dev/null | head -1)
if [[ "$NEW_NODE" != "$TARGET_NODE" ]]; then
    log_error "迁移验证失败: VM 应在 ${TARGET_NODE}，实际在 ${NEW_NODE}"
    exit 1
fi
log_ok "迁移完成: ${VM_NAME} → ${TARGET_NODE}"

# ── 发送 GARP ─────────────────────────────────────────────
if [[ "$SEND_GARP" == true ]]; then
    VM_IP=$(get_vm_ip "$VM_NAME")
    if [[ -n "$VM_IP" ]]; then
        log_info "发送 GARP 刷新交换机 MAC 表..."
        "${SCRIPT_DIR}/send-garp.sh" "$VM_IP"
    else
        log_warn "无法获取 VM IP，跳过 GARP 发送（VM 可能尚未获得 IP）"
    fi
fi

log_ok "全部完成: ${VM_NAME} 已迁移至 ${TARGET_NODE} (${MODE})"
