#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# disaster-recovery-failover.sh — 灾备故障切换脚本
# 功能：将远端（Secondary）镜像提升为 Primary，更新 DNS，验证可用性
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../configs/cluster-env.sh"

# ---------- 默认参数 ----------
DR_POOL="${DR_POOL:-incus-pool}"
DR_DNS_ZONE="${DR_DNS_ZONE:-}"
DR_DNS_SERVER="${DR_DNS_SERVER:-}"
DR_DNS_KEY="${DR_DNS_KEY:-}"
DR_NEW_VIP="${DR_NEW_VIP:-}"
DR_VERIFY_TIMEOUT="${DR_VERIFY_TIMEOUT:-120}"

# ---------- 日志工具 ----------
log_info()  { echo "[INFO]  $(date '+%Y-%m-%d %H:%M:%S') $*"; }
log_warn()  { echo "[WARN]  $(date '+%Y-%m-%d %H:%M:%S') $*" >&2; }
log_error() { echo "[ERROR] $(date '+%Y-%m-%d %H:%M:%S') $*" >&2; }

# ---------- 前置检查 ----------
preflight_check() {
    log_info "故障切换前置检查..."

    if ! ceph status &>/dev/null; then
        log_error "无法连接本地 Ceph 集群"
        exit 1
    fi

    # 检查 pool 镜像状态
    local mirror_info
    mirror_info=$(rbd mirror pool info "${DR_POOL}" --format=json 2>/dev/null)
    if [[ -z "${mirror_info}" ]]; then
        log_error "Pool '${DR_POOL}' 未配置镜像"
        exit 1
    fi

    log_info "前置检查通过"
}

