import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";
import { fmtBytes } from "@/shared/lib/utils";

export const Route = createFileRoute("/admin/clusters")({
  component: ClustersPage,
});

interface ClusterInfo {
  name: string;
  display_name: string;
  api_url: string;
  nodes: number;
  status: string;
}

interface NodeInfo {
  server_name: string;
  status: string;
  message: string;
  cpu_total: number;
  mem_total: number;
  mem_used: number;
  mem_free: number;
  free_ratio: number;
}

function ClustersPage() {
  const { t } = useTranslation();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["adminClusters"],
    queryFn: () => http.get<{ clusters: ClusterInfo[] }>("/admin/clusters"),
  });

  const clusters = data?.clusters ?? [];

  const [showAdd, setShowAdd] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("nav.clusters")}</h1>
        <button onClick={() => setShowAdd(!showAdd)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">
          {showAdd ? t("common.cancel") : "+ Add Cluster"}
        </button>
      </div>

      {showAdd && <AddClusterForm onDone={() => { setShowAdd(false); refetch(); }} />}

      {isLoading ? (
        <div className="text-muted-foreground">{t("common.loading")}</div>
      ) : clusters.length === 0 ? (
        <div className="border border-border rounded-lg p-8 text-center text-muted-foreground">
          {t("common.noData")}
        </div>
      ) : (
        <div className="space-y-6">
          {clusters.map((c) => (
            <ClusterCard key={c.name} cluster={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function ClusterCard({ cluster }: { cluster: ClusterInfo }) {
  const { data, refetch } = useQuery({
    queryKey: ["adminNodes", cluster.name],
    queryFn: () => http.get<{ nodes: NodeInfo[] }>(`/admin/clusters/${cluster.name}/nodes`),
    refetchInterval: 30_000,
  });

  const nodes = data?.nodes ?? [];

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="p-4 flex items-center justify-between border-b border-border">
        <div>
          <h3 className="font-semibold text-lg">{cluster.display_name || cluster.name}</h3>
          <div className="text-sm text-muted-foreground mt-1">
            {cluster.api_url} · {nodes.length} nodes
          </div>
        </div>
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-success/20 text-success">
          {cluster.status}
        </span>
      </div>

      {nodes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Node</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">CPU</th>
                <th className="text-left px-4 py-2 font-medium">Memory</th>
                <th className="text-left px-4 py-2 font-medium">Free %</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => (
                <NodeRow key={n.server_name} node={n} clusterName={cluster.name} onDone={refetch} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NodeRow({ node: n, clusterName, onDone }: { node: NodeInfo; clusterName: string; onDone: () => void }) {
  const evacuateMutation = useMutation({
    mutationFn: () => http.post(`/admin/clusters/${clusterName}/nodes/${n.server_name}/evacuate`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["adminNodes"] }); onDone(); },
  });

  const restoreMutation = useMutation({
    mutationFn: () => http.post(`/admin/clusters/${clusterName}/nodes/${n.server_name}/restore`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["adminNodes"] }); onDone(); },
  });

  const isOnline = n.status === "Online";
  const isEvacuated = n.status === "Evacuated" || n.message?.includes("evacuated");
  const acting = evacuateMutation.isPending || restoreMutation.isPending;

  return (
    <tr className="border-t border-border">
      <td className="px-4 py-2 font-mono">{n.server_name}</td>
      <td className="px-4 py-2">
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${isOnline ? "bg-success/20 text-success" : isEvacuated ? "bg-yellow-500/20 text-yellow-600" : "bg-destructive/20 text-destructive"}`}>
          {n.status}
        </span>
        {n.message && n.message !== "Fully operational" && (
          <span className="text-xs text-muted-foreground ml-2">{n.message}</span>
        )}
      </td>
      <td className="px-4 py-2">{n.cpu_total} cores</td>
      <td className="px-4 py-2">{fmtBytes(n.mem_used)} / {fmtBytes(n.mem_total)}</td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-success rounded-full" style={{ width: `${(n.free_ratio * 100).toFixed(0)}%` }} />
          </div>
          <span className="text-xs text-muted-foreground">{(n.free_ratio * 100).toFixed(0)}%</span>
        </div>
      </td>
      <td className="px-4 py-2 text-right">
        <div className="flex gap-1 justify-end">
          {isOnline && (
            <button
              onClick={() => { if (confirm(`Evacuate ${n.server_name}?`)) evacuateMutation.mutate(); }}
              disabled={acting}
              className="px-2 py-1 text-xs bg-yellow-500/20 text-yellow-600 rounded hover:bg-yellow-500/30 disabled:opacity-50"
            >
              Evacuate
            </button>
          )}
          {isEvacuated && (
            <button
              onClick={() => restoreMutation.mutate()}
              disabled={acting}
              className="px-2 py-1 text-xs bg-success/20 text-success rounded hover:bg-success/30 disabled:opacity-50"
            >
              Restore
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function AddClusterForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: "", display_name: "", api_url: "", cert_file: "", key_file: "" });

  const mutation = useMutation({
    mutationFn: () => http.post("/admin/clusters/add", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminClusters"] });
      onDone();
    },
  });

  const set = (k: string, v: string) => setForm({ ...form, [k]: v });

  return (
    <div className="border border-border rounded-lg bg-card p-4 mb-6">
      <h3 className="font-semibold mb-3">Add Cluster / Standalone Host</h3>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <input placeholder="Name (e.g. cn-sz-02)" value={form.name} onChange={(e) => set("name", e.target.value)}
          className="px-3 py-2 rounded border border-border bg-card text-sm" />
        <input placeholder="Display Name" value={form.display_name} onChange={(e) => set("display_name", e.target.value)}
          className="px-3 py-2 rounded border border-border bg-card text-sm" />
        <input placeholder="API URL (https://10.0.20.1:8443)" value={form.api_url} onChange={(e) => set("api_url", e.target.value)}
          className="col-span-2 px-3 py-2 rounded border border-border bg-card text-sm" />
        <input placeholder="Client Cert Path" value={form.cert_file} onChange={(e) => set("cert_file", e.target.value)}
          className="px-3 py-2 rounded border border-border bg-card text-sm" />
        <input placeholder="Client Key Path" value={form.key_file} onChange={(e) => set("key_file", e.target.value)}
          className="px-3 py-2 rounded border border-border bg-card text-sm" />
      </div>
      {mutation.isError && <div className="text-destructive text-sm mb-2">{(mutation.error as Error).message}</div>}
      <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.name || !form.api_url}
        className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50">
        {mutation.isPending ? "Connecting..." : "Add Cluster"}
      </button>
    </div>
  );
}
