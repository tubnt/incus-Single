import { useMutation, useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

export interface FloatingIP {
  id: number;
  cluster_id: number;
  ip: string;
  bound_vm_id?: number | null;
  status: "available" | "attached";
  description: string;
  allocated_at: string;
  attached_at?: string | null;
  detached_at?: string | null;
}

export interface AttachFloatingIPResponse {
  status: string;
  ip: string;
  vm_id: number;
  vm_name: string;
  runbook_hint: string;
  runbook_note: string;
}

export interface DetachFloatingIPResponse {
  status: string;
  id: number;
  ip: string;
  runbook_hint: string;
}

export const floatingIPKeys = {
  all: ["floating-ip"] as const,
  list: () => [...floatingIPKeys.all, "list"] as const,
};

export function useFloatingIPsQuery() {
  return useQuery({
    queryKey: floatingIPKeys.list(),
    queryFn: () => http.get<{ floating_ips: FloatingIP[] }>("/admin/floating-ips"),
  });
}

export function useAllocateFloatingIPMutation() {
  return useMutation({
    mutationFn: (data: { cluster: string; ip: string; description: string }) =>
      http.post<{ floating_ip: FloatingIP }>("/admin/floating-ips", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: floatingIPKeys.all }),
  });
}

export function useReleaseFloatingIPMutation(id: number) {
  return useMutation({
    mutationFn: () => http.delete(`/admin/floating-ips/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: floatingIPKeys.all }),
  });
}

export function useAttachFloatingIPMutation(id: number) {
  return useMutation({
    mutationFn: (vmID: number) =>
      http.post<AttachFloatingIPResponse>(`/admin/floating-ips/${id}/attach`, { vm_id: vmID }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: floatingIPKeys.all }),
  });
}

export function useDetachFloatingIPMutation(id: number) {
  return useMutation({
    mutationFn: () => http.post<DetachFloatingIPResponse>(`/admin/floating-ips/${id}/detach`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: floatingIPKeys.all }),
  });
}

// PLAN-023 Phase B: 批量 release / detach。step-up gated by middleware。
export type BatchFIPAction = "release" | "detach";

export interface BatchFIPResult {
  total: number;
  succeeded: number[];
  failed: Array<{ key: number; error: string }>;
}

export function useBatchFloatingIPMutation() {
  return useMutation({
    mutationFn: (params: { ids: number[]; action: BatchFIPAction }) =>
      http.post<BatchFIPResult>(
        "/admin/floating-ips:batch",
        { ids: params.ids, action: params.action },
        {
          intent: {
            action: `floating_ip.batch_${params.action}`,
            args: { ids: params.ids, action: params.action },
            description: `批量 ${params.action} ${params.ids.length} 个 Floating IP`,
          },
        },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: floatingIPKeys.all }),
  });
}
