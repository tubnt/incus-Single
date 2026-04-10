#!/bin/bash
# ============================================================
# Ceph RGW (RADOS Gateway) 部署脚本
# 用途: 在现有 Ceph 集群上部署 RGW，提供 S3 兼容对象存储服务
#
# 前置条件:
#   - Ceph 集群已通过 deploy-ceph.sh 部署完成
#   - MON/MGR/OSD 正常运行
#
# 用法:
#   deploy-rgw.sh <步骤>
#
# 步骤:
#   preflight      - 前置检查（Ceph 集群状态、证书工具）
#   deploy         - 部署 RGW 守护进程（node1-3，高可用）
#   create-realm   - 创建 realm / zonegroup / zone
#   ssl            - 配置 HTTPS（自签证书或 Let's Encrypt）
#   create-admin   - 创建管理员用户
#   create-pool    - 创建 RGW 专用存储池
#   tune           - 性能调优
#   verify         - 验证 S3 端点
#   all            - 按顺序执行以上全部步骤
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../configs/cluster-env.sh"

# ==================== 日志 ====================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERR]${NC} $*" >&2; exit 1; }
step() { echo -e "\n${BLUE}========== $* ==========${NC}"; }

# ==================== RGW 配置 ====================
RGW_PORT=${RGW_PORT:-7480}
RGW_SSL_PORT=${RGW_SSL_PORT:-7443}
RGW_REALM=${RGW_REALM:-"incus-realm"}
RGW_ZONEGROUP=${RGW_ZONEGROUP:-"incus-zonegroup"}
RGW_ZONE=${RGW_ZONE:-"incus-zone"}
RGW_ADMIN_USER=${RGW_ADMIN_USER:-"rgw-admin"}
RGW_DOMAIN=${RGW_DOMAIN:-"s3.incus.local"}
RGW_SSL_CERT_DIR="/etc/ceph/rgw-ssl"
RGW_PLACEMENT_TARGETS=${RGW_PLACEMENT_TARGETS:-3}  # 部署在 node1-3

# 远程执行（通过管理网）
run_on() {
  local node="$1"; shift
  local ip
  ip=$(get_node_field "$node" 3)
  ssh -o StrictHostKeyChecking=no "${SSH_USER}@${ip}" "$@"
}

copy_to() {
  local node="$1" src="$2" dst="$3"
  local ip
  ip=$(get_node_field "$node" 3)
  scp -o StrictHostKeyChecking=no "$src" "${SSH_USER}@${ip}:${dst}"
}

# 获取 RGW 节点列表（部署在 MON 节点上）
get_rgw_nodes() {
  get_mon_nodes | head -n "${RGW_PLACEMENT_TARGETS}"
}

# ==================== 前置检查 ====================
do_preflight() {
  step "前置检查"

  log "检查 Ceph 集群状态..."
  local health
  health=$(run_on "${CEPH_BOOTSTRAP_NODE}" "ceph health --connect-timeout 10" 2>/dev/null) || \
    err "无法连接 Ceph 集群"

  if [[ "$health" == "HEALTH_ERR" ]]; then
    err "Ceph 集群状态异常: ${health}，请先修复后再部署 RGW"
  fi
  log "集群状态: ${health}"

  log "检查 cephadm 可用性..."
  run_on "${CEPH_BOOTSTRAP_NODE}" "command -v cephadm >/dev/null 2>&1" || \
    err "cephadm 未安装"
  log "cephadm 已就绪"

  log "检查 RGW 节点就绪状态..."
  for node in $(get_rgw_nodes); do
    local mgmt_ip
    mgmt_ip=$(get_node_field "$node" 3)
    if ! run_on "${CEPH_BOOTSTRAP_NODE}" "ping -c 1 -W 2 ${mgmt_ip}" >/dev/null 2>&1; then
      err "无法连接 RGW 目标节点 ${node} (${mgmt_ip})"
    fi
    log "  ${node} (${mgmt_ip}) 可达"
  done

  log "检查端口占用..."
  for node in $(get_rgw_nodes); do
    if run_on "$node" "ss -tlnp | grep -q ':${RGW_PORT} '" 2>/dev/null; then
      warn "${node} 端口 ${RGW_PORT} 已被占用，可能 RGW 已部署"
    fi
  done

  log "前置检查完成"
}