# ---------- 提升镜像为 Primary ----------
promote_images() {
    log_info "开始将 pool '${DR_POOL}' 中的所有镜像提升为 Primary..."

    # 获取所有被镜像的 image
    local images
    images=$(rbd mirror pool status "${DR_POOL}" --format=json 2>/dev/null | \
             python3 -c "
import sys, json
data = json.load(sys.stdin)
for img in data.get('images', []):
    print(img['name'])
" 2>/dev/null || true)

    if [[ -z "${images}" ]]; then
        # 回退：列出 pool 中所有镜像
        images=$(rbd ls "${DR_POOL}" 2>/dev/null || true)
    fi

    if [[ -z "${images}" ]]; then
        log_warn "未找到需要提升的镜像"
        return
    fi

    local count=0
    local failed=0
    while IFS= read -r img; do
        log_info "  提升镜像: ${DR_POOL}/${img}"
        if rbd mirror image promote --force "${DR_POOL}/${img}" 2>/dev/null; then
            (( count++ ))
        else
            log_warn "  提升失败: ${DR_POOL}/${img}"
            (( failed++ ))
        fi
    done <<< "${images}"

    log_info "镜像提升完成: 成功 ${count} 个, 失败 ${failed} 个"

    if (( failed > 0 )); then
        log_warn "部分镜像提升失败，请手动检查"
    fi
}

# ---------- 更新 DNS ----------
update_dns() {
    if [[ -z "${DR_DNS_ZONE}" || -z "${DR_DNS_SERVER}" || -z "${DR_NEW_VIP}" ]]; then
        log_warn "DNS 参数未配置，跳过 DNS 更新"
        log_warn "  请手动将服务 DNS 指向新的 VIP: ${DR_NEW_VIP:-未设置}"
        return
    fi

    log_info "更新 DNS 记录..."
    log_info "  Zone: ${DR_DNS_ZONE}"
    log_info "  新 VIP: ${DR_NEW_VIP}"

    # 使用 nsupdate 动态更新 DNS
    if command -v nsupdate &>/dev/null; then
        local update_cmd
        update_cmd=$(cat <<NSUPDATE
server ${DR_DNS_SERVER}
zone ${DR_DNS_ZONE}
update delete ${DR_DNS_ZONE} A
update add ${DR_DNS_ZONE} 60 A ${DR_NEW_VIP}
send
NSUPDATE
)
        if [[ -n "${DR_DNS_KEY}" ]]; then
            echo "${update_cmd}" | nsupdate -k "${DR_DNS_KEY}"
        else
            echo "${update_cmd}" | nsupdate
        fi
        log_info "DNS 记录已更新"
    else
        log_warn "nsupdate 未安装，请手动更新 DNS"
        log_warn "  将 ${DR_DNS_ZONE} A 记录指向 ${DR_NEW_VIP}"
    fi
}

# ---------- 验证可用性 ----------
verify_availability() {
    log_info "验证故障切换后的服务可用性..."

    # 1. 检查 Ceph 集群健康
    log_info "  检查 Ceph 集群健康状态..."
    local health
    health=$(ceph health 2>/dev/null || echo "UNKNOWN")
    log_info "  Ceph 健康状态: ${health}"

    # 2. 检查 RBD 镜像状态
    log_info "  检查 RBD 镜像状态..."
    rbd mirror pool status "${DR_POOL}" 2>/dev/null || true

    # 3. 尝试创建并删除一个测试镜像
    log_info "  验证 RBD 可用性..."
    local test_image="dr-failover-test-$(date +%s)"
    if rbd create "${DR_POOL}/${test_image}" --size 1 2>/dev/null; then
        rbd rm "${DR_POOL}/${test_image}" 2>/dev/null || true
        log_info "  RBD 读写验证通过"
    else
        log_warn "  RBD 读写验证失败"
    fi

    # 4. 检查 DNS 解析（如果配置了）
    if [[ -n "${DR_DNS_ZONE}" && -n "${DR_NEW_VIP}" ]]; then
        log_info "  检查 DNS 解析..."
        local resolved_ip
        resolved_ip=$(dig +short "${DR_DNS_ZONE}" A 2>/dev/null | head -1)
        if [[ "${resolved_ip}" == "${DR_NEW_VIP}" ]]; then
            log_info "  DNS 解析正确: ${DR_DNS_ZONE} -> ${resolved_ip}"
        else
            log_warn "  DNS 解析不匹配: 期望 ${DR_NEW_VIP}，实际 ${resolved_ip:-无结果}"
            log_warn "  DNS 传播可能需要时间"
        fi
    fi

    log_info "可用性验证完成"
}

# ---------- 使用说明 ----------
usage() {
    cat <<EOF
用法: $(basename "$0") <命令>

命令:
  failover     执行完整故障切换流程（提升镜像 + 更新 DNS + 验证）
  promote      仅提升镜像为 Primary
  update-dns   仅更新 DNS 记录
  verify       仅验证可用性

环境变量:
  DR_POOL              目标 pool (默认: incus-pool)
  DR_DNS_ZONE          DNS zone 名称
  DR_DNS_SERVER        DNS 服务器地址
  DR_DNS_KEY           nsupdate TSIG 密钥文件路径
  DR_NEW_VIP           新的服务 VIP 地址
  DR_VERIFY_TIMEOUT    验证超时时间 (秒，默认: 120)

示例:
  # 完整故障切换
  DR_NEW_VIP=10.0.1.100 DR_DNS_ZONE=storage.example.com $(basename "$0") failover

  # 仅提升镜像
  $(basename "$0") promote
EOF
}

# ---------- 主入口 ----------
main() {
    local cmd="${1:-}"

    case "${cmd}" in
        failover)
            log_info "========== 开始灾备故障切换 =========="
            preflight_check
            promote_images
            update_dns
            verify_availability
            log_info "========== 故障切换完成 =========="
            ;;
        promote)
            preflight_check
            promote_images
            ;;
        update-dns)
            update_dns
            ;;
        verify)
            preflight_check
            verify_availability
            ;;
        *)
            usage
            exit 1
            ;;
    esac
}

main "$@"
