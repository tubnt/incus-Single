#!/usr/bin/env bash
# =============================================================================
# CI gate：cluster/scripts/join-node.sh 必须与 embedded 副本严格一致。
#
# Session-2 F-03 / PLAN-051 §2-A：双副本漂移历史事故——cluster 副本缺
# OPS-046 的 VLAN-pub 子接口绑桥逻辑 → 运维直接跑会复现"VM 全断公网"。
# CI 用 diff -q 强制单一来源（embedded 是 master，cluster 是镜像）。
#
# 用法：
#   bash scripts/check-join-node-sync.sh
#
# 退出码：
#   0 = 一致
#   1 = 漂移（CI 即视为失败）
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MASTER="${REPO_ROOT}/incus-admin/internal/sshexec/embedded/scripts/join-node.sh"
MIRROR="${REPO_ROOT}/cluster/scripts/join-node.sh"

if [[ ! -f "${MASTER}" ]]; then
  echo "ERROR: master not found: ${MASTER}"
  exit 2
fi
if [[ ! -f "${MIRROR}" ]]; then
  echo "ERROR: mirror not found: ${MIRROR}"
  exit 2
fi

if diff -q "${MASTER}" "${MIRROR}" > /dev/null; then
  echo "ok: cluster/scripts/join-node.sh 与 embedded 副本一致"
  exit 0
fi

echo "ERROR: cluster/scripts/join-node.sh 与 embedded 副本漂移："
diff -u "${MASTER}" "${MIRROR}" | head -80
echo ""
echo "修复：cp '${MASTER}' '${MIRROR}' && git add cluster/scripts/join-node.sh"
exit 1
