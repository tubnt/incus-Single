#!/usr/bin/env bash
# 发送 Gratuitous ARP — 迁移后刷新交换机 MAC 表
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../configs/cluster-env.sh"

usage() {
    cat <<EOF
用法: $(basename "$0") <ip> [选项]

在 VM 迁移完成后，通过 ${BRIDGE_IFACE} 发送 Gratuitous ARP 包，
刷新交换机 MAC 表，使流量正确转发到新节点。

参数:
  <ip>              VM 的公网 IP 地址

选项:
  -c, --count NUM   发送次数（默认: ${GARP_COUNT}）
  -i, --iface IF    网络接口（默认: ${BRIDGE_IFACE}）
  --help            显示帮助

示例:
  $(basename "$0") 202.151.179.232
  $(basename "$0") 202.151.179.232 -c 5
EOF
    exit 0
}

# ── 参数解析 ──────────────────────────────────────────────
VM_IP=""
COUNT="${GARP_COUNT}"
IFACE="${BRIDGE_IFACE}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        -c|--count) COUNT="$2"; shift 2 ;;
        -i|--iface) IFACE="$2"; shift 2 ;;
        --help)     usage ;;
        -*)         log_error "未知选项: $1"; exit 1 ;;
        *)          VM_IP="$1"; shift ;;
    esac
done

if [[ -z "$VM_IP" ]]; then
    log_error "缺少 IP 参数"
    usage
fi

# ── 前置检查 ──────────────────────────────────────────────
if ! require_cmd arping; then
    log_error "请安装 arping: apt install arping"
    exit 1
fi

if ! ip link show "$IFACE" &>/dev/null; then
    log_error "接口 ${IFACE} 不存在"
    exit 1
fi

# ── 发送 GARP ─────────────────────────────────────────────
RETRY="${GARP_RETRY:-2}"
DELAY="${GARP_RETRY_DELAY:-1}"
garp_ok=false

for attempt in $(seq 1 "$RETRY"); do
    log_info "GARP 第 ${attempt}/${RETRY} 轮: IP=${VM_IP} 接口=${IFACE} 次数=${COUNT}"
    failed=false
    # -U: unsolicited ARP reply（刷新大多数交换机 MAC 表）
    if ! arping -U -c "$COUNT" -I "$IFACE" "$VM_IP" 2>/dev/null; then
        log_warn "arping -U 失败（轮次 ${attempt}）"
        failed=true
    fi
    # -A: ARP request 模式（部分交换机仅响应 request）
    if ! arping -A -c "$COUNT" -I "$IFACE" "$VM_IP" 2>/dev/null; then
        log_warn "arping -A 失败（轮次 ${attempt}）"
        failed=true
    fi
    if [[ "$failed" == false ]]; then
        garp_ok=true
        break
    fi
    if [[ "$attempt" -lt "$RETRY" ]]; then
        sleep "$DELAY"
    fi
done

if [[ "$garp_ok" == true ]]; then
    log_ok "GARP 发送完成: ${VM_IP}"
else
    log_warn "GARP 发送可能不完整: ${VM_IP}（部分 arping 调用失败，交换机 MAC 表可能未及时刷新）"
fi
