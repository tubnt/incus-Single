package portal

import (
	"context"
	"fmt"
	"strings"

	"github.com/incuscloud/incus-admin/internal/service"
)

// resolveReinstallTemplate turns a {template_slug, os_image} pair into the
// four fields service.ReinstallParams needs. Call it with empty strings and it
// returns an error so callers can refuse requests that didn't pick anything.
//
// Precedence:
//  1. template_slug → DB lookup (authoritative)
//  2. os_image (legacy wire, stripped of "images:" prefix) with heuristics
//     for default_user based on the distro prefix.
func resolveReinstallTemplate(ctx context.Context, templateSlug, osImage string) (service.ReinstallParams, error) {
	params := service.ReinstallParams{}

	if templateSlug != "" && osTemplateRepo != nil {
		tpl, err := osTemplateRepo.GetBySlug(ctx, templateSlug)
		if err != nil {
			return params, fmt.Errorf("lookup template: %w", err)
		}
		if tpl == nil {
			return params, fmt.Errorf("template %q not found", templateSlug)
		}
		if !tpl.Enabled {
			return params, fmt.Errorf("template %q is disabled", templateSlug)
		}
		params.ImageSource = tpl.Source
		params.ServerURL = tpl.ServerURL
		params.Protocol = tpl.Protocol
		params.DefaultUser = tpl.DefaultUser
		return params, nil
	}

	if osImage == "" {
		return params, fmt.Errorf("template_slug or os_image is required")
	}
	source := strings.TrimPrefix(osImage, "images:")
	params.ImageSource = source
	params.DefaultUser = defaultUserForSource(source)
	return params, nil
}

// defaultUserForSource mirrors the distro→default-user map used by the
// frontend (web/src/features/vms/default-user.ts). We only hit this path for
// legacy os_image requests; once all callers send template_slug this branch
// becomes dead code.
func defaultUserForSource(source string) string {
	s := strings.ToLower(source)
	switch {
	case strings.Contains(s, "debian"):
		return "debian"
	case strings.Contains(s, "rocky"):
		return "rocky"
	case strings.Contains(s, "alma"):
		return "almalinux"
	case strings.Contains(s, "centos"):
		return "centos"
	case strings.Contains(s, "fedora"):
		return "fedora"
	case strings.Contains(s, "opensuse"):
		return "opensuse"
	case strings.Contains(s, "arch"):
		return "arch"
	case strings.Contains(s, "alpine"):
		return "alpine"
	case strings.Contains(s, "freebsd"):
		return "freebsd"
	default:
		return "ubuntu"
	}
}
