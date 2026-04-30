// Package auth (extension)：vms.password 加密。
//
// OPS-022 v1 设计：
//   - AES-256-GCM；key 从 env INCUS_PASSWORD_ENCRYPTION_KEY 取（32 字节 base64）
//   - 密文格式："v1:" + base64(nonce || ciphertext)，version prefix 给后续 rotation 留口
//   - 没配 key 时 EncryptPassword/DecryptPassword 都 passthrough（向后兼容老部署 / 测试）
//   - 解密遇到无 prefix 的旧明文 → 返回原值（migration 期间过渡），打 warn 日志
//
// 不做 v1：key rotation / multi-version key store / per-row salt。后续 OPS-023 立项。
package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
)

const passwordCipherPrefix = "v1:"

var (
	pwOnce  sync.Once
	pwAEAD  cipher.AEAD
	pwReady bool
)

// SetPasswordEncryptionKey 在 main.go 启动时调一次，传入 base64 编码的 32 字节 key。
// 空字符串 → 加密功能 disabled，所有 Encrypt/Decrypt passthrough。
//
// 安全 note：key 从 env 直接来；如果 env 文件 mode 是 644，则任何 admin 用户都能读
// （和密码明文风险类似）。生产应保证 /etc/incus-admin/incus-admin.env 至少 600。
func SetPasswordEncryptionKey(b64 string) error {
	var initErr error
	pwOnce.Do(func() {
		b64 = strings.TrimSpace(b64)
		if b64 == "" {
			slog.Warn("vms.password encryption disabled (INCUS_PASSWORD_ENCRYPTION_KEY empty); passthrough mode")
			return
		}
		key, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			initErr = fmt.Errorf("decode INCUS_PASSWORD_ENCRYPTION_KEY (base64 expected): %w", err)
			return
		}
		if len(key) != 32 {
			initErr = fmt.Errorf("INCUS_PASSWORD_ENCRYPTION_KEY must be 32 bytes after base64 decode (got %d); generate via 'openssl rand -base64 32'", len(key))
			return
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			initErr = fmt.Errorf("new aes cipher: %w", err)
			return
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			initErr = fmt.Errorf("new gcm: %w", err)
			return
		}
		pwAEAD = aead
		pwReady = true
		slog.Info("vms.password encryption enabled (AES-256-GCM)")
	})
	return initErr
}

// PasswordEncryptionEnabled 返回当前是否启用加密。给 migration / 健康检查用。
func PasswordEncryptionEnabled() bool { return pwReady }

// EncryptPassword 把明文密码加密为 v1:<base64> 形式。空字符串原样返回。
// 加密未启用 → passthrough（明文存 DB，向后兼容）。
func EncryptPassword(plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	if !pwReady {
		return plaintext, nil
	}
	nonce := make([]byte, pwAEAD.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("nonce: %w", err)
	}
	ct := pwAEAD.Seal(nil, nonce, []byte(plaintext), nil)
	out := make([]byte, 0, len(nonce)+len(ct))
	out = append(out, nonce...)
	out = append(out, ct...)
	return passwordCipherPrefix + base64.StdEncoding.EncodeToString(out), nil
}

// DecryptPassword 反向操作。无 v1: 前缀 → 视为遗留明文，原样返回（warn 日志）。
// 解密失败（key 错 / 篡改）→ 返回 ("", err)，调用方决定如何处理（通常忽略密码字段）。
func DecryptPassword(stored string) (string, error) {
	if stored == "" {
		return "", nil
	}
	if !strings.HasPrefix(stored, passwordCipherPrefix) {
		// 遗留明文：migration 完成前会临时存在；migration 后应该没有了。
		// 不视为错误，原样返回。
		return stored, nil
	}
	if !pwReady {
		// 有 v1: 前缀但 key 没配 —— 配置错误；返回错误避免静默泄露 v1 串
		return "", errors.New("encrypted password found but encryption key not configured")
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(stored, passwordCipherPrefix))
	if err != nil {
		return "", fmt.Errorf("base64 decode: %w", err)
	}
	ns := pwAEAD.NonceSize()
	if len(raw) < ns {
		return "", errors.New("ciphertext too short")
	}
	nonce, ct := raw[:ns], raw[ns:]
	pt, err := pwAEAD.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", fmt.Errorf("gcm open: %w", err)
	}
	return string(pt), nil
}
