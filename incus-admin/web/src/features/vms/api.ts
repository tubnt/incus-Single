import { useMutation, useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

// VMService mirrors the backend VMServiceDTO. The password field is
// intentionally absent — credentials are only returned in create/reset
// responses, never from list/detail endpoints.
export interface VMService {
  id: number;
  name: string;
  cluster: string;
  cluster_display_name: string;
  project: string;
  ip: string | null;
  status: string;
  cpu: number;
  memory_mb: number;
  disk_gb: number;
  os_image: string;
  node: string;
  created_at: string;
  updated_at: string;
}

export interface IncusInstance {
  name: string;
  status: string;
  type: string;
  location: string;
  project: string;
  config: Record<string, string>;
  ip?: string;
  state?: {
    network?: Record<string, {
      addresses: Array<{ address: string; family: string; scope: string }>;
    }>;
  };
}

export interface ClusterVMsResponse {
  vms: IncusInstance[];
  count: number;
  stale?: boolean;
  cached_at?: string;
  error?: string;
  warning?: string;
}

export interface IncusInstanceState {
  status: string;
  cpu?: { usage: number };
  memory?: { usage: number; usage_peak: number; total: number };
  network?: Record<string, {
    addresses: Array<{ address: string; family: string; scope: string }>;
  }>;
}

export interface IncusSnapshot {
  name: string;
  created_at: string;
  stateful?: boolean;
}

export interface AdminVMDetail {
  vm: IncusInstance;
  state: IncusInstanceState;
  snapshots: IncusSnapshot[];
  project: string;
  db: VMService | null;
}

// Cache key prefix so list + detail invalidate together:
//   ["vm", "list", "my"]      portal list
//   ["vm", "detail", id]      portal detail
//   ["vm", "list", "cluster", name]  admin cluster list
//   ["vm", "detail", "cluster", name, vmName, project]  admin single-vm detail
export const vmKeys = {
  all: ["vm"] as const,
  myList: () => [...vmKeys.all, "list", "my"] as const,
  myDetail: (id: number) => [...vmKeys.all, "detail", id] as const,
  clusterList: (clusterName: string) => [...vmKeys.all, "list", "cluster", clusterName] as const,
  clusterDetail: (clusterName: string, vmName: string, project?: string) =>
    [...vmKeys.all, "detail", "cluster", clusterName, vmName, project ?? ""] as const,
  gone: () => [...vmKeys.all, "gone"] as const,
};

/**
 * GoneVM is a DB row flagged by the PLAN-020 reconciler as 'gone' — the
 * Incus instance vanished out-of-band. Admin surfaces these for
 * investigation + force-delete. Payload shape matches the server's
 * internal/model.VM but drops fields the panel doesn't render.
 */
export interface GoneVM {
  id: number;
  name: string;
  cluster_id: number;
  user_id: number;
  ip: string | null;
  status: string;
  cpu: number;
  memory_mb: number;
  disk_gb: number;
  os_image: string;
  node: string;
  created_at: string;
  updated_at: string;
}

export function useGoneVMsQuery() {
  return useQuery({
    queryKey: vmKeys.gone(),
    queryFn: () => http.get<{ vms: GoneVM[]; count: number }>("/admin/vms/gone"),
    staleTime: 30_000,
  });
}

export function useForceDeleteGoneVMMutation() {
  return useMutation({
    mutationFn: (id: number) =>
      http.post<{ status: string; id: number }>(`/admin/vms/${id}/force-delete`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vmKeys.gone() }),
  });
}

export function useMyVMsQuery() {
  return useQuery({
    queryKey: vmKeys.myList(),
    queryFn: () => http.get<{ vms: VMService[] }>("/portal/services"),
    refetchInterval: 15_000,
  });
}

export function useMyVMDetailQuery(id: number) {
  return useQuery({
    queryKey: vmKeys.myDetail(id),
    queryFn: () => http.get<{ vm: VMService }>(`/portal/services/${id}`),
    enabled: id > 0,
  });
}

