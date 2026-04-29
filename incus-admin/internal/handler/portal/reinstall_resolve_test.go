package portal

import (
	"context"
	"testing"
)

// TestResolveReinstallTemplate covers the legacy os_image path and the
// no-input rejection. The template_slug branch relies on osTemplateRepo being
// wired (package-level), which isn't safe to set from a pure unit test; that
// path is covered by integration/E2E tests against the real DB.
func TestResolveReinstallTemplate(t *testing.T) {
	tests := []struct {
		name     string
		slug     string
		osImage  string
		wantErr  bool
		wantSrc  string
		wantUser string
	}{
		{
			name:    "empty slug and image returns error",
			wantErr: true,
		},
		{
			name:     "legacy images: prefix stripped, ubuntu default user",
			osImage:  "images:ubuntu/24.04/cloud",
			wantSrc:  "ubuntu/24.04/cloud",
			wantUser: "ubuntu",
		},
		{
			name:     "legacy debian source picks debian user",
			osImage:  "images:debian/12/cloud",
			wantSrc:  "debian/12/cloud",
			wantUser: "debian",
		},
		{
			name:     "legacy rocky source picks rocky user",
			osImage:  "images:rockylinux/9/cloud",
			wantSrc:  "rockylinux/9/cloud",
			wantUser: "rocky",
		},
		{
			name:     "legacy almalinux source picks almalinux user",
			osImage:  "images:almalinux/9/cloud",
			wantSrc:  "almalinux/9/cloud",
			wantUser: "almalinux",
		},
		{
			name:     "legacy arch source picks arch user",
			osImage:  "images:archlinux/current/cloud",
			wantSrc:  "archlinux/current/cloud",
			wantUser: "arch",
		},
		{
			name:     "raw source without images: prefix is passed through",
			osImage:  "fedora/40/cloud",
			wantSrc:  "fedora/40/cloud",
			wantUser: "fedora",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// osTemplateRepo is package-level; with it nil, the slug branch
			// becomes a no-op and falls through to the legacy os_image path.
			got, err := resolveReinstallTemplate(context.Background(), tt.slug, tt.osImage)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil; params=%+v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.ImageSource != tt.wantSrc {
				t.Fatalf("ImageSource: want %q, got %q", tt.wantSrc, got.ImageSource)
			}
			if got.DefaultUser != tt.wantUser {
				t.Fatalf("DefaultUser: want %q, got %q", tt.wantUser, got.DefaultUser)
			}
		})
	}
}

func TestDefaultUserForSource(t *testing.T) {
	cases := map[string]string{
		"ubuntu/24.04/cloud":       "ubuntu",
		"UBUNTU/22.04/cloud":       "ubuntu",
		"debian/12/cloud":          "debian",
		"rockylinux/9/cloud":       "rocky",
		"almalinux/9/cloud":        "almalinux",
		"centos/7/cloud":           "centos",
		"fedora/40/cloud":          "fedora",
		"opensuse/15/cloud":        "opensuse",
		"archlinux/current/cloud":  "arch",
		"alpine/3.19/cloud":        "alpine",
		"freebsd/14/cloud":         "freebsd",
		"unknown/something":        "ubuntu",
	}
	for src, wantUser := range cases {
		if got := defaultUserForSource(src); got != wantUser {
			t.Errorf("src=%q: want %q, got %q", src, wantUser, got)
		}
	}
}
