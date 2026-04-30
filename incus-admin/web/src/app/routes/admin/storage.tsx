import type {CephPool, OSDTreeNode} from "@/features/storage/api";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {


  useCephPoolsQuery,
  useCephStatusQuery,
  useCreateCephPoolMutation,
  useDeleteCephPoolMutation,
  useOSDInMutation,
  useOSDOutMutation,
  useOSDTreeQuery
} from "@/features/storage/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { StatusPill } from "@/shared/components/ui/status";
import { fmtBytes } from "@/shared/lib/utils";

export const Route = createFileRoute("/admin/storage")({
  component: StoragePage,
});

// Ceph pool type values can arrive as number or string.
// Reference: Ceph OSD pool types — 1 = replicated, 3 = erasure-coded.
function poolTypeLabel(raw: unknown, t: (k: string) => string): string {
  const s = String(raw ?? "").toLowerCase();
  if (s === "1" || s === "replicated") return t("storage.poolType.replicated");
  if (s === "3" || s === "erasure" || s === "erasurecoded" || s === "ec") return t("storage.poolType.erasure");
  return s || "—";
}

function StoragePage() {
  const { t } = useTranslation();
  const { data: cephStatus } = useCephStatusQuery();
  const { data: osdTree } = useOSDTreeQuery();

  const health = cephStatus?.health?.status ?? "UNKNOWN";
  const osdmap = cephStatus?.osdmap;
  const pgmap = cephStatus?.pgmap;
  const osds = osdTree?.nodes?.filter((n) => n.type === "osd") ?? [];
  const hosts = osdTree?.nodes?.filter((n) => n.type === "host") ?? [];
  const hasCeph = !cephStatus?.error;

  const usageRatio = pgmap && pgmap.bytes_total > 0 ? pgmap.bytes_used / pgmap.bytes_total : 0;

  return (
    <PageShell>
      <PageHeader title={t("storage.title")} />
      <PageContent>
        {!hasCeph ? (
          <EmptyState title={t("storage.notConfigured")} />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label={t("storage.health")}
                value={health}
                color={
                  health === "HEALTH_OK"
                    ? "text-status-success"
                    : health === "HEALTH_WARN"
                      ? "text-status-warning"
                      : "text-status-error"
                }
              />
              <StatCard label={t("storage.osds")} value={osdmap ? `${osdmap.num_up_osds}/${osdmap.num_osds} up` : "—"} />
              <StatCard label={t("storage.pools")} value={String(pgmap?.num_pools ?? "—")} />
              <StatCard label={t("storage.pgs")} value={String(pgmap?.num_pgs ?? "—")} />
            </div>

            {pgmap && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label={t("storage.capacity")} value={fmtBytes(pgmap.bytes_total)} />
                <StatCard
                  label={t("storage.used")}
                  value={`${fmtBytes(pgmap.bytes_used)} (${(usageRatio * 100).toFixed(1)}%)`}
                />
                <StatCard label={t("storage.available")} value={fmtBytes(pgmap.bytes_avail)} />
                <StatCard label={t("storage.dataStored")} value={fmtBytes(pgmap.data_bytes)} />
              </div>
            )}

            {pgmap && pgmap.bytes_total > 0 && usageRatio > 0.8 && (
              <Alert variant={usageRatio > 0.9 ? "error" : "warning"}>
                <AlertTitle>
                  {usageRatio > 0.9
                    ? t("storage.warnOver90")
                    : t("storage.warnOver80")}
                </AlertTitle>
                <AlertDescription>
                  {t("storage.currentUsage")}: {(usageRatio * 100).toFixed(1)}% — {fmtBytes(pgmap.bytes_used)} / {fmtBytes(pgmap.bytes_total)}
                </AlertDescription>
              </Alert>
            )}

            {pgmap && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label={t("storage.readIops")} value={`${pgmap.read_op_per_sec ?? 0}/s`} />
                <StatCard label={t("storage.writeIops")} value={`${pgmap.write_op_per_sec ?? 0}/s`} />
                <StatCard label={t("storage.readThroughput")} value={`${fmtBytes(pgmap.read_bytes_sec ?? 0)}/s`} />
                <StatCard label={t("storage.writeThroughput")} value={`${fmtBytes(pgmap.write_bytes_sec ?? 0)}/s`} />
              </div>
            )}

            {osds.length > 0 && (
              <Card className="overflow-x-auto">
                <div className="px-4 py-3 border-b border-border bg-surface-2/40">
                  <h3 className="font-[590] text-sm">{t("storage.osdListTitle")} ({osds.length})</h3>
                </div>
                <table className="w-full text-sm [&_tbody>tr]:transition-colors [&_tbody>tr]:hover:bg-surface-1">
                  <thead className="bg-surface-1 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-2 text-label font-[510] text-text-tertiary">OSD</th>
                      <th className="text-left px-4 py-2 text-label font-[510] text-text-tertiary">{t("storage.status")}</th>
                      <th className="text-right px-4 py-2 text-label font-[510] text-text-tertiary">{t("storage.weight")}</th>
                      <th className="text-right px-4 py-2 text-label font-[510] text-text-tertiary">{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {osds.map((osd) => (
                      <OSDRow key={osd.id} osd={osd} />
                    ))}
                  </tbody>
                </table>
              </Card>
            )}

            <PoolSection />

            {hosts.length > 0 && (
              <Card>
                <CardContent className="p-4 pt-4">
                  <h3 className="font-[590] text-sm mb-3">{t("storage.hostsTitle")} ({hosts.length})</h3>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {hosts.map((h) => (
                      <div key={h.id} className="border border-border rounded p-3 text-center">
                        <div className="font-mono text-sm">{h.name}</div>
                        <div className="text-xs text-muted-foreground">{t("storage.osdCount", { count: h.children?.length ?? 0 })}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </PageContent>
    </PageShell>
  );
}

function PoolSection() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [createOpen, setCreateOpen] = useState(false);
  const [newPool, setNewPool] = useState({ name: "", pg_num: 128, type: "replicated" });

  const { data: pools } = useCephPoolsQuery();
  const createMutation = useCreateCephPoolMutation();
  const deleteMutation = useDeleteCephPoolMutation();

  const onCreate = () =>
    createMutation.mutate(newPool, {
      onSuccess: () => {
        toast.success(t("storage.poolCreatedToast", { name: newPool.name }));
        setCreateOpen(false);
        setNewPool({ name: "", pg_num: 128, type: "replicated" });
      },
      onError: () => toast.error(t("storage.poolCreateFailed")),
    });

  const onDelete = (name: string) =>
    deleteMutation.mutate(name, {
      onSuccess: () => toast.success(t("storage.poolDeletedToast")),
      onError: () => toast.error(t("storage.poolDeleteFailed")),
    });

  const poolList = Array.isArray(pools) ? pools : [];

  return (
    <>
      <Card className="overflow-x-auto">
        <div className="px-4 py-3 border-b border-border bg-surface-2/40 flex items-center justify-between">
          <h3 className="font-[590] text-sm">{t("storage.poolsTitle")} ({poolList.length})</h3>
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            {t("storage.createPool")}
          </Button>
        </div>

        {poolList.length > 0 && (
          <table className="w-full text-sm [&_tbody>tr]:transition-colors [&_tbody>tr]:hover:bg-surface-1">
            <thead className="bg-surface-1 border-b border-border">
              <tr>
                <th className="text-left px-4 py-2 text-label font-[510] text-text-tertiary">Pool</th>
                <th className="text-left px-4 py-2 text-label font-[510] text-text-tertiary">{t("storage.poolTypeLabel")}</th>
                <th className="text-right px-4 py-2 text-label font-[510] text-text-tertiary">Size</th>
                <th className="text-right px-4 py-2 text-label font-[510] text-text-tertiary">PGs</th>
                <th className="text-left px-4 py-2 text-label font-[510] text-text-tertiary">Apps</th>
                <th className="text-right px-4 py-2 text-label font-[510] text-text-tertiary">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {poolList.map((p: CephPool) => (
                <tr key={p.pool_id} className="group/row border-t border-border">
                  <td className="px-4 py-1.5 font-mono text-xs">{p.pool_name}</td>
                  <td className="px-4 py-1.5 text-xs text-muted-foreground">{poolTypeLabel(p.type, t)}</td>
                  <td className="px-4 py-1.5 text-right text-xs">{p.size}</td>
                  <td className="px-4 py-1.5 text-right text-xs font-mono">{p.pg_num}</td>
                  <td className="px-4 py-1.5 text-xs text-muted-foreground">
                    {p.application_metadata ? Object.keys(p.application_metadata).join(", ") : "-"}
                  </td>
                  <td className="px-4 py-1.5 text-right opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 transition-opacity">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={async () => {
                        const ok = await confirm({
                          title: t("deleteConfirm.poolTitle"),
                          message: t("deleteConfirm.poolMessage", { name: p.pool_name }),
                          destructive: true,
                          typeToConfirm: p.pool_name,
                        });
                        if (ok) onDelete(p.pool_name);
                      }}
                      disabled={deleteMutation.isPending}
                      aria-label={`Delete storage pool ${p.pool_name}`}
                      data-testid={`delete-storage-pool-${p.pool_name}`}
                    >
                      {t("common.delete")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Sheet open={createOpen} onOpenChange={(o) => { if (!o) setCreateOpen(false); }}>
        <SheetContent side="right" size="min(96vw, 28rem)">
          <SheetHeader>
            <SheetTitle>{t("storage.createPool")}</SheetTitle>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="storage-pool-name">{t("storage.poolName")}</Label>
              <Input
                id="storage-pool-name"
                value={newPool.name}
                onChange={(e) => setNewPool({ ...newPool, name: e.target.value })}
                placeholder="pool-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="storage-pool-pg">{t("storage.poolPgNum")}</Label>
              <Input
                id="storage-pool-pg"
                type="number"
                value={newPool.pg_num}
                onChange={(e) => setNewPool({ ...newPool, pg_num: +e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("storage.poolTypeLabel")}</Label>
              <Select
                value={newPool.type}
                onValueChange={(v) => setNewPool({ ...newPool, type: String(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="replicated">replicated</SelectItem>
                  <SelectItem value="erasure">erasure</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </SheetBody>
          <SheetFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={onCreate}
              disabled={createMutation.isPending || !newPool.name}
            >
              {createMutation.isPending ? "..." : t("storage.createPoolSubmit")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

function OSDRow({ osd }: { osd: OSDTreeNode }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const osdNum = String(osd.id);

  const outMutation = useOSDOutMutation();
  const inMutation = useOSDInMutation();

  const runOut = () =>
    outMutation.mutate(osdNum, {
      onSuccess: () => toast.success(t("storage.osdOutToast", { id: osdNum })),
      onError: () => toast.error(t("storage.osdOutFailed", { id: osdNum })),
    });

  const runIn = () =>
    inMutation.mutate(osdNum, {
      onSuccess: () => toast.success(t("storage.osdInToast", { id: osdNum })),
      onError: () => toast.error(t("storage.osdInFailed", { id: osdNum })),
    });

  const isPending = outMutation.isPending || inMutation.isPending;

  return (
    <tr className="group/row border-t border-border">
      <td className="px-4 py-1.5 font-mono text-xs">{osd.name}</td>
      <td className="px-4 py-1.5">
        <StatusPill status={osd.status === "up" ? "success" : "error"}>
          {osd.status ?? "unknown"}
        </StatusPill>
      </td>
      <td className="px-4 py-1.5 text-right font-mono text-xs">{osd.crush_weight?.toFixed(3) ?? "—"}</td>
      <td className="px-4 py-1.5 text-right">
        <div className="flex justify-end gap-1 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 transition-opacity">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const ok = await confirm({
                title: t("deleteConfirm.osdOutTitle"),
                message: t("deleteConfirm.osdOutMessage", { id: osdNum }),
                destructive: true,
              });
              if (ok) runOut();
            }}
            disabled={isPending}
          >
            Out
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={runIn}
            disabled={isPending}
          >
            In
          </Button>
        </div>
      </td>
    </tr>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Card>
      <CardContent className="p-4 pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-lg font-[590] mt-1 ${color ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
