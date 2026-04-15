import { useMutation, useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

export interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  balance: number;
  created_at: string;
}

export function useUsersQuery() {
  return useQuery({
    queryKey: ["adminUsers"],
    queryFn: () => http.get<{ users: User[] }>("/admin/users"),
  });
}

export function useUpdateRoleMutation(userId: number) {
  return useMutation({
    mutationFn: (role: string) => http.put(`/admin/users/${userId}/role`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["adminUsers"] }),
  });
}

export function useTopUpBalanceMutation(userId: number) {
  return useMutation({
    mutationFn: (params: { amount: number; description: string }) =>
      http.post(`/admin/users/${userId}/balance`, params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["adminUsers"] }),
  });
}
