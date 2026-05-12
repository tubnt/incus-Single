#!/usr/bin/env bash
# incus-admin installer
#
# PLAN-043 / INFRA-011 一期。抄 k3s / Tailscale 模式：
#   - HTTPS only
#   - SHA256 校验下载产物
#   - sudo auto-elevate
#   - INSTALL_VERSION env var 锁版本
#   - 安装完打印 "incus-admin bootstrap first-node" 引导
#
# Usage:
#   curl -fsSL https://vmc.5ok.co/install.sh | bash
#   curl -fsSL https://vmc.5ok.co/install.sh | INSTALL_VERSION=0.5.0 bash
#
# 仅支持 Ubuntu 22.04+ / Debian 12+ x86_64 / arm64（D30）

set -euo pipefail

INSTALL_VERSION="${INSTALL_VERSION:-latest}"
INSTALL_PREFIX="${INSTALL_PREFIX:-/usr/local/bin}"
RELEASE_BASE="${RELEASE_BASE:-https://github.com/5ok-co/incus-admin/releases/download}"

color_red()    { printf "\033[31m%s\033[0m" "$*"; }
color_green()  { printf "\033[32m%s\033[0m" "$*"; }
color_yellow() { printf "\033[33m%s\033[0m" "$*"; }

err() { echo "$(color_red "ERROR:") $*" >&2; exit 1; }
ok()  { echo "$(color_green "✓") $*"; }
warn() { echo "$(color_yellow "⚠") $*"; }

# ---- sudo auto-elevate ----
if [[ $EUID -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    exec sudo -E "$0" "$@"
  else
    err "需要 root（且未装 sudo），请用 root 重新运行"
  fi
fi

# ---- OS check (D30: only ubuntu 22.04+ / debian 12+) ----
. /etc/os-release || err "无法读 /etc/os-release"
case "$ID" in
  ubuntu)
    [[ "${VERSION_ID%%.*}" -ge 22 ]] || err "需要 Ubuntu 22.04+，当前 $VERSION_ID"
    ;;
  debian)
    [[ "${VERSION_ID%%.*}" -ge 12 ]] || err "需要 Debian 12+，当前 $VERSION_ID"
    ;;
  *)
    err "一期仅支持 Ubuntu 22.04+ / Debian 12+，当前 ID=$ID"
    ;;
esac
ok "OS: $PRETTY_NAME"

# ---- arch ----
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) GOARCH=amd64 ;;
  aarch64|arm64) GOARCH=arm64 ;;
  *) err "不支持的架构：$ARCH" ;;
esac
ok "Arch: $ARCH ($GOARCH)"

# ---- prerequisites ----
need_curl=$(command -v curl >/dev/null 2>&1 || echo 1)
if [[ -n "${need_curl:-}" ]]; then
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates
fi

# ---- resolve version ----
if [[ "$INSTALL_VERSION" == "latest" ]]; then
  warn "INSTALL_VERSION=latest（仅 dev；生产请固定版本）"
  INSTALL_VERSION="$(curl -fsSL https://api.github.com/repos/5ok-co/incus-admin/releases/latest | grep -m1 '"tag_name"' | cut -d'"' -f4 || true)"
  [[ -n "$INSTALL_VERSION" ]] || err "无法解析 latest 版本，请手动指定 INSTALL_VERSION"
fi
ok "version: $INSTALL_VERSION"

# ---- download binary + checksum ----
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

BIN_URL="${RELEASE_BASE}/${INSTALL_VERSION}/incus-admin_linux_${GOARCH}"
SHA_URL="${RELEASE_BASE}/${INSTALL_VERSION}/SHA256SUMS"

echo "Downloading $BIN_URL"
curl -fsSL --output "$TMPDIR/incus-admin" "$BIN_URL"

echo "Downloading $SHA_URL"
curl -fsSL --output "$TMPDIR/SHA256SUMS" "$SHA_URL"

# 验证 SHA256：从 SHA256SUMS 中找 incus-admin_linux_${GOARCH} 的行
EXPECTED="$(grep " incus-admin_linux_${GOARCH}\$" "$TMPDIR/SHA256SUMS" | awk '{print $1}')"
[[ -n "$EXPECTED" ]] || err "SHA256SUMS 缺 incus-admin_linux_${GOARCH} 条目"
ACTUAL="$(sha256sum "$TMPDIR/incus-admin" | awk '{print $1}')"
[[ "$ACTUAL" == "$EXPECTED" ]] || err "SHA256 不匹配 (expected $EXPECTED got $ACTUAL)"
ok "SHA256 verified"

# ---- install ----
install -m 0755 "$TMPDIR/incus-admin" "$INSTALL_PREFIX/incus-admin"
ok "installed to $INSTALL_PREFIX/incus-admin"

# ---- next steps ----
cat <<EOF

$(color_green "✓ incus-admin 已安装")

下一步：

  1. 探测主机：
     $(color_yellow "incus-admin bootstrap detect")

  2. 交互式向导生成计划文件：
     $(color_yellow "incus-admin bootstrap first-node")

  3. 预演 + 执行：
     $(color_yellow "incus-admin bootstrap apply --plan /etc/incus-admin/bootstrap.yaml")
     $(color_yellow "incus-admin bootstrap apply --plan /etc/incus-admin/bootstrap.yaml --apply")

  完整文档： https://github.com/5ok-co/incus-admin/blob/main/docs/bootstrap-quickstart.md

EOF
