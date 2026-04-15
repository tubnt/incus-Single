import { useMutation, useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

export interface VMService {
  id: number;
  name: string;
  ip: string | null;
  status: string;
  cpu: number;
  memory_mb: number;
  disk_gb: number;
  os_image: string;
  node: string;
  password: string;
  created_at: string;
}

export interface IncusInstance {
  name: string;
  status: string;
  type: string;
  location: string;
  project: string;
  config: Record<string, string>;
  state?: {
    network?: Record<string, {
      addresses: Array<{ address: string; family: string; scope: string }>;
    }>;
  };
}

export function useMyVMsQuery() {
  return useQuery({
    queryKey: ["myServices"],
    queryFn: () => http.get<{ services: VMService[] }>("/portal/services"),
    refetchInterval: 15_000,
  });
}

export function useVMActionMutation(vmId: number) {
  return useMutation({
    mutationFn: (action: string) => http.post(`/portal/services/${vmId}/actions/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["myServices"] }),
  });
}

export function useCreateVMMutation() {
  return useMutation({
    mutationFn: (params: { name?: string; cpu: number; memory_mb: number; disk_gb: number; os_image: string }) =>
      http.post("/portal/services", params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["myServices"] }),
  });
}

export function useAdminClustersQuery() {
  return useQuery({
    queryKey: ["adminClusters"],
    queryFn: () => http.get<{ clusters: Array<{ name: string; display_name: string }> }>("/admin/clusters"),
  });
}

export function useClusterVMsQuery(clusterName: string) {
  return useQuery({
    queryKey: ["adminClusterVMs", clusterName],
    queryFn: () => http.get<{ vms: IncusInstance[]; count: number }>(`/admin/clusters/${clusterName}/vms`),
    refetchInterval: 10_000,
  });
}

export function useVMStateMutation() {
  return useMutation({
    mutationFn: (params: { name: string; action: string; cluster: string; project: string }) =>
      http.put(`/admin/vms/${params.name}/state`, params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["adminClusterVMs"] }),
  });
}

export function useDeleteVMMutation() {
  return useMutation({
    mutationFn: (params: { name: string; cluster: string; project: string }) =>
      http.delete(`/admin/vms/${params.name}`, { cluster: params.cluster, project: params.project }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["adminClusterVMs"] }),
  });
}

export function useReinstallVMMutation() {
  return useMutation({
    mutationFn: (params: { name: string; cluster: string; project: string; os_image: string }) =>
      http.post<{ status: string; password: string; username: string }>(`/admin/vms/${params.name}/reinstall`, params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["adminClusterVMs"] }),
  });
}

export function useAdminCreateVMMutation() {
  return useMutation({
    mutationFn: (params: { clusterName: string; data: Record<string, unknown> }) =>
      http.post(`/admin/clusters/${params.clusterName}/vms`, params.data),
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
