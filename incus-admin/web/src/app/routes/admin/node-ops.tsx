import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useExecSSHMutation, useTestSSHMutation } from "@/features/nodes/api";
import { validHost } from "@/features/nodes/host-validation";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";

export const Route = createFileRoute("/admin/node-ops")({
  component: NodeOpsPage,
});

function NodeOpsPage() {
  const { t } = useTranslation();
  const [host, setHost] = useState("");
  const [hostTouched, setHostTouched] = useState(false);
  const [output, setOutput] = useState("");

  const testMutation = useTestSSHMutation();
  const execMutation = useExecSSHMutation();

  const runTest = () =>
    testMutation.mutate(host, {
      onSuccess: (data) => setOutput(data.output + (data.error ? `\nError: ${data.error}` : "")),
    });

  const runExec = (cmd: string) =>
    execMutation.mutate(
      { host, command: cmd },
      { onSuccess: (data) => setOutput(data.output + (data.error ? `\nError: ${data.error}` : "")) },
    );

  const quickCommands = [
    { label: "System Info", cmd: "hostname && uname -r && cat /etc/os-release | head -3" },
    { label: "Memory", cmd: "free -h" },
    { label: "Disk", cmd: "df -h" },
    { label: "Block Devices", cmd: "lsblk -d -o NAME,SIZE,ROTA,MODEL" },
    { label: "Network", cmd: "ip addr show | grep 'inet '" },
    { label: "Incus Status", cmd: "incus cluster list 2>/dev/null || echo 'incus not installed'" },
    { label: "Ceph Status", cmd: "ceph -s 2>/dev/null || echo 'ceph not available'" },
  ];

  const hostInvalid = hostTouched && !!host && !validHost(host);
  const canAct = validHost(host);

  return (
    <PageShell>
      <PageHeader title={t("admin.nodeOpsTitle")} />
      <PageContent>
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.sshConnection")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 mb-1">
              <Input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                onBlur={() => setHostTouched(true)}
                placeholder={t("admin.hostPlaceholder")}
                className={`flex-1 font-mono ${hostInvalid ? "border-status-error" : ""}`}
              />
              <Button
                variant="primary"
                onClick={runTest}
                disabled={testMutation.isPending || !canAct}
              >
                {testMutation.isPending ? t("admin.sshTesting") : t("admin.sshTest")}
              </Button>
            </div>
            {hostInvalid && (
              <div className="text-xs text-status-error mb-2">{t("admin.hostInvalid")}</div>
            )}

            {canAct && (
              <div className="flex flex-wrap gap-2 mt-3">
                {quickCommands.map((qc) => (
                  <Button
                    key={qc.label}
                    variant="subtle"
                    size="sm"
                    onClick={() => runExec(qc.cmd)}
                    disabled={execMutation.isPending}
                  >
                    {qc.label}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {output && (
          <Card className="overflow-hidden">
            <div className="px-4 py-2 bg-surface-2/40 flex items-center justify-between border-b border-border">
              <span className="text-sm font-emphasis">{t("common.output")}</span>
              <Button
                variant="link"
                size="sm"
                onClick={() => setOutput("")}
              >
                {t("common.clear")}
              </Button>
            </div>
            <pre className="p-4 text-xs font-mono bg-black text-green-400 overflow-x-auto whitespace-pre-wrap max-h-96">
              {output}
            </pre>
          </Card>
        )}
      </PageContent>
    </PageShell>
  );
}
