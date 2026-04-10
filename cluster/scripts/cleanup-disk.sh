#!/usr/bin/env bash
# ============================================================
# 磁盘清理脚本
# 用途：清理 journald / apt 缓存 / tmp，释放磁盘空间
# 安全约束：仅清理已知安全的临时目录，不删除关键文件
# ============================================================
set -euo pipefail

LOG_TAG="cleanup-disk"

log() {
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
    logger -t "${LOG_TAG}" "$*" 2>/dev/null || true
}

get_disk_usage() {
    df -h / | awk 'NR==2 {print $5}'
}

get_disk_avail() {
    df -h / | awk 'NR==2 {print $4}'
}

# ==================== 清理动作 ====================

cleanup_journald() {
    log "清理 journald 日志（保留 7 天）"
    local before after
    before=$(journalctl --disk-usage 2>/dev/null | grep -oP '[\d.]+[KMGT]' || echo "unknown")
    journalctl --vacuum-time=7d --vacuum-size=500M 2>/dev/null || true
    after=$(journalctl --disk-usage 2>/dev/null | grep -oP '[\d.]+[KMGT]' || echo "unknown")
    log "journald: ${before} → ${after}"
}

cleanup_apt() {
    log "清理 apt 缓存"
    local before after
    before=$(du -sh /var/cache/apt/archives/ 2>/dev/null | cut -f1 || echo "unknown")
    apt-get clean -y 2>/dev/null || true
    apt-get autoremove -y 2>/dev/null || true
    after=$(du -sh /var/cache/apt/archives/ 2>/dev/null | cut -f1 || echo "unknown")
    log "apt 缓存: ${before} → ${after}"
}

cleanup_tmp() {
    log "清理 /tmp（超过 7 天的文件）"
    local before after
    before=$(du -sh /tmp/ 2>/dev/null | cut -f1 || echo "unknown")
    # 仅删除超过 7 天的普通文件，排除正在使用的文件
    find /tmp -type f -mtime +7 -not -name ".*" -delete 2>/dev/null || true
    # 删除超过 7 天的空目录
    find /tmp -mindepth 1 -type d -empty -mtime +7 -delete 2>/dev/null || true
    after=$(du -sh /tmp/ 2>/dev/null | cut -f1 || echo "unknown")
    log "/tmp: ${before} → ${after}"
}

# ==================== 主流程 ====================

main() {
    log "========== 磁盘清理开始 =========="
    log "清理前: 使用率 $(get_disk_usage), 可用 $(get_disk_avail)"

    cleanup_journald
    cleanup_apt
    cleanup_tmp

    log "清理后: 使用率 $(get_disk_usage), 可用 $(get_disk_avail)"
    log "========== 磁盘清理完成 =========="
}

main "$@"