export function useVMActionMutation(vmId: number) {
  return useMutation({
    mutationFn: (action: string) => http.post(`/portal/services/${vmId}/actions/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vmKeys.all }),
  });
}

export function useCreateVMMutation() {
  return useMutation({
    mutationFn: (params: { name?: string; cpu: number; memory_mb: number; disk_gb: number; os_image: string }) =>
      http.post("/portal/services", params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vmKeys.all }),
  });
}

export function useClusterVMsQuery(clusterName: string, refetchIntervalMs = 10_000) {
  return useQuery({
    queryKey: vmKeys.clusterList(clusterName),
    queryFn: () => http.get<ClusterVMsResponse>(`/admin/clusters/${clusterName}/vms`),
    enabled: !!clusterName,
    refetchInterval: refetchIntervalMs,
    retry: 1,
  });
}

export function useAdminVMDetailQuery(
  clusterName: string,
  vmName: string,
  project?: string,
  refetchIntervalMs = 10_000,
) {
  return useQuery({
    queryKey: vmKeys.clusterDetail(clusterName, vmName, project),
    queryFn: () => {
      const qs = project ? `?project=${encodeURIComponent(project)}` : "";
      return http.get<AdminVMDetail>(
        `/admin/clusters/${clusterName}/vms/${vmName}${qs}`,
      );
    },
    enabled: !!clusterName && !!vmName,
    refetchInterval: refetchIntervalMs,
    retry: 1,
  });
}

export function useVMStateMutation() {
  return useMutation({
    mutationFn: (params: { name: string; action: string; cluster: string; project: string }) =>
      http.put(`/admin/vms/${params.name}/state`, params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vmKeys.all }),
  });
}

export function useDeleteVMMutation() {
  return useMutation({
    mutationFn: (params: { name: string; cluster: string; project: string }) =>
      http.delete(
        `/admin/vms/${params.name}`,
        { cluster: params.cluster, project: params.project },
        {
          intent: {
            action: "vm.delete",
            args: { name: params.name, cluster: params.cluster, project: params.project },
            description: `删除 VM ${params.name}`,
          },
        },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vmKeys.all }),
  });
}

// PLAN-023: 批量动作。后端 step-up gated；前端在 mutationFn 内显式 saveIntent。
export type BatchVMAction = "delete" | "start" | "stop" | "restart";

export interface BatchVMParams {
  names: string[];
  cluster: string;
  project?: string;
  action: BatchVMAction;
}

// 与后端 batchutil.Response[K] 对齐：succeeded 是 key 数组，failed 是 {key, error} 数组。
export interface BatchVMResult {
  total: number;
  succeeded: string[];
  failed: Array<{ key: string; error: string }>;
}

export function useBatchVMMutation() {
  return useMutation({
    mutationFn: (params: BatchVMParams) =>
      http.post<BatchVMResult>(
        "/admin/vms:batch",
        {
          names: params.names,
          cluster: params.cluster,
          project: params.project,
          action: params.action,
        },
        {
          intent: {
            action: `vm.batch_${params.action}`,
            args: {
              names: params.names,
              cluster: params.cluster,
              project: params.project,
              action: params.action,
            },
            description: `批量 ${params.action} ${params.names.length} 台 VM`,
          },
        },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vmKeys.all }),
  });
}

export function useMigrateVMMutation() {
  return useMutation({
    mutationFn: (params: { name: string; cluster: string; project: string; target_node: string }) =>
      http.post(
        `/admin/vms/${params.name}/migrate`,
        {
          cluster: params.cluster,
          project: params.project,
          target_node: params.target_node,
        },
        {
          intent: {
            action: "vm.migrate",
            args: params as unknown as Record<string, unknown>,
            description: `迁移 VM ${params.name} → ${params.target_node}`,
          },
        },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vmKeys.all }),
  });
}

// PLAN-021 Phase D — rescue mode is a DB-owned state column; frontend reads
// it off the admin VMs endpoint (when exposed) and uses these hooks to
// enter / exit.
export interface RescueEnterResponse {
  status: string;
  vm_id: number;
  vm_name: string;
  snapshot: string;
  note: string;
}

export interface RescueExitParams {
  restore: boolean;
  delete_snapshot?: boolean;
}

export function useRescueEnterByNameMutation() {
  return useMutation({
    mutationFn: (vmName: string) =>
      http.post<RescueEnterResponse>(`/admin/vms/by-name/${vmName}/rescue/enter`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vmKeys.all }),
  });
}

export function useRescueExitByNameMutation(vmName: string) {
  return useMutation({
    mutationFn: (params: RescueExitParams) =>
      http.post(`/admin/vms/by-name/${vmName}/rescue/exit`, params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vmKeys.all }),
  });
}

// Reinstall payload supports two forms — template_slug (preferred, PLAN-021
// Phase B) and legacy os_image (pre-B callers). Backend picks whichever is
// present; at least one must be set.
export interface ReinstallVMParams {
  name: string;
  cluster: string;
  project: string;
  template_slug?: string;
  os_image?: string;
}

export function useReinstallVMMutation() {
  return useMutation({
    mutationFn: (params: ReinstallVMParams) =>
      http.post<{ status: string; password: string; username: string }>(
        `/admin/vms/${params.name}/reinstall`,
        {
          cluster: params.cluster,
          project: params.project,
          template_slug: params.template_slug,
          os_image: params.os_image,
        },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vmKeys.all }),
  });
}

export interface AdminCreateVMParams {
  cpu: number;
  memory_mb: number;
  disk_gb: number;
  os_image: string;
  project: string;
}

export interface AdminCreateVMResult {
  vm_name: string;
  ip: string;
  username: string;
  password: string;
}

export function useAdminCreateVMMutation(clusterName: string) {
  return useMutation({
    mutationFn: (params: AdminCreateVMParams) =>
      http.post<AdminCreateVMResult>(`/admin/clusters/${clusterName}/vms`, params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vmKeys.all }),
  });
}

export interface ResetPasswordResult {
  password: string;
  username: string;
  // PLAN-021 Phase C backend additions. Older responses will have these
  // undefined; the UI treats that as "auto mode, online channel".
  channel?: "auto" | "online" | "offline";
  fallback?: boolean;
}

export type ResetPasswordMode = "auto" | "online" | "offline";

export function useResetVMPasswordMutation(vmId: number) {
  return useMutation({
    mutationFn: (mode?: ResetPasswordMode) =>
      http.post<ResetPasswordResult>(`/portal/services/${vmId}/reset-password`, mode ? { mode } : {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vmKeys.myDetail(vmId) }),
  });
}

// Reinstall from the user (portal) side. Uses the same template_slug wire
// format as the admin path; backend resolves the slug through os_templates.
export interface PortalReinstallResult {
  status: string;
  password: string;
  username: string;
}

export function usePortalReinstallVMMutation(vmId: number) {
  return useMutation({
    mutationFn: (params: { template_slug?: string; os_image?: string }) =>
      http.post<PortalReinstallResult>(`/portal/services/${vmId}/reinstall`, params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vmKeys.all }),
  });
}

// Portal rescue — id-keyed with server-side owner check. Mirrors the
// admin by-name hooks but uses a numeric id the portal UI already has.
export interface PortalRescueEnterResponse {
  status: string;
  vm_id: number;
  vm_name: string;
  snapshot: string;
  note: string;
}

export function usePortalRescueEnterMutation(vmId: number) {
  return useMutation({
    mutationFn: () =>
      http.post<PortalRescueEnterResponse>(`/portal/services/${vmId}/rescue/enter`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vmKeys.myDetail(vmId) }),
  });
}

export function usePortalRescueExitMutation(vmId: number) {
  return useMutation({
    mutationFn: (params: RescueExitParams) =>
      http.post(`/portal/services/${vmId}/rescue/exit`, params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vmKeys.myDetail(vmId) }),
  });
}

// Admin reset password (name-keyed, matches reinstall/migrate convention).
// Accepts an optional mode; backend defaults to "auto" when omitted.
export function useAdminResetPasswordByNameMutation(vmName: string) {
  return useMutation({
    mutationFn: (params: { cluster: string; project: string; username?: string; mode?: ResetPasswordMode }) =>
      http.post<ResetPasswordResult>(`/admin/vms/${vmName}/reset-password`, params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vmKeys.all }),
  });
}

export function extractIP(vm: IncusInstance): string {
  if (!vm.state?.network) return "";
  for (const [nic, data] of Object.entries(vm.state.network)) {
    if (nic === "lo") continue;
    for (const addr of data.addresses) {
      if (addr.family === "inet" && addr.scope === "global") return addr.address;
    }
  }
  return "";
}
