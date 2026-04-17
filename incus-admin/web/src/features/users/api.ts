import { useMutation, useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";
import type { User } from "@/shared/lib/auth";

export interface Quota {
  max_vms: number;
  max_vcpus: number;
  max_ram_mb: number;
  max_disk_gb: number;
  max_ips: number;
  max_snapshots: number;
}

export interface QuotaUsage {
  vms: number;
  vcpus: number;
  ram_mb: number;
  disk_gb: number;
}

export const userKeys = {
  all: ["user"] as const,
  adminList: () => [...userKeys.all, "list", "admin"] as const,
  quota: (userId: number) => [...userKeys.all, "quota", userId] as const,
};

export function useAdminUsersQuery() {
  return useQuery({
    queryKey: userKeys.adminList(),
    queryFn: () => http.get<{ users: User[] }>("/admin/users"),
  });
}

export function useUpdateUserRoleMutation(userId: number) {
  return useMutation({
    mutationFn: (role: string) => http.put(`/admin/users/${userId}/role`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useTopUpBalanceMutation(userId: number) {
  return useMutation({
    mutationFn: (amount: number) =>
      http.post(`/admin/users/${userId}/balance`, { amount, description: "Admin top-up" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useUserQuotaQuery(userId: number) {
  return useQuery({
    queryKey: userKeys.quota(userId),
    queryFn: () => http.get<{ quota: Quota | null; usage: QuotaUsage }>(`/admin/users/${userId}/quota`),
  });
}

export function useUpdateUserQuotaMutation(userId: number) {
  return useMutation({
    mutationFn: (quota: Quota) => http.put(`/admin/users/${userId}/quota`, quota),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.quota(userId) }),
  });
}
