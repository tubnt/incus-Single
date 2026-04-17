import { useMutation, useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

export interface APIToken {
  id: number;
  name: string;
  token?: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export const apiTokenKeys = {
  all: ["apiToken"] as const,
  list: () => [...apiTokenKeys.all, "list"] as const,
};

export function useAPITokensQuery() {
  return useQuery({
    queryKey: apiTokenKeys.list(),
    queryFn: () => http.get<{ tokens: APIToken[] }>("/portal/api-tokens"),
  });
}

export function useCreateAPITokenMutation() {
  return useMutation({
    mutationFn: (name: string) => http.post<{ token: APIToken }>("/portal/api-tokens", { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiTokenKeys.all }),
  });
}

export function useDeleteAPITokenMutation() {
  return useMutation({
    mutationFn: (id: number) => http.delete(`/portal/api-tokens/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiTokenKeys.all }),
  });
}
