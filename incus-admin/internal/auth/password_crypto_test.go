package auth

import (
	"crypto/rand"
	"encoding/base64"
	"strings"
	"sync"
	"testing"
)

// resetPasswordCryptoState 在每个 test 之间重置 once / aead，否则同一进程内
// 多次 SetPasswordEncryptionKey 只第一次生效。
func resetPasswordCryptoState() {
	pwOnce = sync.Once{}
	pwAEAD = nil
	pwReady = false
}

func generateBase64Key(t *testing.T, n int) string {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return base64.StdEncoding.EncodeToString(b)
}

func TestPasswordEncryption_RoundTrip(t *testing.T) {
	resetPasswordCryptoState()
	if err := SetPasswordEncryptionKey(generateBase64Key(t, 32)); err != nil {
		t.Fatalf("SetPasswordEncryptionKey: %v", err)
	}
	if !PasswordEncryptionEnabled() {
		t.Fatal("encryption should be enabled after valid key")
	}

	cases := []string{"", "p@ssw0rd!", "中文密码🔒", strings.Repeat("a", 1024)}
	for _, p := range cases {
		enc, err := EncryptPassword(p)
		if err != nil {
			t.Fatalf("encrypt %q: %v", p, err)
		}
		if p != "" && !strings.HasPrefix(enc, "v1:") {
			t.Errorf("encrypted %q missing v1: prefix: %q", p, enc)
		}
		dec, err := DecryptPassword(enc)
		if err != nil {
			t.Fatalf("decrypt %q: %v", enc, err)
		}
		if dec != p {
			t.Errorf("round-trip mismatch: got %q, want %q", dec, p)
		}
	}
}

func TestPasswordEncryption_DisabledPassthrough(t *testing.T) {
	resetPasswordCryptoState()
	if err := SetPasswordEncryptionKey(""); err != nil {
		t.Fatalf("SetPasswordEncryptionKey empty: %v", err)
	}
	if PasswordEncryptionEnabled() {
		t.Fatal("encryption should be disabled with empty key")
	}
	enc, err := EncryptPassword("plain")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if enc != "plain" {
		t.Errorf("passthrough expected, got %q", enc)
	}
}

func TestPasswordEncryption_LegacyPlaintextRead(t *testing.T) {
	resetPasswordCryptoState()
	if err := SetPasswordEncryptionKey(generateBase64Key(t, 32)); err != nil {
		t.Fatalf("init: %v", err)
	}
	// Decrypt 遇到无 v1: 前缀的旧明文 → 原样返回（migration 期间过渡）
	got, err := DecryptPassword("legacy-plaintext")
	if err != nil {
		t.Fatalf("decrypt legacy: %v", err)
	}
	if got != "legacy-plaintext" {
		t.Errorf("got %q, want passthrough %q", got, "legacy-plaintext")
	}
}

func TestPasswordEncryption_EncryptedWithoutKey(t *testing.T) {
	resetPasswordCryptoState()
	// 第一阶段：配 key 后加密一个值
	if err := SetPasswordEncryptionKey(generateBase64Key(t, 32)); err != nil {
		t.Fatalf("init: %v", err)
	}
	enc, err := EncryptPassword("secret")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	// 第二阶段：模拟 key 被清空（重启但忘了配 env）→ Decrypt 应明确失败而非静默穿透
	resetPasswordCryptoState()
	if err := SetPasswordEncryptionKey(""); err != nil {
		t.Fatalf("init empty: %v", err)
	}
	_, err = DecryptPassword(enc)
	if err == nil {
		t.Fatal("expected error decrypting v1: ciphertext without key, got nil")
	}
}

func TestPasswordEncryption_BadKeyFormat(t *testing.T) {
	cases := []string{
		"not-base64!@#$",
		base64.StdEncoding.EncodeToString([]byte("only-16-bytes-ok")), // wrong length (16 vs 32)
	}
	for _, k := range cases {
		resetPasswordCryptoState()
		if err := SetPasswordEncryptionKey(k); err == nil {
			t.Errorf("expected error for bad key %q, got nil", k)
		}
	}
}
