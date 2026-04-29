import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  type FloatingIP,
  useAllocateFloatingIPMutation,
  useAttachFloatingIPMutation,
  useDetachFloatingIPMutation,
  useFloatingIPsQuery,
  useReleaseFloatingIPMutation,
} from "@/features/floating-ips/api";
import { useClustersQuery } from "@/features/clusters/api";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";

export const Route = createFileRoute("/admin/floating-ips")({
  component: FloatingIPsPage,
});

function FloatingIPsPage() {
  const { t } = useTranslation();
  const [showAllocate, setShowAllocate] = useState(false);
  const { data, isLoading } = useFloatingIPsQuery();
  const ips = data?.floating_ips ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">
          {t("admin.floatingIPs.title", "Floating IPs")}
        </h1>
        <button
          onClick={() => setShowAllocate(!showAllocate)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
        >
          {showAllocate
            ? t("common.cancel", "取消")
            : t("admin.floatingIPs.allocate", "+ 分配 IP")}
        </button>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        {t(
          "admin.floatingIPs.hint",
          "Floating IP 可在 VM 之间转移。Attach 时后端关闭 NIC ipv4_filtering；VM 内仍需手动 'ip addr add'（返回值含 runbook）。详见 runbook-ops.md。",
        )}
      </p>

      {showAllocate && <AllocatePanel onDone={() => setShowAllocate(false)} />}

      {isLoading ? (
        <div className="text-muted-foreground">{t("common.loading", "加载中...")}</div>
      ) : ips.length === 0 ? (
        <div className="border border-border rounded-lg p-6 text-center text-muted-foreground">
          {t("admin.floatingIPs.empty", "暂无 Floating IP")}
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2 font-medium">IP</th>
                <th className="text-left px-4 py-2 font-medium">
                  {t("admin.floatingIPs.status", "状态")}
                </th>
                <th className="text-left px-4 py-2 font-medium">
                  {t("admin.floatingIPs.boundVM", "绑定 VM")}
                </th>
                <th className="text-left px-4 py-2 font-medium">
                  {t("admin.floatingIPs.description", "说明")}
                </th>
                <th className="text-right px-4 py-2 font-medium">
                  {t("common.actions", "操作")}
                </th>
              </tr>
            </thead>
            <tbody>
              {ips.map((ip) => <Row key={ip.id} ip={ip} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ ip }: { ip: FloatingIP }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [attaching, setAttaching] = useState(false);
  const [vmID, setVMID] = useState<number>(0);
  const attachMutation = useAttachFloatingIPMutation(ip.id);
  const detachMutation = useDetachFloatingIPMutation(ip.id);
  const releaseMutation = useReleaseFloatingIPMutation(ip.id);

  const runAttach = () => {
    if (!vmID || vmID <= 0) {
      toast.error(t("admin.floatingIPs.attachIdRequired", "VM ID 必填"));
      return;
    }
    attachMutation.mutate(vmID, {
      onSuccess: (res) => {
        setAttaching(false);
        toast.success(
          t("admin.floatingIPs.attached", {
            ip: res.ip,
            vm: res.vm_name,
            defaultValue: `${res.ip} → ${res.vm_name}`,
          }),
        );
        toast.info(res.runbook_hint, { duration: 30000 });
      },
      onError: (err) => toast.error((err as Error).message),
    });
  };

  const runDetach = async () => {
    const ok = await confirm({
      title: t("admin.floatingIPs.detachTitle", "解除绑定"),
      message: t("admin.floatingIPs.detachMessage", {
        ip: ip.ip,
        defaultValue: `确认解除 ${ip.ip} 与 VM 的绑定？`,
      }),
    });
    if (!ok) return;
    detachMutation.mutate(undefined, {
      onSuccess: (res) => {
        toast.success(t("admin.floatingIPs.detached", "已解除绑定"));
        if (res.runbook_hint) {
          toast.info(res.runbook_hint, { duration: 30000 });
        }
      },
      onError: (err) => toast.error((err as Error).message),
    });
  };

  const runRelease = async () => {
    const ok = await confirm({
      title: t("admin.floatingIPs.releaseTitle", "释放 Floating IP"),
      message: t("admin.floatingIPs.releaseMessage", {
        ip: ip.ip,
        defaultValue: `确认释放 ${ip.ip}？IP 将回收，可再次分配。`,
      }),
      destructive: true,
    });
    if (!ok) return;
    releaseMutation.mutate(undefined, {
      onSuccess: () => toast.success(t("admin.floatingIPs.released", "已释放")),
      onError: (err) => toast.error((err as Error).message),
    });
  };

  const statusColor =
    ip.status === "attached"
      ? "bg-primary/20 text-primary"
      : "bg-muted text-muted-foreground";

  return (
    <>
      <tr className="border-t border-border">
        <td className="px-4 py-2 font-mono">{ip.ip}</td>
        <td className="px-4 py-2">
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor}`}
          >
            {ip.status}
          </span>
        </td>
        <td className="px-4 py-2 font-mono">
          {ip.bound_vm_id ? `#${ip.bound_vm_id}` : "—"}
        </td>
        <td className="px-4 py-2 text-xs text-muted-foreground">
          {ip.description}
        </td>
        <td className="px-4 py-2 text-right">
          <div className="flex items-center justify-end gap-2">
            {ip.status === "available" ? (
              <>
                <button
                  onClick={() => setAttaching(!attaching)}
                  className="px-2 py-1 text-xs rounded border border-border hover:bg-muted"
                >
                  {attaching
                    ? t("common.cancel", "取消")
                    : t("admin.floatingIPs.attach", "绑定")}
                </button>
                <button
                  onClick={runRelease}
                  disabled={releaseMutation.isPending}
                  aria-label={`Release floating IP ${ip.ip}`}
                  data-testid={`release-floating-ip-${ip.ip}`}
                  className="px-2 py-1 text-xs rounded border border-destructive text-destructive hover:bg-destructive/10"
                >
                  ⚠ {t("admin.floatingIPs.release", "释放")}
                </button>
              </>
            ) : (
              <button
                onClick={runDetach}
                disabled={detachMutation.isPending}
                className="px-2 py-1 text-xs rounded border border-warning/30 text-warning hover:bg-warning/10"
              >
                {t("admin.floatingIPs.detach", "解绑")}
              </button>
            )}
          </div>
        </td>
      </tr>
      {attaching && (
        <tr className="border-t border-border bg-muted/20">
          <td colSpan={5} className="px-4 py-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                {t("admin.floatingIPs.attachVMIDLabel", "目标 VM ID (DB 内部 id)")}：
              </span>
              <input
                type="number"
                value={vmID || ""}
                onChange={(e) => setVMID(parseInt(e.target.value, 10) || 0)}
                className="w-24 px-2 py-1 rounded border border-border bg-card text-sm"
                placeholder="e.g. 17"
              />
              <button
                onClick={runAttach}
                disabled={attachMutation.isPending}
                className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs disabled:opacity-50"
              >
                {attachMutation.isPending
                  ? t("admin.floatingIPs.attaching", "绑定中...")
                  : t("admin.floatingIPs.confirmAttach", "确认绑定")}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function AllocatePanel({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [ip, setIP] = useState("");
  const [cluster, setCluster] = useState("");
  const [description, setDescription] = useState("");
  const { data: clustersData } = useClustersQuery();
  const clusters = clustersData?.clusters ?? [];
  const mutation = useAllocateFloatingIPMutation();

  if (cluster === "" && clusters.length > 0) {
    setCluster(clusters[0]!.name);
  }

  const submit = () => {
    if (!ip || !cluster) {
      toast.error(t("admin.floatingIPs.allocateValidation", "IP 和集群必填"));
      return;
    }
    mutation.mutate(
      { cluster, ip, description },
      {
        onSuccess: () => {
          toast.success(t("admin.floatingIPs.allocated", "已分配"));
          onDone();
        },
        onError: (err) => toast.error((err as Error).message),
      },
    );
  };

  return (
    <div className="border border-border rounded-lg bg-card p-4 mb-6 space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <label className="block text-xs">
          <span className="text-muted-foreground mb-1 block">
            {t("admin.floatingIPs.cluster", "集群")}
          </span>
          <select
            value={cluster}
            onChange={(e) => setCluster(e.target.value)}
            className="w-full px-3 py-2 rounded border border-border bg-card text-sm"
          >
            {clusters.map((c) => (
              <option key={c.name} value={c.name}>{c.display_name || c.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          <span className="text-muted-foreground mb-1 block">IP</span>
          <input
            value={ip}
            onChange={(e) => setIP(e.target.value)}
            placeholder="202.151.179.55"
            className="w-full px-3 py-2 rounded border border-border bg-card text-sm font-mono"
          />
        </label>
        <label className="block text-xs">
          <span className="text-muted-foreground mb-1 block">
            {t("admin.floatingIPs.description", "说明")}
          </span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded border border-border bg-card text-sm"
          />
        </label>
      </div>
      {mutation.isError && (
        <div className="text-destructive text-sm">
          {(mutation.error as Error).message}
        </div>
      )}
      <button
        onClick={submit}
        disabled={mutation.isPending || !ip || !cluster}
        className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50"
      >
        {mutation.isPending
          ? t("common.saving", "保存中...")
          : t("admin.floatingIPs.allocateSubmit", "分配")}
      </button>
    </div>
  );
}
