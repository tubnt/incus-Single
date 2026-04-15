import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";

export const Route = createFileRoute("/admin/clusters")({
  component: ClustersPage,
});

interface ClusterInfo {
  name: string;
  display_name: string;
  nodes: number;
  vms: number;
  status: string;
}

function ClustersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["adminClusters"],
    queryFn: () => http.get<{ clusters: ClusterInfo[] }>("/admin/clusters"),
  });

  const clusters = data?.clusters ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Clusters</h1>
      {isLoading ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : clusters.length === 0 ? (
        <div className="border border-border rounded-lg p-8 text-center text-muted-foreground">
          No clusters configured.
        </div>
      ) : (
        <div className="grid gap-4">
          {clusters.map((c) => (
            <div key={c.name} className="border border-border rounded-lg p-4 bg-card">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{c.display_name || c.name}</h3>
                  <div className="text-sm text-muted-foreground mt-1">
                    {c.nodes} nodes · {c.vms} VMs
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-success/20 text-success">
                  {c.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
