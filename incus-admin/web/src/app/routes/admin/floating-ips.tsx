import type {FloatingIP} from "@/features/floating-ips/api";
import { createFileRoute } from "@tanstack/react-router";
import { Link2Off, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useClustersQuery } from "@/features/clusters/api";
import {
  useAllocateFloatingIPMutation,
  useAttachFloatingIPMutation,
  useBatchFloatingIPMutation,
  useDetachFloatingIPMutation,
  useFloatingIPsQuery,
  useReleaseFloatingIPMutation,
} from "@/features/floating-ips/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { BatchToolbar } from "@/shared/components/ui/batch-toolbar";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { StatusPill } from "@/shared/components/ui/status";

export const Route = createFileRoute("/admin/floating-ips")({
  component: FloatingIPsPage,
});

function FloatingIPsPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Record<number, boolean>>({});
  const { data, isLoading } = useFloatingIPsQuery();
  const ips = data?.floating_ips ?? [];
  const batchMutation = useBatchFloatingIPMutation();

  const selected = useMemo(
    () =>
      Object.entries(selectedIds)
        .filter(([, v]) => v)
        .map(([k]) => Number(k)),
    [selectedIds],
  );
  const clearSelection = () => setSelectedIds({});

  const allChecked = ips.length > 0 && ips.every((ip) => selectedIds[ip.id]);
  const someChecked = ips.some((ip) => selectedIds[ip.id]);

  const toggleAll = (next: boolean) => {
    if (next) {
      const all: Record<number, boolean> = {};
      ips.forEach((ip) => { all[ip.id] = true; });
      setSelectedIds(all);
    } else {
      setSelectedIds({});
    }
  };

  const runBatch = async (action: "release" | "detach") => {
    if (selected.length === 0) return;
    if (action === "release") {
      const ok = await confirm({
        title: t("admin.floatingIPs.batchReleaseTitle", { defaultValue: "批量释放 Floating IP？" }),
        message: t("admin.floatingIPs.batchReleaseMessage", {
          defaultValue: "将释放 {{count}} 个 Floating IP。仍 attached 的会失败（请先 detach）。",
          count: selected.length,
        }),
        destructive: true,
        typeToConfirm: "RELEASE",
        typeToConfirmLabel: t("confirmDialog.typeRelease", { defaultValue: "请输入 RELEASE 以确认" }),
      });
      if (!ok) return;
    } else {
      const ok = await confirm({
        title: t("admin.floatingIPs.batchDetachTitle", { defaultValue: "批量解绑 Floating IP？" }),
        message: t("admin.floatingIPs.batchDetachMessage", {
          defaultValue: "将解绑 {{count}} 个 Floating IP（线上服务可能短暂不可达）。",
          count: selected.length,
        }),
        destructive: true,
      });
      if (!ok) return;
    }
    batchMutation.mutate(
      { ids: selected, action },
      {
        onSuccess: (res) => {
          if (res.failed.length === 0) {
            toast.success(
              t("admin.floatingIPs.batchSuccess", {
                defaultValue: "批量 {{action}} 成功（{{count}}）",
                action,
                count: res.succeeded.length,
              }),
            );
          } else {
            toast.warning(
              t("admin.floatingIPs.batchPartial", {
                defaultValue: "部分成功：成功 {{ok}}，失败 {{fail}}",
                ok: res.succeeded.length,
                fail: res.failed.length,
              }),
              {
                description: res.failed.map((f) => `#${f.key}: ${f.error}`).join("\n"),
                duration: 15000,
              },
            );
          }
          clearSelection();
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  return (
    <PageShell>
      <PageHeader
        title={t("admin.floatingIPs.title", { defaultValue: "Floating IPs" })}
        description={t("admin.floatingIPs.hint", {
          defaultValue: "Floating IP 可在 VM 之间转移。Attach 时后端关闭 NIC ipv4_filtering；VM 内仍需手动 'ip addr add'（返回值含 runbook）。",
        })}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} aria-hidden="true" />
            {t("admin.floatingIPs.allocate", { defaultValue: "分配 IP" })}
          </Button>
        }
      />
      <PageContent>
        <BatchToolbar count={selected.length} onClear={clearSelection}>
          <Button
            size="sm"
            variant="ghost"
            disabled={batchMutation.isPending}
            onClick={() => runBatch("detach")}
          >
            <Link2Off size={12} aria-hidden="true" />
            {t("admin.floatingIPs.batchDetach", { defaultValue: "批量解绑" })}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={batchMutation.isPending}
            onClick={() => runBatch("release")}
          >
            <Trash2 size={12} aria-hidden="true" />
            {t("admin.floatingIPs.batchRelease", { defaultValue: "批量释放" })}
          </Button>
        </BatchToolbar>

        {isLoading ? (
          <div className="text-muted-foreground">{t("common.loading", { defaultValue: "加载中..." })}</div>
        ) : ips.length === 0 ? (
          <EmptyState title={t("admin.floatingIPs.empty", { defaultValue: "暂无 Floating IP" })} />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm [&_tbody>tr]:transition-colors [&_tbody>tr.row-hover]:hover:bg-surface-1">
              <thead className="bg-surface-1 border-b border-border">
                <tr>
                  <th className="px-3 py-2 w-10">
                    <Checkbox
                      checked={allChecked}
                      indeterminate={!allChecked && someChecked}
                      onCheckedChange={(v) => toggleAll(v)}
                      aria-label={t("dataTable.selectAll", { defaultValue: "全选" })}
                    />
                  </th>
                  <th className="text-left px-4 py-2 text-label font-[510] text-text-tertiary">IP</th>
                  <th className="text-left px-4 py-2 text-label font-[510] text-text-tertiary">
                    {t("admin.floatingIPs.status", { defaultValue: "状态" })}
                  </th>
                  <th className="text-left px-4 py-2 text-label font-[510] text-text-tertiary">
                    {t("admin.floatingIPs.boundVM", { defaultValue: "绑定 VM" })}
                  </th>
                  <th className="text-left px-4 py-2 text-label font-[510] text-text-tertiary">
                    {t("admin.floatingIPs.description", { defaultValue: "说明" })}
                  </th>
                  <th className="text-right px-4 py-2 text-label font-[510] text-text-tertiary">
                    {t("common.actions", { defaultValue: "操作" })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {ips.map((ip) => (
                  <Row
                    key={ip.id}
                    ip={ip}
                    selected={!!selectedIds[ip.id]}
                    onSelect={(next) =>
                      setSelectedIds((prev) => ({ ...prev, [ip.id]: next }))
                    }
                  />
                ))}
              </tbody>
            </table>
          </Card>
        )}

        <Sheet
          open={createOpen}
          onOpenChange={(o) => {
            if (!o) setCreateOpen(false);
          }}
        >
          <SheetContent side="right" size="min(96vw, 32rem)">
            <AllocatePanel onDone={() => setCreateOpen(false)} />
          </SheetContent>
        </Sheet>
      </PageContent>
    </PageShell>
  );
}

function Row({
  ip,
  selected,
  onSelect,
}: {
  ip: FloatingIP;
  selected: boolean;
  onSelect: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [attaching, setAttaching] = useState(false);
  const [vmID, setVMID] = useState<number>(0);
  const attachMutation = useAttachFloatingIPMutation(ip.id);
  const detachMutation = useDetachFloatingIPMutation(ip.id);
  const releaseMutation = useReleaseFloatingIPMutation(ip.id);

  const runAttach = async () => {
    if (!vmID || vmID <= 0) {
      toast.error(t("admin.floatingIPs.attachIdRequired", "VM ID 必填"));
      return;
    }
    const ok = await confirm({
      title: t("admin.floatingIPs.attachTitle", "绑定 Floating IP"),
      message: t("admin.floatingIPs.attachMessage", {
        ip: ip.ip,
        vm: vmID,
        defaultValue: `确认将 ${ip.ip} 绑定到 VM #${vmID}？`,
      }),
      typeToConfirm: ip.ip,
    });
    if (!ok) return;
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
      typeToConfirm: ip.ip,
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
      typeToConfirm: ip.ip,
    });
    if (!ok) return;
    releaseMutation.mutate(undefined, {
      onSuccess: () => toast.success(t("admin.floatingIPs.released", "已释放")),
      onError: (err) => toast.error((err as Error).message),
    });
  };

  return (
    <>
      <tr className="row-hover group/row border-t border-border">
        <td className="px-3 py-2">
          <Checkbox
            checked={selected}
            onCheckedChange={onSelect}
            aria-label={`Select floating IP ${ip.ip}`}
          />
        </td>
        <td className="px-4 py-2 font-mono">{ip.ip}</td>
        <td className="px-4 py-2">
          <StatusPill status={ip.status === "attached" ? "success" : "disabled"}>
            {ip.status}
          </StatusPill>
        </td>
        <td className="px-4 py-2 font-mono">
          {ip.bound_vm_id ? `#${ip.bound_vm_id}` : "—"}
        </td>
        <td className="px-4 py-2 text-xs text-muted-foreground">
          {ip.description}
        </td>
        <td className="px-4 py-2 text-right">
          <div className="flex items-center justify-end gap-2 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 transition-opacity">
            {ip.status === "available" ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAttaching(!attaching)}
                >
                  {attaching
                    ? t("common.cancel", "取消")
                    : t("admin.floatingIPs.attach", "绑定")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={runRelease}
                  disabled={releaseMutation.isPending}
                  aria-label={`Release floating IP ${ip.ip}`}
                  data-testid={`release-floating-ip-${ip.ip}`}
                >
                  {t("admin.floatingIPs.release", "释放")}
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-status-warning border-status-warning/40"
                onClick={runDetach}
                disabled={detachMutation.isPending}
              >
                {t("admin.floatingIPs.detach", "解绑")}
              </Button>
            )}
          </div>
        </td>
      </tr>
      {attaching && (
        <tr className="border-t border-border bg-surface-2">
          <td colSpan={6} className="px-4 py-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                {t("admin.floatingIPs.attachVMIDLabel", "目标 VM ID (DB 内部 id)")}：
              </span>
              <Input
                type="number"
                value={vmID || ""}
                onChange={(e) => setVMID(Number.parseInt(e.target.value, 10) || 0)}
                className="w-24 h-8"
                placeholder="e.g. 17"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={runAttach}
                disabled={attachMutation.isPending}
              >
                {attachMutation.isPending
                  ? t("admin.floatingIPs.attaching", "绑定中...")
                  : t("admin.floatingIPs.confirmAttach", "确认绑定")}
              </Button>
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
    <>
      <SheetHeader>
        <SheetTitle>{t("admin.floatingIPs.allocate", "分配 IP")}</SheetTitle>
      </SheetHeader>
      <SheetBody>
        <div className="grid grid-cols-1 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fip-cluster">{t("admin.floatingIPs.cluster", "集群")}</Label>
            <select
              id="fip-cluster"
              value={cluster}
              onChange={(e) => setCluster(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-foreground"
            >
              {clusters.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.display_name || c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fip-ip">IP</Label>
            <Input
              id="fip-ip"
              value={ip}
              onChange={(e) => setIP(e.target.value)}
              placeholder="202.151.179.55"
              className="font-mono"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fip-desc">
              {t("admin.floatingIPs.description", "说明")}
            </Label>
            <Input
              id="fip-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        {mutation.isError && (
          <div className="text-status-error text-sm mt-3">
            {(mutation.error as Error).message}
          </div>
        )}
      </SheetBody>
      <SheetFooter>
        <Button variant="ghost" onClick={onDone}>
          {t("common.cancel", "取消")}
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={mutation.isPending || !ip || !cluster}
        >
          {mutation.isPending
            ? t("common.saving", "保存中...")
            : t("admin.floatingIPs.allocateSubmit", "分配")}
        </Button>
      </SheetFooter>
    </>
  );
}
