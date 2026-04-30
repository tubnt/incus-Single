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

/**
 * PLAN-026 / INFRA-002 节点 add/remove 走 jobs runtime 异步流。
 * 返回 202 + job_id，前端用 useJobStream 监听 SSE。
 */
export interface AddNodeParams {
  node_name: string;
  public_ip: string;
  ssh_user?: string;
  ssh_key_file?: string;
  role?: "osd" | "mon-mgr-osd";
  // OPS-026 / PLAN-028 advanced：bonded NIC / 异构拓扑
  nic_primary?: string;
  nic_cluster?: string;
  bridge_name?: string;
  mgmt_ip?: string;
  ceph_pub_ip?: string;
  ceph_cluster_ip?: string;
  skip_network?: boolean;
}

export interface NodeJobResponse {
  status: string;
  job_id: number;
  node: string;
}

export function useAddNodeMutation(clusterName: string) {
  return useMutation({
    mutationFn: (params: AddNodeParams) =>
      http.post<NodeJobResponse>(`/admin/clusters/${clusterName}/nodes`, params, {
        intent: {
          action: "node.add",
          args: { cluster: clusterName, name: params.node_name, ip: params.public_ip },
          description: `添加节点 ${params.node_name} (${params.public_ip}) 到集群 ${clusterName}`,
        },
      }),
  });
}

// OPS-024 D2 maintenance mode toggle（Incus scheduler.instance = manual / all）
export function useNodeMaintenanceMutation(clusterName: string, nodeName: string) {
  return useMutation({
    mutationFn: (enabled: boolean) =>
      http.post(`/admin/clusters/${clusterName}/nodes/${nodeName}/maintenance`, { enabled }, {
        intent: {
          action: "node.maintenance",
          args: { cluster: clusterName, node: nodeName, enabled },
          description: enabled
            ? `把节点 ${nodeName} 设为维护模式（防新放置，保留现 VM）`
            : `恢复节点 ${nodeName} 的常规调度`,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nodeKeys.all });
      queryClient.invalidateQueries({ queryKey: clusterKeys.all });
    },
  });
}

// OPS-024 C2：cluster-env.sh 下载（通过 step-up 鉴权）
export function clusterEnvScriptURL(clusterName: string): string {
  return `/api/admin/clusters/${clusterName}/env-script`;
}

export function useRemoveNodeMutation(clusterName: string) {
  return useMutation({
    mutationFn: (params: { nodeName: string; leader?: string }) => {
      const qs = params.leader ? `?leader=${encodeURIComponent(params.leader)}` : "";
      return http.delete<NodeJobResponse>(
        `/admin/clusters/${clusterName}/nodes/${params.nodeName}${qs}`,
        undefined,
        {
          intent: {
            action: "node.remove",
            args: { cluster: clusterName, node: params.nodeName },
            description: `从集群 ${clusterName} 移除节点 ${params.nodeName}（会先 evacuate 所有 VM）`,
          },
        },
      );
    },
  });
}
