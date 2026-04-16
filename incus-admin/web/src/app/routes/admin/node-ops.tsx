import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { http } from "@/shared/lib/http";

export const Route = createFileRoute("/admin/node-ops")({
  component: NodeOpsPage,
});

function NodeOpsPage() {
  const [host, setHost] = useState("");
  const [output, setOutput] = useState("");

  const testMutation = useMutation({
    mutationFn: () => http.post<{ status: string; output: string; error?: string }>("/admin/nodes/test-ssh", { host }),
    onSuccess: (data) => setOutput(data.output + (data.error ? `\nError: ${data.error}` : "")),
  });

  const execMutation = useMutation({
    mutationFn: (cmd: string) => http.post<{ status: string; output: string; error?: string }>("/admin/nodes/exec", { host, command: cmd }),
    onSuccess: (data) => setOutput(data.output + (data.error ? `\nError: ${data.error}` : "")),
  });

  const quickCommands = [
    { label: "System Info", cmd: "hostname && uname -r && cat /etc/os-release | head -3" },
    { label: "Memory", cmd: "free -h" },
    { label: "Disk", cmd: "df -h" },
    { label: "Block Devices", cmd: "lsblk -d -o NAME,SIZE,ROTA,MODEL" },
    { label: "Network", cmd: "ip addr show | grep 'inet '" },
    { label: "Incus Status", cmd: "incus cluster list 2>/dev/null || echo 'incus not installed'" },
    { label: "Ceph Status", cmd: "ceph -s 2>/dev/null || echo 'ceph not available'" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Node Operations</h1>

      <div className="border border-border rounded-lg bg-card p-4 mb-6">
        <h3 className="font-semibold mb-3">SSH Connection</h3>
        <div className="flex gap-3 mb-3">
          <input type="text" value={host} onChange={(e) => setHost(e.target.value)}
            placeholder="Node IP (e.g. 10.100.0.10)"
            className="flex-1 px-3 py-2 rounded border border-border bg-card text-sm font-mono" />
          <button onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending || !host}
            className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50">
            {testMutation.isPending ? "Testing..." : "Test SSH"}
          </button>
        </div>

        {host && (
          <div className="flex flex-wrap gap-2">
            {quickCommands.map((qc) => (
              <button key={qc.label} onClick={() => execMutation.mutate(qc.cmd)}
                disabled={execMutation.isPending}
                className="px-3 py-1.5 text-xs bg-muted/50 text-muted-foreground rounded hover:bg-muted disabled:opacity-50">
                {qc.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {output && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-muted/30 flex items-center justify-between">
            <span className="text-sm font-medium">Output</span>
            <button onClick={() => setOutput("")} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
          </div>
          <pre className="p-4 text-xs font-mono bg-black text-green-400 overflow-x-auto whitespace-pre-wrap max-h-96">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}
