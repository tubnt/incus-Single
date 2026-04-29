import { useMutation, useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

export interface OSTemplate {
  id: number;
  slug: string;
  name: string;
  source: string;
  protocol: string;
  server_url: string;
  default_user: string;
  cloud_init_template: string;
  supports_rescue: boolean;
  enabled: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export type OSTemplateFormData = Omit<OSTemplate, "id" | "created_at" | "updated_at">;
export type OSTemplatePatch = Partial<OSTemplateFormData>;

export const osTemplateKeys = {
  all: ["os-template"] as const,
  portalList: () => [...osTemplateKeys.all, "list", "portal"] as const,
  adminList: () => [...osTemplateKeys.all, "list", "admin"] as const,
};

// Portal-facing list — returns only enabled templates. Used by VM create +
// reinstall flows to populate the OS picker.
export function useOSTemplatesQuery() {
  return useQuery({
    queryKey: osTemplateKeys.portalList(),
    queryFn: () => http.get<{ templates: OSTemplate[] }>("/portal/os-templates"),
    staleTime: 60_000,
  });
}

export function useAdminOSTemplatesQuery() {
  return useQuery({
    queryKey: osTemplateKeys.adminList(),
    queryFn: () => http.get<{ templates: OSTemplate[] }>("/admin/os-templates"),
  });
}

export function useCreateOSTemplateMutation() {
  return useMutation({
    mutationFn: (data: OSTemplateFormData) => http.post("/admin/os-templates", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: osTemplateKeys.all }),
  });
}

export function useUpdateOSTemplateMutation(id: number) {
  return useMutation({
    mutationFn: (data: OSTemplatePatch) => http.put(`/admin/os-templates/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: osTemplateKeys.all }),
  });
}

export function useDeleteOSTemplateMutation(id: number) {
  return useMutation({
    mutationFn: () => http.delete(`/admin/os-templates/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: osTemplateKeys.all }),
  });
}

// The wire-level image value is "images:<source>" — Incus picks it up as a
// simplestreams alias. We keep the prefix in the picker value so the billing,
// create-vm and admin pages can keep passing it through to the backend
// untouched until Phase B rewires them to send template_slug instead.
export function imageValueFromTemplate(t: OSTemplate): string {
  return `images:${t.source}`;
}
