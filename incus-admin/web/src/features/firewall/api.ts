import { useMutation, useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

export interface FirewallRule {
  id?: number;
  group_id?: number;
  action: "allow" | "reject" | "drop";
  protocol: "tcp" | "udp" | "icmp4" | "icmp6" | "";
  destination_port: string;
  source_cidr: string;
  description: string;
  sort_order: number;
}

export interface FirewallGroup {
  id: number;
  slug: string;
  name: string;
  description: string;
  created_at?: string;
  updated_at?: string;
  rules?: FirewallRule[];
}

export interface CreateFirewallGroupPayload {
  slug: string;
  name: string;
  description: string;
  rules: FirewallRule[];
}

export const firewallKeys = {
  all: ["firewall"] as const,
  groupList: () => [...firewallKeys.all, "groups"] as const,
  group: (id: number) => [...firewallKeys.all, "group", id] as const,
  vmBindings: (vmID: number) => [...firewallKeys.all, "vm", vmID] as const,
};

export function useFirewallGroupsQuery() {
  return useQuery({
    queryKey: firewallKeys.groupList(),
    queryFn: () => http.get<{ groups: FirewallGroup[] }>("/admin/firewall/groups"),
  });
}

export function useCreateFirewallGroupMutation() {
  return useMutation({
    mutationFn: (data: CreateFirewallGroupPayload) =>
      http.post<{ group: FirewallGroup; warning?: string; sync_err?: string }>(
        "/admin/firewall/groups",
        data,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: firewallKeys.all }),
  });
}

export function useUpdateFirewallGroupMutation(id: number) {
  return useMutation({
    mutationFn: (data: { name?: string; description?: string }) =>
      http.put<FirewallGroup>(`/admin/firewall/groups/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: firewallKeys.all }),
  });
}

export function useReplaceFirewallRulesMutation(id: number) {
  return useMutation({
    mutationFn: (rules: FirewallRule[]) =>
      http.put<{ rules: FirewallRule[]; warning?: string; sync_err?: string }>(
        `/admin/firewall/groups/${id}/rules`,
        { rules },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: firewallKeys.all }),
  });
}

export function useDeleteFirewallGroupMutation(id: number) {
  return useMutation({
    mutationFn: () => http.delete(`/admin/firewall/groups/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: firewallKeys.all }),
  });
}

// Portal: 用户端只读获取 groups 列表（rules 不暴露给普通用户）。
export function usePortalFirewallGroupsQuery() {
  return useQuery({
    queryKey: [...firewallKeys.all, "portal", "groups"] as const,
    queryFn: () => http.get<{ groups: FirewallGroup[] }>("/portal/firewall/groups"),
  });
}

// Portal: 拿到指定 VM 当前已绑的 group 列表（owner-scoped）。
export function usePortalVMFirewallBindingsQuery(vmID: number | null | undefined) {
  return useQuery({
    queryKey: vmID ? firewallKeys.vmBindings(vmID) : firewallKeys.vmBindings(0),
    queryFn: () =>
      http.get<{ groups: FirewallGroup[] }>(`/portal/services/${vmID}/firewall`),
    enabled: !!vmID,
  });
}

// Portal: 给自己 VM 绑定一个 group（cold-modify：running 时后端自动 stop→PATCH→start）。
export function usePortalBindVMFirewallMutation(vmID: number) {
  return useMutation({
    mutationFn: (groupID: number) =>
      http.post<{ status: string; group: FirewallGroup }>(
        `/portal/services/${vmID}/firewall`,
        { group_id: groupID },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: firewallKeys.vmBindings(vmID) });
    },
  });
}

// Portal: 解绑指定 group。
export function usePortalUnbindVMFirewallMutation(vmID: number) {
  return useMutation({
    mutationFn: (groupID: number) =>
      http.delete(`/portal/services/${vmID}/firewall/${groupID}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: firewallKeys.vmBindings(vmID) });
    },
  });
}
