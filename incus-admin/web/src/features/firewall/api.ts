import { useMutation, useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

export interface FirewallRule {
  id?: number;
  group_id?: number;
  // Direction is optional in the API for back-compat; defaults to "ingress"
  // server-side when omitted.
  direction?: "ingress" | "egress";
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
  // PLAN-035：null = admin 共享组（用户只读），number = 用户私有组（仅 owner 可编辑）
  owner_id?: number | null;
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

// PLAN-035 portal-only group CRUD：
//
// - 创建私有 group（owner 自动 = current user，受 max_firewall_groups quota 限）
// - 改 name/description（slug 不可改）
// - 替换 rules（受 max_firewall_rules_per_group quota 限）
// - 删（被 VM 绑定时返 409，需先解绑）
//
// 后端走 /portal/firewall/groups[/{id}/rules]，与 admin /admin/firewall/groups 路径
// 隔离；admin 共享组（owner_id=NULL）这里 403/404，仅自己拥有的组可改。

export function usePortalCreateFirewallGroupMutation() {
  return useMutation({
    mutationFn: (data: CreateFirewallGroupPayload) =>
      http.post<{ group: FirewallGroup; warning?: string; sync_err?: string }>(
        "/portal/firewall/groups",
        data,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: firewallKeys.all }),
  });
}

export function usePortalUpdateFirewallGroupMutation(id: number) {
  return useMutation({
    mutationFn: (data: { name?: string; description?: string }) =>
      http.put<FirewallGroup>(`/portal/firewall/groups/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: firewallKeys.all }),
  });
}

export function usePortalReplaceFirewallRulesMutation(id: number) {
  return useMutation({
    mutationFn: (rules: FirewallRule[]) =>
      http.put<{ rules: FirewallRule[]; warning?: string; sync_err?: string }>(
        `/portal/firewall/groups/${id}/rules`,
        { rules },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: firewallKeys.all }),
  });
}

export function usePortalDeleteFirewallGroupMutation(id: number) {
  return useMutation({
    mutationFn: () => http.delete(`/portal/firewall/groups/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: firewallKeys.all }),
  });
}

// PLAN-036 用户级集中管理：默认组 + 多 VM 批量绑定 + 看绑定关系。

export interface BoundVM {
  id: number;
  name: string;
  status: string;
  ip: string | null;
  node: string;
}

export interface BatchBindResult {
  total: number;
  succeeded: number[];
  failed: Array<{ vm_id: number; error: string }>;
}

const portalDefaultsKey = [...firewallKeys.all, "portal", "defaults"] as const;
const portalGroupVMsKey = (groupID: number) => [...firewallKeys.all, "portal", "group", groupID, "vms"] as const;

export function usePortalFirewallDefaultsQuery() {
  return useQuery({
    queryKey: portalDefaultsKey,
    queryFn: () => http.get<{ groups: FirewallGroup[] }>("/portal/firewall/defaults"),
  });
}

export function usePortalReplaceFirewallDefaultsMutation() {
  return useMutation({
    mutationFn: (groupIDs: number[]) =>
      http.put<{ group_ids: number[] }>("/portal/firewall/defaults", { group_ids: groupIDs }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: firewallKeys.all }),
  });
}

export function usePortalGroupBoundVMsQuery(groupID: number | null) {
  return useQuery({
    queryKey: groupID ? portalGroupVMsKey(groupID) : portalGroupVMsKey(0),
    queryFn: () => http.get<{ vms: BoundVM[]; count: number }>(`/portal/firewall/groups/${groupID}/vms`),
    enabled: !!groupID,
  });
}

export function usePortalFirewallBindBatchMutation(groupID: number) {
  return useMutation({
    mutationFn: (vmIDs: number[]) =>
      http.post<BatchBindResult>(
        `/portal/firewall/groups/${groupID}/bind:batch`,
        { vm_ids: vmIDs },
        {
          intent: {
            action: "firewall.bind_batch",
            args: { group_id: groupID, vm_ids: vmIDs },
            description: `批量绑定 firewall #${groupID} 到 ${vmIDs.length} 台 VM`,
          },
        },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: firewallKeys.all }),
  });
}

export function usePortalFirewallUnbindBatchMutation(groupID: number) {
  return useMutation({
    mutationFn: (vmIDs: number[]) =>
      http.post<BatchBindResult>(
        `/portal/firewall/groups/${groupID}/unbind:batch`,
        { vm_ids: vmIDs },
        {
          intent: {
            action: "firewall.unbind_batch",
            args: { group_id: groupID, vm_ids: vmIDs },
            description: `批量解绑 firewall #${groupID} 从 ${vmIDs.length} 台 VM`,
          },
        },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: firewallKeys.all }),
  });
}
