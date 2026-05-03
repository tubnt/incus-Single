package sshexec

import (
	"testing"
)

func TestCredential_Validate(t *testing.T) {
	cases := []struct {
		name string
		c    Credential
		ok   bool
	}{
		{"keyfile ok", Credential{Kind: CredKindKeyFile, KeyFile: "/etc/key"}, true},
		{"keyfile empty", Credential{Kind: CredKindKeyFile}, false},
		{"private_key ok", Credential{Kind: CredKindPrivateKey, KeyData: []byte("PEM")}, true},
		{"private_key empty", Credential{Kind: CredKindPrivateKey}, false},
		{"password ok", Credential{Kind: CredKindPassword, Password: "x"}, true},
		{"password empty", Credential{Kind: CredKindPassword}, false},
		{"unknown kind", Credential{Kind: "agent"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.c.Validate()
			if (err == nil) != tc.ok {
				t.Fatalf("got err=%v, want ok=%v", err, tc.ok)
			}
		})
	}
}

func TestCredential_WipeClearsBytes(t *testing.T) {
	data := []byte("super-secret-pem")
	c := &Credential{Kind: CredKindPrivateKey, KeyData: data}
	c.Wipe()
	for i, b := range data {
		if b != 0 {
			t.Fatalf("byte %d not wiped: %x", i, b)
		}
	}
	if c.KeyData != nil {
		t.Fatal("KeyData should be nil after Wipe")
	}
}

func TestCredential_CloneIsolatesKeyData(t *testing.T) {
	orig := &Credential{Kind: CredKindPrivateKey, KeyData: []byte("pem")}
	clone := orig.Clone()
	clone.KeyData[0] = 'X'
	if orig.KeyData[0] == 'X' {
		t.Fatal("Clone shared underlying byte slice with original")
	}
}
