package sshexec

import (
	"errors"
	"fmt"
	"os"

	"golang.org/x/crypto/ssh"
)

// CredKind enumerates the supported SSH authentication forms. PLAN-033 Phase A1.
type CredKind string

const (
	CredKindKeyFile    CredKind = "key_file"
	CredKindPrivateKey CredKind = "private_key"
	CredKindPassword   CredKind = "password"
)

// Credential holds material for one SSH authentication attempt. The struct is
// intentionally a small bag of fields rather than an interface so it can be
// passed across goroutines, persisted into the in-memory job params map, and
// cleared with Wipe() on exit. Callers should treat the struct as
// single-owner and call Wipe when done; do NOT share the same Credential
// across long-lived runners (the Wipe of one will zero the bytes under the
// other).
type Credential struct {
	Kind       CredKind
	KeyFile    string // CredKindKeyFile: absolute path on the admin host
	KeyData    []byte // CredKindPrivateKey: PEM-encoded private key
	Password   string // CredKindPassword: plain-text password
	Passphrase string // optional: only for encrypted PEM under CredKindPrivateKey
}

// CredentialFromKeyFile is the convenience constructor used by all legacy
// call sites that still pass a key file path.
func CredentialFromKeyFile(path string) Credential {
	return Credential{Kind: CredKindKeyFile, KeyFile: path}
}

// Validate gives a quick precondition check before the runner attempts to dial.
// Returns a typed error so handlers can map it to 400 vs 500.
func (c *Credential) Validate() error {
	if c == nil {
		return errors.New("credential is nil")
	}
	switch c.Kind {
	case CredKindKeyFile:
		if c.KeyFile == "" {
			return errors.New("key_file is required for key_file credential")
		}
	case CredKindPrivateKey:
		if len(c.KeyData) == 0 {
			return errors.New("key_data is required for private_key credential")
		}
	case CredKindPassword:
		if c.Password == "" {
			return errors.New("password is required for password credential")
		}
	default:
		return fmt.Errorf("unsupported credential kind %q", c.Kind)
	}
	return nil
}

// authMethods materialises ssh.AuthMethod objects for this credential.
// File reads / PEM parsing happen here so failures map cleanly to "auth setup"
// rather than "dial".
func (c *Credential) authMethods() ([]ssh.AuthMethod, error) {
	if err := c.Validate(); err != nil {
		return nil, err
	}
	switch c.Kind {
	case CredKindPassword:
		return []ssh.AuthMethod{ssh.Password(c.Password)}, nil
	case CredKindPrivateKey:
		signer, err := parsePrivateKey(c.KeyData, c.Passphrase)
		if err != nil {
			return nil, err
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
	case CredKindKeyFile:
		raw, err := os.ReadFile(c.KeyFile)
		if err != nil {
			return nil, fmt.Errorf("read key file: %w", err)
		}
		signer, err := parsePrivateKey(raw, c.Passphrase)
		if err != nil {
			return nil, err
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
	default:
		return nil, fmt.Errorf("unsupported credential kind %q", c.Kind)
	}
}

// Wipe zeroes the in-memory secret material. Safe to call on a nil receiver.
// Note: Go strings are immutable and we cannot zero the Password backing
// array reliably; the best we can do is drop the reference. KeyData is a
// byte slice we own and can clear.
func (c *Credential) Wipe() {
	if c == nil {
		return
	}
	for i := range c.KeyData {
		c.KeyData[i] = 0
	}
	c.KeyData = nil
	c.Password = ""
	c.Passphrase = ""
}

// Clone returns a deep copy so the original can be wiped independently.
// Used when a credential needs to outlive its caller (e.g. job runtime
// captures the cred for the duration of a 30-min job).
func (c *Credential) Clone() *Credential {
	if c == nil {
		return nil
	}
	cp := *c
	if c.KeyData != nil {
		cp.KeyData = append([]byte(nil), c.KeyData...)
	}
	return &cp
}

// parsePrivateKey wraps ssh.ParsePrivateKey + WithPassphrase variants.
func parsePrivateKey(pem []byte, passphrase string) (ssh.Signer, error) {
	if passphrase != "" {
		signer, err := ssh.ParsePrivateKeyWithPassphrase(pem, []byte(passphrase))
		if err != nil {
			return nil, fmt.Errorf("parse encrypted private key: %w", err)
		}
		return signer, nil
	}
	signer, err := ssh.ParsePrivateKey(pem)
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}
	return signer, nil
}
