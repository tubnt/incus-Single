import { useMutation, useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

export interface PoolInfo {
  cluster_name: string;
  cidr: string;
  gateway: string;
  vlan: number;
  range: string;
  total: number;
  used: number;
  available: number;
}

export interface IPEntry {
  ip: string;
  vm: string;
  cluster: string;
  project: string;
  node: string;
  status: string;
}

export interface AddPoolParams {
  cluster: string;
  cidr: string;
  gateway: string;
  range: string;
  vlan: number;
}

export const ipPoolKeys = {
  all: ["ipPool"] as const,
  list: () => [...ipPoolKeys.all, "list"] as const,
};

export const ipRegistryKeys = {
  all: ["ipRegistry"] as const,
  list: () => [...ipRegistryKeys.all, "list"] as const,
};

export function useIPPoolsQuery() {
  return useQuery({
    queryKey: ipPoolKeys.list(),
    queryFn: () => http.get<{ pools: PoolInfo[] }>("/admin/ip-pools"),
  });
}

export function useAddIPPoolMutation() {
  return useMutation({
    mutationFn: (params: AddPoolParams) => http.post("/admin/ip-pools", params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ipPoolKeys.all }),
  });
}

export function useIPRegistryQuery() {
  return useQuery({
    queryKey: ipRegistryKeys.list(),
    queryFn: () => http.get<{ ips: IPEntry[]; count: number }>("/admin/ip-registry"),
    refetchInterval: 30_000,
  });
}
