package portal

import (
	"testing"

	"github.com/incuscloud/incus-admin/internal/model"
)

// TestApplyOSTemplatePatch covers the PATCH merge semantics used by Update.
// Any field omitted from the request must leave the existing value untouched;
// fields present (even zero-valued bools / empty strings) must overwrite.
func TestApplyOSTemplatePatch(t *testing.T) {
	base := model.OSTemplate{
		ID:                7,
		Slug:              "ubuntu-24-04",
		Name:              "Ubuntu 24.04 LTS",
		Source:            "ubuntu/24.04/cloud",
		Protocol:          "simplestreams",
		ServerURL:         "https://images.linuxcontainers.org",
		DefaultUser:       "ubuntu",
		CloudInitTemplate: "",
		SupportsRescue:    false,
		Enabled:           true,
		SortOrder:         10,
	}

	newSlug := "ubuntu-24-04-renamed"
	falseVal := false
	zero := 0

	tests := []struct {
		name   string
		patch  updateOSTemplateReq
		expect func(t *testing.T, got model.OSTemplate)
	}{
		{
			name:  "empty patch keeps all fields",
			patch: updateOSTemplateReq{},
			expect: func(t *testing.T, got model.OSTemplate) {
				if got != base {
					t.Fatalf("expected unchanged, got %+v", got)
				}
			},
		},
		{
			name:  "slug only",
			patch: updateOSTemplateReq{Slug: &newSlug},
			expect: func(t *testing.T, got model.OSTemplate) {
				if got.Slug != newSlug {
					t.Fatalf("slug not applied: %q", got.Slug)
				}
				if got.Name != base.Name {
					t.Fatalf("name changed unexpectedly")
				}
			},
		},
		{
			name:  "enabled false is respected (pointer guards zero value)",
			patch: updateOSTemplateReq{Enabled: &falseVal},
			expect: func(t *testing.T, got model.OSTemplate) {
				if got.Enabled {
					t.Fatalf("enabled should be false")
				}
			},
		},
		{
			name:  "sort order zero is respected",
			patch: updateOSTemplateReq{SortOrder: &zero},
			expect: func(t *testing.T, got model.OSTemplate) {
				if got.SortOrder != 0 {
					t.Fatalf("sort_order expected 0, got %d", got.SortOrder)
				}
			},
		},
		{
			name: "full update",
			patch: updateOSTemplateReq{
				Slug:   strptr("debian-12"),
				Name:   strptr("Debian 12"),
				Source: strptr("debian/12/cloud"),
			},
			expect: func(t *testing.T, got model.OSTemplate) {
				if got.Slug != "debian-12" || got.Name != "Debian 12" || got.Source != "debian/12/cloud" {
					t.Fatalf("merge missed fields: %+v", got)
				}
				if got.DefaultUser != base.DefaultUser {
					t.Fatalf("default_user clobbered")
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := base
			applyOSTemplatePatch(&got, tt.patch)
			tt.expect(t, got)
		})
	}
}

func strptr(s string) *string { return &s }
