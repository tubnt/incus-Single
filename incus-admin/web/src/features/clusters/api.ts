import { useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";

export interface ClusterInfo {
  name: string;
  display_name: string;
  api_url: string;
  nodes: number;
  status: string;
}

export interface NodeInfo {
  server_name: string;
  url: string;
  status: string;
  message: string;
}

export function useClustersQuery() {
  return useQuery({
    queryKey: ["adminClusters"],
    queryFn: () => http.get<{ clusters: ClusterInfo[] }>("/admin/clusters"),
  });
}

export function useClusterNodesQuery(clusterName: string) {
  return useQuery({
    queryKey: ["clusterNodes", clusterName],
    queryFn: () => http.get<{ nodes: NodeInfo[] }>(`/admin/clusters/${clusterName}/nodes`),
    enabled: !!clusterName,
  });
}