# ==================== 部署 RGW 守护进程 ====================
do_deploy() {
  step "部署 RGW 守护进程"

  local rgw_count=0
  for node in $(get_rgw_nodes); do
    rgw_count=$((rgw_count + 1))
    local rgw_id="rgw.${node}"

    log "在 ${node} 上部署 RGW (${rgw_id})..."

    # 检查是否已部署
    if run_on "${CEPH_BOOTSTRAP_NODE}" "ceph orch ls --service-type rgw --format json" 2>/dev/null | \
       grep -q "${rgw_id}"; then
      warn "RGW ${rgw_id} 已存在，跳过"
      continue
    fi

    # 使用 cephadm 部署 RGW
    run_on "${CEPH_BOOTSTRAP_NODE}" "
      ceph orch apply rgw ${RGW_REALM} ${RGW_ZONE} \
        --placement='${rgw_count} ${node}' \
        --port=${RGW_PORT} \
        2>/dev/null
    " || err "在 ${node} 上部署 RGW 失败"

    log "${rgw_id} 部署完成"
  done

  # 等待 RGW 服务就绪
  log "等待 RGW 服务启动..."
  local retries=30
  while [[ $retries -gt 0 ]]; do
    local running
    running=$(run_on "${CEPH_BOOTSTRAP_NODE}" \
      "ceph orch ls --service-type rgw --format json 2>/dev/null | python3 -c \"
import sys, json
data = json.load(sys.stdin)
print(sum(s.get('status', {}).get('running', 0) for s in data))
\"" 2>/dev/null) || running=0

    if [[ "$running" -ge 1 ]]; then
      log "RGW 服务已启动 (${running} 个实例运行中)"
      break
    fi
    retries=$((retries - 1))
    sleep 5
  done

  if [[ $retries -eq 0 ]]; then
    err "RGW 服务启动超时"
  fi

  log "RGW 守护进程部署完成"
}

# ==================== 创建 Realm / Zonegroup / Zone ====================
do_create_realm() {
  step "创建 Realm / Zonegroup / Zone"

  log "创建 realm: ${RGW_REALM}..."
  run_on "${CEPH_BOOTSTRAP_NODE}" "
    radosgw-admin realm create --rgw-realm=${RGW_REALM} --default 2>/dev/null || \
    radosgw-admin realm get --rgw-realm=${RGW_REALM} 2>/dev/null
  " || err "创建 realm 失败"

  log "创建 zonegroup: ${RGW_ZONEGROUP}..."
  run_on "${CEPH_BOOTSTRAP_NODE}" "
    radosgw-admin zonegroup create --rgw-zonegroup=${RGW_ZONEGROUP} \
      --rgw-realm=${RGW_REALM} \
      --endpoints=https://${RGW_DOMAIN}:${RGW_SSL_PORT} \
      --master --default 2>/dev/null || \
    radosgw-admin zonegroup get --rgw-zonegroup=${RGW_ZONEGROUP} 2>/dev/null
  " || err "创建 zonegroup 失败"

  log "创建 zone: ${RGW_ZONE}..."
  run_on "${CEPH_BOOTSTRAP_NODE}" "
    radosgw-admin zone create --rgw-zone=${RGW_ZONE} \
      --rgw-zonegroup=${RGW_ZONEGROUP} \
      --rgw-realm=${RGW_REALM} \
      --endpoints=https://${RGW_DOMAIN}:${RGW_SSL_PORT} \
      --master --default 2>/dev/null || \
    radosgw-admin zone get --rgw-zone=${RGW_ZONE} 2>/dev/null
  " || err "创建 zone 失败"

  log "提交 period..."
  run_on "${CEPH_BOOTSTRAP_NODE}" "radosgw-admin period update --commit" || \
    warn "period 更新失败（首次部署可忽略）"

  log "Realm / Zonegroup / Zone 创建完成"
}

