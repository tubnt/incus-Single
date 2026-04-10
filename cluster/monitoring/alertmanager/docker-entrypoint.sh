#!/bin/sh
# 将 alertmanager.yml 模板中的 ${VAR} 替换为环境变量值
# Alertmanager 原生不支持环境变量替换，需在启动前预处理
set -eu

TPL="/etc/alertmanager/alertmanager.yml.tpl"
OUT="/tmp/alertmanager.yml"

# 使用 awk 逐行替换 ${VAR} 引用，安全处理密码中的特殊字符
awk '{
  while (match($0, /\$\{[A-Za-z_][A-Za-z_0-9]*\}/)) {
    var = substr($0, RSTART+2, RLENGTH-3)
    val = ENVIRON[var]
    if (val == "") val = ""
    $0 = substr($0, 1, RSTART-1) val substr($0, RSTART+RLENGTH)
  }
  print
}' "$TPL" > "$OUT"

exec /bin/alertmanager --config.file="$OUT" --storage.path=/alertmanager
