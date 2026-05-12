import type { User } from "@/shared/lib/auth";
import type {PageParams} from "@/shared/lib/pagination";
import { useMutation, useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { pageKeyPart,  pageQueryString } from "@/shared/lib/pagination";
import { queryClient } from "@/shared/lib/query-client";

export type { PageParams } from "@/shared/lib/pagination";

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
  adminList: (params?: PageParams) =>
    [...userKeys.all, "list", "admin", pageKeyPart(params)] as const,
  quota: (userId: number) => [...userKeys.all, "quota", userId] as const,
  topupQuota: (userId: number) => [...userKeys.all, "topup-quota", userId] as const,
};

export interface TopUpQuota {
  used: number;
  limit: number;
  remaining: number;
  per_request_limit: number;
  window_hours: number;
}

export function useAdminUsersQuery(params?: PageParams) {
  return useQuery({
    queryKey: userKeys.adminList(params),
    queryFn: () =>
      http.get<{ users: User[]; total?: number; limit?: number; offset?: number }>(
        `/admin/users${pageQueryString(params)}`,
      ),
  });
}

export function useUpdateUserRoleMutation(userId: number) {
  return useMutation({
    mutationFn: (role: string) => http.put(`/admin/users/${userId}/role`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}

// PLAN-023 Phase C: 批量改角色。step-up gated by middleware；后端禁止 self-target。
// Session-2 F-66 / PLAN-051 §2-D：扩 topup action（后端原子端点串行 + 同 daily cap）
export type BatchUserAction = "change_role" | "topup";

export interface BatchUserResult {
  total: number;
  succeeded: number[];
  failed: Array<{ key: number; error: string }>;
}

export function useBatchUserMutation() {
  return useMutation({
    mutationFn: (params: { ids: number[]; action: BatchUserAction; role: "admin" | "customer" }) =>
      http.post<BatchUserResult>(
        "/admin/users:batch",
        {
          ids: params.ids,
          action: params.action,
          options: { role: params.role },
        },
        {
          intent: {
            action: `user.batch_${params.action}`,
            args: { ids: params.ids, action: params.action, role: params.role },
            description: `批量 ${params.action}=${params.role} ${params.ids.length} 个用户`,
          },
        },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}

// Session-2 F-66 / PLAN-051 §2-D：批量充值原子端点。后端单 endpoint 串行执行
// 每条单笔事务（TopUpWithDailyCap 加锁），返回 succeeded/failed key 数组。
// 前端用 isPending gate 防止重复提交。
export function useBatchTopUpMutation() {
  return useMutation({
    mutationFn: (params: { ids: number[]; amount: number; description?: string }) =>
      http.post<BatchUserResult>(
        "/admin/users:batch",
        {
          ids: params.ids,
          action: "topup",
          options: {
            amount: params.amount,
            description: params.description ?? "Admin batch top-up",
          },
        },
        {
          intent: {
            action: "user.batch_topup",
            args: { ids: params.ids, amount: params.amount },
            description: `批量充值 $${params.amount} × ${params.ids.length} 个用户`,
          },
        },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useTopUpBalanceMutation(userId: number) {
  return useMutation({
    mutationFn: (amount: number) =>
      http.post(
        `/admin/users/${userId}/balance`,
        { amount, description: "Admin top-up" },
        {
          intent: {
            action: "user.topup",
            args: { user_id: userId, amount },
            description: `给用户 #${userId} 充值 $${amount}`,
          },
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      queryClient.invalidateQueries({ queryKey: userKeys.topupQuota(userId) });
    },
  });
}

export function useTopUpQuotaQuery(userId: number, enabled = true) {
  return useQuery({
    queryKey: userKeys.topupQuota(userId),
    queryFn: () => http.get<TopUpQuota>(`/admin/users/${userId}/topup-quota`),
    enabled: enabled && userId > 0,
    staleTime: 30_000,
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