# ==================== 配置 SSL ====================
do_ssl() {
  step "配置 HTTPS"

  log "创建 SSL 证书目录..."
  run_on "${CEPH_BOOTSTRAP_NODE}" "mkdir -p ${RGW_SSL_CERT_DIR}"

  # 检查是否已有证书
  if run_on "${CEPH_BOOTSTRAP_NODE}" "test -f ${RGW_SSL_CERT_DIR}/server.pem" 2>/dev/null; then
    warn "SSL 证书已存在，跳过生成"
  else
    log "生成自签 SSL 证书..."
    run_on "${CEPH_BOOTSTRAP_NODE}" "
      openssl req -x509 -nodes -days 3650 \
        -newkey rsa:2048 \
        -keyout ${RGW_SSL_CERT_DIR}/server.key \
        -out ${RGW_SSL_CERT_DIR}/server.crt \
        -subj '/CN=${RGW_DOMAIN}' \
        -addext 'subjectAltName=DNS:${RGW_DOMAIN},DNS:*.${RGW_DOMAIN}'
      cat ${RGW_SSL_CERT_DIR}/server.key ${RGW_SSL_CERT_DIR}/server.crt > ${RGW_SSL_CERT_DIR}/server.pem
      chmod 600 ${RGW_SSL_CERT_DIR}/server.key ${RGW_SSL_CERT_DIR}/server.pem
    " || err "生成 SSL 证书失败"
    log "自签证书已生成"
  fi

  log "将证书注入 Ceph 配置..."
  run_on "${CEPH_BOOTSTRAP_NODE}" "
    ceph config set client.rgw.${RGW_REALM}.${RGW_ZONE} rgw_frontends \
      'beast port=${RGW_PORT} ssl_port=${RGW_SSL_PORT} ssl_certificate=${RGW_SSL_CERT_DIR}/server.pem'
  " || err "注入 SSL 配置失败"

  # 分发证书到所有 RGW 节点
  log "分发 SSL 证书到 RGW 节点..."
  for node in $(get_rgw_nodes); do
    if [[ "$node" == "${CEPH_BOOTSTRAP_NODE}" ]]; then
      continue
    fi
    run_on "$node" "mkdir -p ${RGW_SSL_CERT_DIR}"
    local bootstrap_ip node_ip
    bootstrap_ip=$(get_node_field "${CEPH_BOOTSTRAP_NODE}" 3)
    node_ip=$(get_node_field "$node" 3)
    run_on "${CEPH_BOOTSTRAP_NODE}" "
      scp -o StrictHostKeyChecking=no ${RGW_SSL_CERT_DIR}/server.pem ${SSH_USER}@${node_ip}:${RGW_SSL_CERT_DIR}/server.pem
      scp -o StrictHostKeyChecking=no ${RGW_SSL_CERT_DIR}/server.key ${SSH_USER}@${node_ip}:${RGW_SSL_CERT_DIR}/server.key
    "
    log "  证书已分发到 ${node}"
  done

  log "重启 RGW 服务以应用 SSL..."
  run_on "${CEPH_BOOTSTRAP_NODE}" "ceph orch restart rgw.${RGW_REALM}.${RGW_ZONE}" || \
    warn "RGW 重启命令已发送（异步生效）"

  sleep 5
  log "HTTPS 配置完成"
}

