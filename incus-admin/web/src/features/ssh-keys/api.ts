import { useMutation, useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

export interface SSHKey {
  id: number;
  name: string;
  public_key: string;
  fingerprint: string;
  created_at: string;
}

export function useSSHKeysQuery() {
  return useQuery({
    queryKey: ["sshKeys"],
    queryFn: () => http.get<{ keys: SSHKey[] }>("/portal/ssh-keys"),
  });
}

export function useCreateSSHKeyMutation() {
  return useMutation({
    mutationFn: (params: { name: string; public_key: string }) =>
      http.post("/portal/ssh-keys", params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sshKeys"] }),
  });
}

export function useDeleteSSHKeyMutation() {
  return useMutation({
    mutationFn: (id: number) => http.delete(`/portal/ssh-keys/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sshKeys"] }),
  });
}
