import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchCurrentUser, isAdmin } from "@/shared/lib/auth";
import { http } from "@/shared/lib/http";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function Dashboard() {
  const { data: user } = useQuery({
    queryKey: ["currentUser"],
    queryFn: fetchCurrentUser,
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatCard title="My VMs" value="—" />
        <StatCard title="Balance" value={user ? `$${user.balance.toFixed(2)}` : "—"} />
        <StatCard title="Open Tickets" value="0" />
      </div>

      {user && isAdmin(user) && <AdminSection />}
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

interface ClusterInfo {
  name: string;
  display_name: string;
  nodes: number;
  status: string;
}

function AdminSection() {
  const { data: healthData } = useQuery({
    queryKey: ["adminHealth"],
    queryFn: () => http.get<{ status: string }>("/health"),
  });

  const { data: clustersData } = useQuery({
    queryKey: ["adminClusters"],
    queryFn: () => http.get<{ clusters: ClusterInfo[] }>("/admin/clusters"),
  });

  const clusters = clustersData?.clusters ?? [];
  const totalNodes = clusters.reduce((sum, c) => sum + (c.nodes || 0), 0);

  const { data: vmsData } = useQuery({
    queryKey: ["adminClusterVMs", clusters[0]?.name],
    queryFn: () => clusters[0] ? http.get<{ count: number }>(`/admin/clusters/${clusters[0].name}/vms`) : Promise.resolve({ count: 0 }),
    enabled: clusters.length > 0,
  });

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold mb-4">Admin Overview</h2>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Clusters" value={String(clusters.length)} />
        <StatCard title="Nodes" value={String(totalNodes)} />
        <StatCard title="Total VMs" value={String(vmsData?.count ?? "—")} />
        <StatCard
          title="API Status"
          value={healthData?.status === "ok" ? "Healthy" : "—"}
        />
      </div>
    </div>
  );
}