# ==================== 创建管理员用户 ====================
do_create_admin() {
  step "创建 RGW 管理员用户"

  log "创建管理员: ${RGW_ADMIN_USER}..."
  local admin_output
  admin_output=$(run_on "${CEPH_BOOTSTRAP_NODE}" "
    radosgw-admin user create \
      --uid='${RGW_ADMIN_USER}' \
      --display-name='RGW Administrator' \
      --caps='buckets=*;users=*;usage=*;metadata=*;zone=*' \
      --system 2>/dev/null || \
    radosgw-admin user info --uid='${RGW_ADMIN_USER}' 2>/dev/null
  ") || err "创建管理员用户失败"

  # 提取凭据
  local access_key secret_key
  access_key=$(echo "$admin_output" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data['keys'][0]['access_key'])
" 2>/dev/null) || err "提取 access_key 失败"

  secret_key=$(echo "$admin_output" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data['keys'][0]['secret_key'])
" 2>/dev/null) || err "提取 secret_key 失败"

  log "管理员凭据:"
  log "  Access Key: ${access_key}"
  log "  Secret Key: ${secret_key}"
  warn "请妥善保存以上凭据，并写入 .env 文件"

  # 保存到 bootstrap 节点
  run_on "${CEPH_BOOTSTRAP_NODE}" "
    cat > /etc/ceph/rgw-admin-credentials <<CRED_EOF
RGW_ADMIN_ACCESS_KEY=${access_key}
RGW_ADMIN_SECRET_KEY=${secret_key}
CRED_EOF
    chmod 600 /etc/ceph/rgw-admin-credentials
  "
  log "凭据已保存到 ${CEPH_BOOTSTRAP_NODE}:/etc/ceph/rgw-admin-credentials"
}

# ==================== 创建 RGW 存储池 ====================
do_create_pool() {
  step "创建 RGW 专用存储池"

  local pools=(
    ".rgw.root"
    "default.rgw.log"
    "default.rgw.control"
    "default.rgw.meta"
    "default.rgw.buckets.index"
    "default.rgw.buckets.data"
  )

  for pool in "${pools[@]}"; do
    if run_on "${CEPH_BOOTSTRAP_NODE}" "ceph osd pool ls | grep -q '^${pool}$'" 2>/dev/null; then
      log "存储池 ${pool} 已存在"
    else
      log "创建存储池: ${pool}..."
      local pg_num=32
      # 数据池使用更多 PG
      if [[ "$pool" == *"buckets.data"* ]]; then
        pg_num=128
      fi
      run_on "${CEPH_BOOTSTRAP_NODE}" "
        ceph osd pool create ${pool} ${pg_num} ${pg_num} replicated
        ceph osd pool set ${pool} size ${CEPH_POOL_SIZE}
        ceph osd pool set ${pool} min_size ${CEPH_POOL_MIN_SIZE}
        ceph osd pool application enable ${pool} rgw
      " || err "创建存储池 ${pool} 失败"
    fi
  done

  log "RGW 存储池创建完成"
}

# ==================== 性能调优 ====================
do_tune() {
  step "RGW 性能调优"

  log "设置 RGW 调优参数..."
  run_on "${CEPH_BOOTSTRAP_NODE}" "
    # 线程池大小
    ceph config set client.rgw rgw_thread_pool_size 512

    # 单次上传分片大小
    ceph config set client.rgw rgw_multipart_min_part_size 5242880

    # 桶索引分片（高并发场景）
    ceph config set client.rgw rgw_override_bucket_index_max_shards 16

    # GC 优化
    ceph config set client.rgw rgw_gc_max_objs 64
    ceph config set client.rgw rgw_gc_obj_min_wait 7200
    ceph config set client.rgw rgw_gc_processor_max_time 3600

    # 日志清理
    ceph config set client.rgw rgw_enable_usage_log true
    ceph config set client.rgw rgw_usage_log_flush_threshold 1024

    # 连接超时
    ceph config set client.rgw rgw_frontends 'beast port=${RGW_PORT} ssl_port=${RGW_SSL_PORT} ssl_certificate=${RGW_SSL_CERT_DIR}/server.pem tcp_nodelay=1'
  " || warn "部分调优参数设置失败"

  log "RGW 性能调优完成"
}

# ==================== 验证 ====================
do_verify() {
  step "验证 RGW S3 端点"

  log "检查 RGW 服务状态..."
  run_on "${CEPH_BOOTSTRAP_NODE}" "ceph orch ls --service-type rgw"

  log "检查 RGW 守护进程..."
  run_on "${CEPH_BOOTSTRAP_NODE}" "ceph orch ps --daemon-type rgw"

  log "测试 S3 端点..."
  for node in $(get_rgw_nodes); do
    local mgmt_ip
    mgmt_ip=$(get_node_field "$node" 3)
    local http_code
    http_code=$(run_on "$node" "
      curl -s -o /dev/null -w '%{http_code}' -k https://127.0.0.1:${RGW_SSL_PORT}/ 2>/dev/null
    ") || http_code="000"

    if [[ "$http_code" == "200" ]] || [[ "$http_code" == "403" ]]; then
      log "  ${node}: S3 端点正常 (HTTP ${http_code})"
    else
      warn "  ${node}: S3 端点异常 (HTTP ${http_code})"
    fi
  done

  # 测试 S3 操作（如果有管理员凭据）
  if run_on "${CEPH_BOOTSTRAP_NODE}" "test -f /etc/ceph/rgw-admin-credentials" 2>/dev/null; then
    log "测试 S3 API 操作..."
    run_on "${CEPH_BOOTSTRAP_NODE}" "
      source /etc/ceph/rgw-admin-credentials
      # 安装 awscli（如果没有）
      command -v aws >/dev/null 2>&1 || pip3 install awscli -q

      aws configure set aws_access_key_id \"\${RGW_ADMIN_ACCESS_KEY}\"
      aws configure set aws_secret_access_key \"\${RGW_ADMIN_SECRET_KEY}\"
      aws configure set default.region us-east-1

      # 列出桶
      aws --endpoint-url https://127.0.0.1:${RGW_SSL_PORT} --no-verify-ssl s3 ls 2>/dev/null && \
        echo '  S3 ListBuckets 操作成功' || \
        echo '  S3 ListBuckets 操作失败'
    " || warn "S3 API 测试未完成"
  fi

  log "RGW 存储池使用量:"
  run_on "${CEPH_BOOTSTRAP_NODE}" "ceph df | grep -E 'rgw|POOL'" || true

  log "验证完成"
}

# ==================== 主入口 ====================
usage() {
  echo "用法: $0 <步骤>"
  echo ""
  echo "步骤:"
  echo "  preflight      前置检查"
  echo "  deploy         部署 RGW 守护进程"
  echo "  create-realm   创建 realm/zonegroup/zone"
  echo "  ssl            配置 HTTPS"
  echo "  create-admin   创建管理员用户"
  echo "  create-pool    创建 RGW 存储池"
  echo "  tune           性能调优"
  echo "  verify         验证 S3 端点"
  echo "  all            执行全部步骤"
  exit 1
}

main() {
  local action="${1:-}"
  [[ -z "$action" ]] && usage

  case "$action" in
    preflight)     do_preflight ;;
    deploy)        do_deploy ;;
    create-realm)  do_create_realm ;;
    ssl)           do_ssl ;;
    create-admin)  do_create_admin ;;
    create-pool)   do_create_pool ;;
    tune)          do_tune ;;
    verify)        do_verify ;;
    all)
      do_preflight
      do_deploy
      do_create_realm
      do_ssl
      do_create_admin
      do_create_pool
      do_tune
      do_verify
      ;;
    *) usage ;;
  esac
}

main "$@"
