import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ClusterPicker } from "@/features/clusters/cluster-picker";
import { useAddIPPoolMutation, useIPPoolsQuery } from "@/features/ip-pools/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { Input } from "@/shared/components/ui/input";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";

export const Route = createFileRoute("/admin/ip-pools")({
  component: IPPoolsPage,
});

function IPPoolsPage() {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading } = useIPPoolsQuery();
  const pools = data?.pools ?? [];

  return (
    <PageShell>
      <PageHeader
        title={t("admin.ipPools.title", { defaultValue: "IP Pools" })}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            {t("admin.ipPools.add", { defaultValue: "Add Pool" })}
          </Button>
        }
      />
      <PageContent>
        {isLoading ? (
          <div className="text-muted-foreground">{t("common.loading")}</div>
        ) : pools.length === 0 ? (
          <EmptyState
            title={t("admin.ipPools.empty", {
              defaultValue: "No IP pools configured.",
            })}
          />
        ) : (
          <div className="space-y-4">
            {pools.map((pool, i) => (
              <Card key={i}>
                <CardContent className="p-4 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-[590]">{pool.cluster_name}</h3>
                      <div className="text-sm text-muted-foreground">
                        {pool.cidr} · Gateway {pool.gateway} · VLAN {pool.vlan}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-h2 font-[510] tabular-nums">{pool.available}</div>
                      <div className="text-xs text-muted-foreground">
                        {t("admin.ipPools.available", { defaultValue: "available" })}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mb-2">
                    <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{
                          width: `${pool.total > 0 ? (pool.used / pool.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      {pool.used} / {pool.total}{" "}
                      {t("admin.ipPools.used", { defaultValue: "used" })}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("admin.ipPools.range", { defaultValue: "Range" })}: {pool.range}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Sheet
          open={createOpen}
          onOpenChange={(o) => {
            if (!o) setCreateOpen(false);
          }}
        >
          <SheetContent side="right" size="min(96vw, 32rem)">
            <AddPoolForm onDone={() => setCreateOpen(false)} />
          </SheetContent>
        </Sheet>
      </PageContent>
    </PageShell>
  );
}

function AddPoolForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    cluster: "",
    cidr: "",
    gateway: "",
    range: "",
    vlan: 0,
  });

  const mutation = useAddIPPoolMutation();

  const set = (k: string, v: string | number) => setForm({ ...form, [k]: v });

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {t("admin.ipPools.addTitle", { defaultValue: "Add IP Pool" })}
        </SheetTitle>
      </SheetHeader>
      <SheetBody>
        <div className="grid grid-cols-2 gap-3">
          <ClusterPicker
            value={form.cluster}
            onChange={(v) => set("cluster", v)}
            allowEmpty
            placeholder={t("admin.ipPools.selectCluster", {
              defaultValue: "Select cluster",
            })}
          />
          <Input
            type="number"
            placeholder={t("admin.ipPools.vlanPlaceholder", {
              defaultValue: "VLAN ID",
            })}
            value={form.vlan || ""}
            onChange={(e) => set("vlan", +e.target.value)}
          />
          <Input
            placeholder={t("admin.ipPools.cidrPlaceholder", {
              defaultValue: "CIDR (e.g. 202.151.179.224/27)",
            })}
            value={form.cidr}
            onChange={(e) => set("cidr", e.target.value)}
          />
          <Input
            placeholder={t("admin.ipPools.gatewayPlaceholder", {
              defaultValue: "Gateway (e.g. 202.151.179.225)",
            })}
            value={form.gateway}
            onChange={(e) => set("gateway", e.target.value)}
          />
          <Input
            className="col-span-2"
            placeholder={t("admin.ipPools.rangePlaceholder", {
              defaultValue: "Range (e.g. 202.151.179.230-202.151.179.254)",
            })}
            value={form.range}
            onChange={(e) => set("range", e.target.value)}
          />
        </div>
        {mutation.isError && (
          <div className="text-status-error text-sm mt-3">
            {(mutation.error as Error).message}
          </div>
        )}
      </SheetBody>
      <SheetFooter>
        <Button variant="ghost" onClick={onDone}>
          {t("common.cancel", { defaultValue: "Cancel" })}
        </Button>
        <Button
          variant="primary"
          onClick={() => mutation.mutate(form, { onSuccess: onDone })}
          disabled={mutation.isPending || !form.cluster || !form.cidr}
        >
          {mutation.isPending
            ? t("admin.ipPools.adding", { defaultValue: "Adding..." })
            : t("admin.ipPools.add", { defaultValue: "Add Pool" })}
        </Button>
      </SheetFooter>
    </>
  );
}
