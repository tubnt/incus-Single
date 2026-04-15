import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";

export const Route = createFileRoute("/vms")({
  component: VMList,
});

interface VMService {
  id: number;
  name: string;
  ip: string;
  status: string;
  cpu: number;
  memory_mb: number;
  disk_gb: number;
  os_image: string;
  node: string;
}

function VMList() {
  const { data, isLoading } = useQuery({
    queryKey: ["myServices"],
    queryFn: () => http.get<{ services: VMService[] }>("/portal/services"),
  });

  const services = data?.services ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">My VMs</h1>
        <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">
          Create VM
        </button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : services.length === 0 ? (
        <div className="border border-border rounded-lg p-8 text-center text-muted-foreground">
          No VMs yet. Create your first virtual machine.
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">IP</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Config</th>
                <th className="text-left px-4 py-3 font-medium">Node</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {services.map((vm) => (
                <tr key={vm.id} className="border-t border-border">
                  <td className="px-4 py-3 font-mono">{vm.name}</td>
                  <td className="px-4 py-3 font-mono">{vm.ip || "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={vm.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {vm.cpu}C / {(vm.memory_mb / 1024).toFixed(0)}G / {vm.disk_gb}G
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{vm.node}</td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-primary text-xs hover:underline">Manage</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-success/20 text-success",
    stopped: "bg-muted text-muted-foreground",
    creating: "bg-primary/20 text-primary",
    error: "bg-destructive/20 text-destructive",
    suspended: "bg-muted text-muted-foreground",
  };
  const cls = colors[status] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}
