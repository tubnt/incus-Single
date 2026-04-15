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
        <StatCard title="Open Tickets" value="—" />
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

function AdminSection() {
  const { data } = useQuery({
    queryKey: ["adminHealth"],
    queryFn: () => http.get<{ status: string }>("/health"),
  });

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold mb-4">Admin</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Clusters" value="—" />
        <StatCard title="Total VMs" value="—" />
        <StatCard
          title="API Status"
          value={data?.status === "ok" ? "Healthy" : "—"}
        />
      </div>
    </div>
  );
}
