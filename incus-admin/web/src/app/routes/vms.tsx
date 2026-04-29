import type {VMService} from "@/features/vms/api";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { VMMetricsPanel } from "@/features/monitoring/vm-metrics-panel";
import { SnapshotPanel } from "@/features/snapshots/snapshot-panel";
import { useMyVMsQuery, useVMActionMutation  } from "@/features/vms/api";
import { defaultUserForImage } from "@/features/vms/default-user";
import { CardSkeleton } from "@/shared/components/ui/skeleton";

export const Route = createFileRoute("/vms")({
  component: MyVMs,
});

function MyVMs() {
  const { t } = useTranslation();
  const { data, isLoading } = useMyVMsQuery();
  const services = data?.vms ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("vm.myVms", { defaultValue: "My VMs" })}</h1>
        <a
          href="/billing"
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
        >
          + {t("vm.createVm", { defaultValue: "Create VM" })}
        </a>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}</div>
      ) : services.length === 0 ? (
        <div className="border border-border rounded-lg p-8 text-center text-muted-foreground">
          {t("vm.noneYet", { defaultValue: "No VMs yet. Create your first virtual machine." })}
        </div>
      ) : (
        <div className="space-y-4">
          {services.map((vm) => (
            <VMCard key={vm.id} vm={vm} />
          ))}
        </div>
      )}
    </div>
  );
}

function VMCard({ vm }: { vm: VMService }) {
  const { t } = useTranslation();
  const [showMetrics, setShowMetrics] = useState(false);
  const [showSnaps, setShowSnaps] = useState(false);
  const actionMutation = useVMActionMutation(vm.id);

  const runAction = (action: string) => {
    actionMutation.mutate(action, {
      onSuccess: () => toast.success(`${vm.name}: ${action} ${t("vm.actionSubmitted", { defaultValue: "submitted" })}`),
      onError: () => toast.error(`${vm.name}: ${action} ${t("vm.actionFailed", { defaultValue: "failed" })}`),
    });
  };

  const consoleHref = `/console?vm=${encodeURIComponent(vm.name)}&cluster=${encodeURIComponent(vm.cluster)}&project=${encodeURIComponent(vm.project)}&from=portal`;

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="p-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <a href={`/vm-detail?id=${vm.id}`} className="font-mono font-semibold text-primary hover:underline">{vm.name}</a>
            <StatusBadge status={vm.status} />
            <span className="text-xs text-muted-foreground">{vm.cluster_display_name || vm.cluster}</span>
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {vm.cpu}C / {(vm.memory_mb / 1024).toFixed(0)}G RAM / {vm.disk_gb}G Disk · {vm.os_image}
          </div>
          <div className="text-sm mt-2 space-y-0.5">
            <div>IP: <span className="font-mono">{vm.ip || t("vm.assigning", { defaultValue: "assigning..." })}</span></div>
            <div>{t("vm.username", { defaultValue: "Username" })}: <span className="font-mono">{defaultUserForImage(vm.os_image)}</span></div>
            <div>Node: {vm.node} · {t("vm.created", { defaultValue: "Created" })}: {new Date(vm.created_at).toLocaleDateString()}</div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {vm.status === "running" && (
            <>
              <a href={consoleHref}
                className="px-3 py-1.5 rounded text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30 text-center">
                Console
              </a>
              <ActionBtn label={t("vm.monitor", { defaultValue: "Monitor" })} onClick={() => setShowMetrics(!showMetrics)} disabled={false} />
              <ActionBtn label={t("vm.snapshots", { defaultValue: "Snaps" })} onClick={() => setShowSnaps(!showSnaps)} disabled={false} />
              <ActionBtn label={t("vm.stop", { defaultValue: "Stop" })} onClick={() => runAction("stop")} disabled={actionMutation.isPending} />
              <ActionBtn label={t("vm.restart", { defaultValue: "Restart" })} onClick={() => runAction("restart")} disabled={actionMutation.isPending} />
            </>
          )}
          {vm.status === "stopped" && (
            <ActionBtn label={t("vm.start", { defaultValue: "Start" })} onClick={() => runAction("start")} disabled={actionMutation.isPending} />
          )}
          {/* Destructive / infrequent actions (Reinstall / Reset Password /
              Rescue) live on the VM detail page — this deep-link keeps the
              card tidy and ensures the user sees the full warning + mode
              selectors before acting. */}
          <a
            href={`/vm-detail?id=${vm.id}`}
            className="px-3 py-1.5 rounded text-xs font-medium bg-muted/30 text-muted-foreground hover:bg-muted text-center"
          >
            {t("vm.moreActions", { defaultValue: "更多操作 →" })}
          </a>
        </div>
      </div>
      {showMetrics && vm.status === "running" && (
        <VMMetricsPanel vmName={vm.name} apiBase="/portal" />
      )}
      {showSnaps && (
        <SnapshotPanel vmName={vm.name} cluster={vm.cluster} project={vm.project} apiBase="/portal" />
      )}
    </div>
  );
}

function ActionBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="px-3 py-1.5 rounded text-xs font-medium bg-muted/50 text-muted-foreground hover:bg-muted disabled:opacity-50">
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-success/20 text-success",
    stopped: "bg-muted text-muted-foreground",
    creating: "bg-primary/20 text-primary",
    error: "bg-destructive/20 text-destructive",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}
