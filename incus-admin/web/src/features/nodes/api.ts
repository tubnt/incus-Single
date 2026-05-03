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
 *
 * PLAN-033 / OPS-039 wizard 字段：probe_id / accepted_host_key_sha256 /
 * credential_id / inline_*。新字段全部可选；不传 = 兼容旧 ssh_key_file 路径。
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
  // PLAN-033 wizard
  probe_id?: string;
  accepted_host_key_sha256?: string;
  credential_id?: number;
  inline_kind?: "password" | "private_key";
  inline_password?: string;
  inline_key_data?: string;
}

/* ============================================================
 *  PLAN-033 / OPS-039 — node credentials + probe APIs
 * ============================================================ */

export interface NodeCredential {
  id: number;
  name: string;
  kind: "password" | "private_key";
  fingerprint?: string;
  created_by: number;
  created_at: string;
  last_used_at?: string;
}

export const credentialKeys = {
  all: ["node-credentials"] as const,
  list: () => [...credentialKeys.all, "list"] as const,
};

export function useNodeCredentialsQuery() {
  return useQuery({
    queryKey: credentialKeys.list(),
    queryFn: () => http.get<{ credentials: NodeCredential[] }>("/admin/node-credentials"),
  });
}

export interface CreateCredentialBody {
  name: string;
  kind: "password" | "private_key";
  password?: string;
  key_data?: string;
}

export function useCreateCredentialMutation() {
  return useMutation({
    mutationFn: (body: CreateCredentialBody) =>
      http.post<{ credential: NodeCredential }>("/admin/node-credentials", body, {
        intent: {
          action: "node.credential.create",
          args: { name: body.name, kind: body.kind },
          description: `保存节点凭据 ${body.name}（${body.kind === "password" ? "密码" : "私钥"}）`,
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: credentialKeys.all }),
  });
}

export function useDeleteCredentialMutation() {
  return useMutation({
    mutationFn: (id: number) =>
      http.delete<{ status: string; id: number }>(`/admin/node-credentials/${id}`, undefined, {
        intent: {
          action: "node.credential.delete",
          args: { id },
          description: `删除节点凭据 #${id}`,
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: credentialKeys.all }),
  });
}

export interface ProbeHostKeyParams {
  host: string;
  port?: number;
  user?: string;
}

export interface ProbeHostKeyResult {
  host: string;
  port: number;
  key_type: string;
  fingerprint: string;
}

export function useProbeHostKeyMutation(clusterName: string) {
  return useMutation({
    mutationFn: (body: ProbeHostKeyParams) =>
      http.post<ProbeHostKeyResult>(
        `/admin/clusters/${clusterName}/nodes/probe-host-key`,
        body,
        {
          intent: {
            action: "node.probe.host_key",
            args: { cluster: clusterName, host: body.host },
            description: `探测 ${body.host} SSH 主机密钥`,
          },
        },
      ),
  });
}

export interface ProbeNodeParams {
  host: string;
  port?: number;
  user?: string;
  credential_id?: number;
  inline_kind?: "password" | "private_key";
  inline_password?: string;
  inline_key_data?: string;
  accepted_host_key_sha256: string;
}

export interface NodeInfo {
  hostname: string;
  os: { id?: string; version?: string; kernel?: string };
  cpu: { model?: string; cores?: number; threads?: number };
  memory_kb: number;
  interfaces: Array<{
    name: string;
    kind: string;
    mac?: string;
    speed_mbps?: number;
    slaves?: string[];
    master?: string;
    addresses?: string[];
    is_default_route?: boolean;
  }>;
  default_route?: { interface: string; gateway?: string; source?: string };
  public_ip_observed?: string;
  disks: Array<{ name: string; size_bytes?: number; rotational?: boolean; model?: string }>;
  incus_installed: boolean;
  ceph_installed: boolean;
}

export interface ProbeNodeResult {
  probe_id: string;
  node: NodeInfo;
  fingerprint: string;
}

export function useProbeNodeMutation(clusterName: string) {
  return useMutation({
    mutationFn: (body: ProbeNodeParams) =>
      http.post<ProbeNodeResult>(`/admin/clusters/${clusterName}/nodes/probe`, body, {
        intent: {
          action: "node.probe",
          args: { cluster: clusterName, host: body.host },
          description: `探测节点 ${body.host} 的 OS/CPU/内存/网卡`,
        },
      }),
  });
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

// OPS-028 P3.4：fetch 走 step-up 401 拦截 → 跳 OIDC；避免浏览器直链落到
// step-up JSON 裸页。返回 ok=true 时浏览器开始下载；ok=false 时已被
// step-up 接管或抛出错误。
export async function downloadClusterEnvScript(clusterName: string): Promise<void> {
  const url = clusterEnvScriptURL(clusterName);
  const resp = await fetch(url, { credentials: "same-origin" });
  if (resp.status === 401) {
    const body: unknown = await resp.json().catch(() => null);
    if (
      body
      && typeof body === "object"
      && (body as Record<string, unknown>).error === "step_up_required"
    ) {
      const redirect = (body as Record<string, unknown>).redirect;
      if (typeof redirect === "string" && redirect.startsWith("/api/auth/stepup/")) {
        window.location.href = redirect;
        return;
      }
    }
    throw new Error("unauthorized");
  }
  if (!resp.ok) {
    throw new Error(`download failed: HTTP ${resp.status}`);
  }
  const blob = await resp.blob();
  const objectURL = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectURL;
  a.download = "cluster-env.sh";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectURL);
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
