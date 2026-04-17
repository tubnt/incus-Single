import { useMutation, useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

export interface CephStatus {
  health?: { status: string };
  osdmap?: { num_osds: number; num_up_osds: number; num_in_osds: number };
  pgmap?: {
    num_pgs: number;
    num_pools: number;
    data_bytes: number;
    bytes_used: number;
    bytes_avail: number;
    bytes_total: number;
    read_bytes_sec: number;
    write_bytes_sec: number;
    read_op_per_sec: number;
    write_op_per_sec: number;
  };
  error?: string;
}

export interface OSDTreeNode {
  id: number;
  name: string;
  type: string;
  status?: string;
  crush_weight?: number;
  children?: number[];
}

export interface OSDTree {
  nodes?: OSDTreeNode[];
  error?: string;
}

export interface CephPool {
  pool_name: string;
  pool_id: number;
  type: string | number;
  size: number;
  pg_num: number;
  application_metadata?: Record<string, Record<string, unknown>>;
}

export interface CreatePoolParams {
  name: string;
  pg_num: number;
  type: string;
}

export const storageKeys = {
  all: ["storage"] as const,
  cephStatus: () => [...storageKeys.all, "cephStatus"] as const,
  osdTree: () => [...storageKeys.all, "osdTree"] as const,
  pools: () => [...storageKeys.all, "pools"] as const,
};

export function useCephStatusQuery() {
  return useQuery({
    queryKey: storageKeys.cephStatus(),
    queryFn: () => http.get<CephStatus>("/admin/ceph/status"),
    refetchInterval: 30_000,
  });
}

export function useOSDTreeQuery() {
  return useQuery({
    queryKey: storageKeys.osdTree(),
    queryFn: () => http.get<OSDTree>("/admin/ceph/osd-tree"),
    refetchInterval: 60_000,
  });
}

export function useCephPoolsQuery() {
  return useQuery({
    queryKey: storageKeys.pools(),
    queryFn: () => http.get<CephPool[]>("/admin/ceph/pools"),
    refetchInterval: 60_000,
  });
}

export function useCreateCephPoolMutation() {
  return useMutation({
    mutationFn: (params: CreatePoolParams) => http.post("/admin/ceph/pools", params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storageKeys.all }),
  });
}

export function useDeleteCephPoolMutation() {
  return useMutation({
    mutationFn: (name: string) => http.delete(`/admin/ceph/pools/${name}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storageKeys.all }),
  });
}

export function useOSDOutMutation() {
  return useMutation({
    mutationFn: (osdId: string) => http.post(`/admin/ceph/osd/${osdId}/out`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storageKeys.all }),
  });
}

export function useOSDInMutation() {
  return useMutation({
    mutationFn: (osdId: string) => http.post(`/admin/ceph/osd/${osdId}/in`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storageKeys.all }),
  });
}
