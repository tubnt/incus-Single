import { useMutation, useQuery } from "@tanstack/react-query";
import { clusterKeys } from "@/features/clusters/api";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

export interface ClusterNode {
  cluster: string;
  server_name: string;
  url: string;
  status: string;
  message: string;
  architecture: string;
  roles: string[];
  description: string;
}

export interface NodeInstance {
  name: string;
  status: string;
  type: string;
  location: string;
}

export interface NodeDetail {
  node: Record<string, unknown>;
  instances: NodeInstance[];
}

export interface SSHResult {
  status: string;
  output: string;
  error?: string;
}

export interface HANodeInfo {
  server_name: string;
  url: string;
  status: string;
  message: string;
  roles: string;
}

export interface HAStatus {
  cluster: string;
  healing_threshold: number;
  storage: string;
  ha_enabled: boolean;
  nodes: HANodeInfo[];
}

export const nodeKeys = {
  all: ["node"] as const,
  list: () => [...nodeKeys.all, "list"] as const,
  detail: (cluster: string, name: string) => [...nodeKeys.all, "detail", cluster, name] as const,
  ha: (cluster: string) => [...nodeKeys.all, "ha", cluster] as const,
};

export function useAdminNodesQuery() {
  return useQuery({
    queryKey: nodeKeys.list(),
    queryFn: () => http.get<{ nodes: ClusterNode[] }>("/admin/nodes"),
    refetchInterval: 15_000,
  });
}

export function useAdminNodeDetailQuery(clusterName: string, nodeName: string) {
  return useQuery({
    queryKey: nodeKeys.detail(clusterName, nodeName),
    queryFn: () => http.get<NodeDetail>(`/admin/nodes/${nodeName}?cluster=${clusterName}`),
    enabled: !!clusterName && !!nodeName,
  });
}

export function useNodeEvacuateMutation(clusterName: string, nodeName: string) {
  return useMutation({
    mutationFn: () =>
      http.post(`/admin/nodes/${nodeName}/evacuate?cluster=${clusterName}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nodeKeys.all });
      queryClient.invalidateQueries({ queryKey: clusterKeys.all });
    },
  });
}

export function useNodeRestoreMutation(clusterName: string, nodeName: string) {
  return useMutation({
    mutationFn: () =>
      http.post(`/admin/nodes/${nodeName}/restore?cluster=${clusterName}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nodeKeys.all });
      queryClient.invalidateQueries({ queryKey: clusterKeys.all });
    },
  });
}

export function useHAStatusQuery(clusterName: string) {
  return useQuery({
    queryKey: nodeKeys.ha(clusterName),
    queryFn: () => http.get<HAStatus>(`/admin/clusters/${clusterName}/ha`),
    enabled: !!clusterName,
    refetchInterval: 15_000,
  });
}

export function useHAEvacuateMutation(clusterName: string) {
  return useMutation({
    mutationFn: (nodeName: string) =>
      http.post(
        `/admin/clusters/${clusterName}/nodes/${nodeName}/evacuate`,
        undefined,
        {
          intent: {
            action: "node.evacuate",
            args: { cluster: clusterName, node: nodeName },
            description: `迁移节点 ${nodeName} 上所有 VM`,
          },
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nodeKeys.all });
      queryClient.invalidateQueries({ queryKey: clusterKeys.all });
    },
  });
}

export function useTestSSHMutation() {
  return useMutation({
    mutationFn: (host: string) => http.post<SSHResult>("/admin/nodes/test-ssh", { host }),
  });
}

export function useExecSSHMutation() {
  return useMutation({
    mutationFn: (params: { host: string; command: string }) =>
      http.post<SSHResult>("/admin/nodes/exec", params),
  });
}
