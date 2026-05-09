package aiassist

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"
)

// PLAN-038 / OPS-041 Phase B/C 脱敏层。
//
// 全部 LLM 输入必经；目标是让 prompt 不携带可识别的客户/租户信息：
//
//   - IPv4: 取前 3 段保留 + 末段置 0（10.0.10.5 → 10.0.10.0/24）
//   - MAC:  整段 SHA-256 → 前 8 字符
//   - hostname: 仅保留首段（node1.dc1.example.com → node1.*）
//   - JWT / API key 模糊：`eyJ\w+` → `<JWT>` / `[A-Za-z0-9]{40,}` → `<TOKEN>`
//
// 注意：此层只做"格式化"，不去做"语义判断"——不会移除"用户 ID" 字段（如果上游
// 把它放进 input，那是上游的问题）。

var (
	reIPv4   = regexp.MustCompile(`\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\b`)
	reMAC    = regexp.MustCompile(`\b([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b`)
	reJWT    = regexp.MustCompile(`eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+`)
	reToken  = regexp.MustCompile(`\b[A-Za-z0-9_\-]{40,}\b`)
	reHost   = regexp.MustCompile(`\b([a-z][a-z0-9-]+)\.([a-z][a-z0-9-]+(?:\.[a-z][a-z0-9-]+)+)\b`)
)

// RedactString 把 raw 文本里的敏感片段替换。用于 stderr / 日志类输入。
func RedactString(raw string) string {
	out := raw
	out = reJWT.ReplaceAllString(out, "<JWT>")
	// JWT 替换后再做 token，避免长 token 误吃掉短形 JWT
	out = reToken.ReplaceAllStringFunc(out, func(s string) string {
		// 已经是 <JWT> 跳过
		if strings.HasPrefix(s, "<") {
			return s
		}
		return "<TOKEN>"
	})
	// MAC 整段哈希
	out = reMAC.ReplaceAllStringFunc(out, func(s string) string { return HashMAC(s) })
	// IPv4 末段置 0
	out = reIPv4.ReplaceAllString(out, "$1.0/24")
	// FQDN：第二段开始打码
	out = reHost.ReplaceAllString(out, "$1.*")
	return out
}

// HashMAC SHA-256(mac) 的前 8 hex —— 让 LLM 仍可"看到唯一性"（区分多卡）但不
// 暴露真实 MAC（厂商前缀 OUI 也算敏感信息）。
func HashMAC(mac string) string {
	h := sha256.Sum256([]byte(strings.ToLower(mac)))
	return "mac-" + hex.EncodeToString(h[:])[:8]
}

// RedactIP 把单个 IPv4 字符串截断到 /24。非法输入原样返回。
func RedactIP(ip string) string {
	if !reIPv4.MatchString(ip) {
		return ip
	}
	return reIPv4.ReplaceAllString(ip, "$1.0/24")
}

// RedactHostname 仅保留首段。非 FQDN（无点）原样返回。
func RedactHostname(h string) string {
	idx := strings.IndexByte(h, '.')
	if idx <= 0 {
		return h
	}
	return h[:idx] + ".*"
}
