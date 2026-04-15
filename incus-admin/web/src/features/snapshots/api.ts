import { useMutation, useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

export interface SnapshotInfo {
  name: string;
  created_at: string;
  stateful: boolean;
}

export function useSnapshotsQuery(vmName: string, cluster: string, project: string) {
  return useQuery({
    queryKey: ["snapshots", vmName, cluster, project],
    queryFn: () => http.get<{ snapshots: SnapshotInfo[] }>(`/admin/vms/${vmName}/snapshots`, { cluster, project }),
  });
}

export function useCreateSnapshotMutation(vmName: string) {
  return useMutation({
    mutationFn: (params: { cluster: string; project: string; name?: string }) =>
      http.post(`/admin/vms/${vmName}/snapshots`, params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["snapshots", vmName] }),
  });
}

export function useDeleteSnapshotMutation(vmName: string) {
  return useMutation({
    mutationFn: (params: { snap: string; cluster: string; project: string }) =>
      http.delete(`/admin/vms/${vmName}/snapshots/${params.snap}`, { cluster: params.cluster, project: params.project }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["snapshots", vmName] }),
  });
}

export function useRestoreSnapshotMutation(vmName: string) {
  return useMutation({
    mutationFn: (params: { snap: string; cluster: string; project: string }) =>
      http.post(`/admin/vms/${vmName}/snapshots/${params.snap}/restore`, { cluster: params.cluster, project: params.project }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["snapshots", vmName] }),
  });
}
