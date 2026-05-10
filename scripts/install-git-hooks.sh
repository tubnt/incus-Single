#!/usr/bin/env bash
# pma-cr L-1 / PLAN-051 §2-A：把 cluster scripts 同步检查挂到 pre-commit hook。
# 开发者在本地 commit 前自动 diff `cluster/scripts/join-node.sh` 与
# `incus-admin/internal/sshexec/embedded/scripts/join-node.sh`；漂移即拒绝
# commit，避免 CI 才发现。
#
# 用法（一次性，每个 dev clone 后跑一次）：
#   bash scripts/install-git-hooks.sh
#
# 也可以走 git config core.hooksPath 全局指向本仓库的 hooks 目录。
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="${REPO_ROOT}/.git/hooks"
PRE_COMMIT="${HOOKS_DIR}/pre-commit"

mkdir -p "${HOOKS_DIR}"

cat > "${PRE_COMMIT}" <<'HOOK'
#!/usr/bin/env bash
# Auto-installed by scripts/install-git-hooks.sh
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"

# cluster/scripts/join-node.sh 与 embedded 副本必须严格一致
if [ -f "${REPO_ROOT}/scripts/check-join-node-sync.sh" ]; then
  if ! bash "${REPO_ROOT}/scripts/check-join-node-sync.sh"; then
    echo ""
    echo "ERROR: pre-commit hook 拒绝 commit"
    echo "       修复方法：cp incus-admin/internal/sshexec/embedded/scripts/join-node.sh \\"
    echo "                 cluster/scripts/join-node.sh && git add cluster/scripts/join-node.sh"
    exit 1
  fi
fi
HOOK

chmod +x "${PRE_COMMIT}"
echo "ok: pre-commit hook installed at ${PRE_COMMIT}"
