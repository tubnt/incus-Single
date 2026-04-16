import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { fmtBytes } from "@/shared/lib/utils";

export const Route = createFileRoute("/admin/storage")({
  component: StoragePage,
});

interface HAStatus {
  cluster: string;
  healing_threshold: number;
  storage: string;
  ha_enabled: boolean;
  nodes: Array<{ server_name: string; status: string; message: string }>;
}

function StoragePage() {
  const { data: clustersData } = useQuery({
    queryKey: ["adminClusters"],
    queryFn: () => http.get<{ clusters: Array<{ name: string; display_name: string }> }>("/admin/clusters"),
  });
  const clusters = clustersData?.clusters ?? [];
  const clusterName = clusters[0]?.name ?? "";

  const { data: ha } = useQuery({
    queryKey: ["haStatus", clusterName],
    queryFn: () => http.get<HAStatus>(`/admin/clusters/${clusterName}/ha`),
    enabled: !!clusterName,
  });

  const { data: metricsData } = useQuery({
    queryKey: ["adminMetricsOverview"],
    queryFn: () => http.get<{ clusters: Array<{ name: string; vms: Array<{ disk_total_bytes: number; disk_used_bytes: number; disk_used_pct: number }> }> }>("/admin/metrics/overview"),
    refetchInterval: 30_000,
  });

  const vms = metricsData?.clusters?.[0]?.vms ?? [];
  const totalDisk = vms.reduce((s, v) => s + v.disk_total_bytes, 0);
  const usedDisk = vms.reduce((s, v) => s + v.disk_used_bytes, 0);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Storage (Ceph)</h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Health" value={ha ? "HEALTH_OK" : "—"} color="text-success" />
        <StatCard label="Storage Pool" value={ha?.storage ?? "—"} />
        <StatCard label="Nodes with OSD" value={String(ha?.nodes?.length ?? 0)} />
        <StatCard label="VM Disk Usage" value={`${fmtBytes(usedDisk)} / ${fmtBytes(totalDisk)}`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="border border-border rounded-lg bg-card p-4">
          <h3 className="font-semibold mb-3">Cluster Nodes</h3>
          {ha?.nodes?.map((n) => (
            <div key={n.server_name} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <span className="font-mono text-sm">{n.server_name}</span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${n.status === "Online" ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive"}`}>
                {n.status}
              </span>
            </div>
          ))}
        </div>

        <div className="border border-border rounded-lg bg-card p-4">
          <h3 className="font-semibold mb-3">VM Disk Usage</h3>
          {vms.length === 0 ? (
            <div className="text-muted-foreground text-sm">No VMs</div>
          ) : vms.map((vm, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <span className="text-sm">{fmtBytes(vm.disk_used_bytes)} / {fmtBytes(vm.disk_total_bytes)}</span>
              <span className="text-xs text-muted-foreground">{vm.disk_used_pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="border border-border rounded-lg bg-card p-4">
        <h3 className="font-semibold mb-3">External Dashboards</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Full Ceph management requires access via WireGuard VPN to the cluster network.
        </p>
        <div className="flex gap-3">
          <a href="https://10.0.20.1:8443" target="_blank" rel="noopener noreferrer"
            className="px-3 py-1.5 rounded text-xs bg-primary/20 text-primary hover:bg-primary/30">
            Ceph Dashboard →
          </a>
          <a href="http://10.0.20.1:3000" target="_blank" rel="noopener noreferrer"
            className="px-3 py-1.5 rounded text-xs bg-primary/20 text-primary hover:bg-primary/30">
            Grafana →
          </a>
          <a href="http://10.0.20.1:9090" target="_blank" rel="noopener noreferrer"
            className="px-3 py-1.5 rounded text-xs bg-primary/20 text-primary hover:bg-primary/30">
            Prometheus →
          </a>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="border border-border rounded-lg bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold mt-1 ${color ?? ""}`}>{value}</div>
    </div>
  );
}
