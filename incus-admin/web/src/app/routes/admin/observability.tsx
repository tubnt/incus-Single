import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/admin/observability")({
  component: ObservabilityPage,
});

const DASHBOARDS = [
  { id: "grafana", label: "Grafana", url: "http://10.0.20.1:3000", desc: "Metrics dashboards (CPU, RAM, Disk, Network)" },
  { id: "prometheus", label: "Prometheus", url: "http://10.0.20.1:9090", desc: "Metrics query and exploration" },
  { id: "alertmanager", label: "Alertmanager", url: "http://10.0.20.1:9093", desc: "Alert routing and silencing" },
  { id: "ceph", label: "Ceph Dashboard", url: "https://10.0.20.1:8443", desc: "Ceph storage management (requires VPN)" },
];

function ObservabilityPage() {
  const [active, setActive] = useState<string | null>(null);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Observability</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {DASHBOARDS.map((d) => (
          <div key={d.id} className="border border-border rounded-lg bg-card p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">{d.label}</h3>
              <div className="flex gap-2">
                <button onClick={() => setActive(active === d.id ? null : d.id)}
                  className="px-3 py-1 text-xs bg-primary/20 text-primary rounded hover:bg-primary/30">
                  {active === d.id ? "Close" : "Embed"}
                </button>
                <a href={d.url} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-1 text-xs bg-muted/50 text-muted-foreground rounded hover:bg-muted">
                  Open →
                </a>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{d.desc}</p>
          </div>
        ))}
      </div>

      {active && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-muted/30 flex items-center justify-between">
            <span className="text-sm font-medium">{DASHBOARDS.find((d) => d.id === active)?.label}</span>
            <button onClick={() => setActive(null)} className="text-xs text-muted-foreground hover:text-foreground">
              Close ×
            </button>
          </div>
          <iframe
            src={DASHBOARDS.find((d) => d.id === active)?.url}
            className="w-full h-[700px]"
            title={active}
          />
        </div>
      )}

      <div className="mt-6 border border-border rounded-lg bg-card p-4">
        <h3 className="font-semibold mb-2">Access Note</h3>
        <p className="text-sm text-muted-foreground">
          These dashboards are on the cluster internal network (10.0.20.0/24).
          Access requires WireGuard VPN connection or SSH tunnel to the cluster.
          The embedded view will only work if your browser can reach the cluster network.
        </p>
      </div>
    </div>
  );
}
