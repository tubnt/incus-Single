import type {HealingEvent, HealingListFilter, HealingStatus, HealingTrigger} from "@/features/healing/api";
import type {HANodeInfo} from "@/features/nodes/api";
import type {StatusKind} from "@/shared/components/ui/status";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useClustersQuery } from "@/features/clusters/api";
import { ClusterPicker } from "@/features/clusters/cluster-picker";
import { useHealingEventsQuery } from "@/features/healing/api";
import { EventDetailDialog } from "@/features/healing/components/event-detail-dialog";
import {
  useHAEvacuateMutation,
  useHAStatusQuery,
} from "@/features/nodes/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {  StatusPill } from "@/shared/components/ui/status";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { formatNodeMessage, formatNodeStatus } from "@/shared/lib/status-i18n";
import { capitalize, formatDateTime } from "@/shared/lib/utils";

export const Route = createFileRoute("/admin/ha")({
  component: HAPage,
});

function HAPage() {
  const { t } = useTranslation();
  const { data: clustersData } = useClustersQuery();
  const clusters = clustersData?.clusters ?? [];
  const [clusterName, setClusterName] = useState<string>("");

  useEffect(() => {
    if (!clusterName && clusters.length > 0) {
      // clusterName 作 query key + Tabs 内组件 props，需 state 形式
      // eslint-disable-next-line react/set-state-in-effect
      setClusterName(clusters[0]!.name);
    }
  }, [clusterName, clusters]);

  return (
    <PageShell>
      <PageHeader
        title={t("ha.title", { defaultValue: "HA 故障切换" })}
        description={t("ha.description", {
          defaultValue: "节点状态、healing 事件历史和手动迁移。",
        })}
        actions={
          clusters.length > 1 ? (
            <ClusterPicker value={clusterName} onChange={setClusterName} />
          ) : null
        }
      />
      <PageContent>
        <Tabs defaultValue="status">
          <TabsList>
            <TabsTrigger value="status">{t("ha.tabStatus")}</TabsTrigger>
            <TabsTrigger value="history">{t("ha.tabHistory")}</TabsTrigger>
          </TabsList>
          <TabsContent value="status">
            <StatusPanel clusterName={clusterName} />
          </TabsContent>
          <TabsContent value="history">
            <HistoryPanel
              clusterName={clusterName}
              clusters={clusters.map((c) => c.name)}
            />
          </TabsContent>
        </Tabs>
      </PageContent>
    </PageShell>
  );
}

function StatusPanel({ clusterName }: { clusterName: string }) {
  const { t } = useTranslation();
  const { data: ha, isLoading } = useHAStatusQuery(clusterName);
  const evacuateMutation = useHAEvacuateMutation(clusterName);

  if (isLoading) {
    return <Skeleton className="h-32" />;
  }
  if (!ha) {
    return <EmptyState title={t("ha.noCluster", { defaultValue: "尚未配置集群。" })} />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatBlock label={t("ha.statHaStatus", { defaultValue: "HA 状态" })}>
          {ha.ha_enabled ? (
            <span className="text-status-success">{t("ha.enabled", { defaultValue: "已启用" })}</span>
          ) : (
            <span className="text-status-error">{t("ha.disabled", { defaultValue: "未启用" })}</span>
          )}
        </StatBlock>
        <StatBlock label={t("ha.statStorage", { defaultValue: "存储" })}>{ha.storage}</StatBlock>
        <StatBlock label={t("ha.statNodes", { defaultValue: "节点数" })}>{ha.nodes.length}</StatBlock>
      </div>
      <div className="text-caption text-text-tertiary">
        healing_threshold: {ha.healing_threshold}s
      </div>

      <div className="rounded-lg border border-border bg-surface-1 overflow-x-auto">
        <table className="w-full text-sm [&_tbody>tr]:transition-colors [&_tbody>tr]:hover:bg-surface-1">
          <thead className="border-b border-border">
            <tr>
              <th className="text-left px-4 py-2 text-label font-emphasis text-text-tertiary">{t("admin.nodes.colName", { defaultValue: "节点" })}</th>
              <th className="text-left px-4 py-2 text-label font-emphasis text-text-tertiary">{t("admin.nodes.colStatus", { defaultValue: "状态" })}</th>
              <th className="text-left px-4 py-2 text-label font-emphasis text-text-tertiary">{t("admin.nodes.message", { defaultValue: "消息" })}</th>
              <th className="text-right px-4 py-2 text-label font-emphasis text-text-tertiary">{t("vm.actions", { defaultValue: "操作" })}</th>
            </tr>
          </thead>
          <tbody>
            {ha.nodes.map((node) => (
              <NodeRow
                key={node.server_name}
                node={node}
                onEvacuate={() => evacuateMutation.mutate(node.server_name)}
                pending={evacuateMutation.isPending}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-caption text-text-tertiary uppercase tracking-wide font-emphasis">
          {label}
        </div>
        <div className="text-h3 font-emphasis mt-1 tabular-nums">
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

function NodeRow({
  node,
  onEvacuate,
  pending,
}: {
  node: HANodeInfo;
  onEvacuate: () => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const isOnline = node.status === "Online" || node.status === "ONLINE";

  return (
    <tr className="group/row border-t border-border">
      <td className="px-4 py-2 font-mono">{node.server_name}</td>
      <td className="px-4 py-2">
        <StatusPill status={isOnline ? "success" : "error"}>{formatNodeStatus(t, node.status)}</StatusPill>
      </td>
      <td className="px-4 py-2 text-text-tertiary text-caption">{formatNodeMessage(t, node.message)}</td>
      <td className="px-4 py-2 text-right opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 transition-opacity">
        {isOnline ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            aria-label={`Evacuate node ${node.server_name}`}
            data-testid={`evacuate-node-${node.server_name}`}
            onClick={async () => {
              const ok = await confirm({
                title: t("deleteConfirm.evacuateTitle"),
                message: t("deleteConfirm.evacuateMessage", { node: node.server_name }),
                destructive: true,
              });
              if (ok) onEvacuate();
            }}
          >
            {pending ? t("admin.evacuating") : t("admin.evacuate")}
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

function HistoryPanel({
  clusterName,
  clusters,
}: {
  clusterName: string;
  clusters: string[];
}) {
  const { t } = useTranslation();
  const [trigger, setTrigger] = useState<HealingTrigger | "">("");
  const [status, setStatus] = useState<HealingStatus | "">("");
  const [node, setNode] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);

  const limit = 25;
  const filter: HealingListFilter = useMemo(
    () => ({
      cluster: clusterName || undefined,
      node: node || undefined,
      trigger: trigger || undefined,
      status: status || undefined,
      from: fromDate || undefined,
      to: toDate || undefined,
      limit,
      offset: page * limit,
    }),
    [clusterName, node, trigger, status, fromDate, toDate, page],
  );

  const { data, isLoading } = useHealingEventsQuery(filter);
  const events = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <FilterSelect
          label={t("ha.filterTrigger")}
          value={trigger}
          onChange={(v) => { setTrigger(v as HealingTrigger | ""); setPage(0); }}
          options={[
            { value: "", label: t("ha.filterAll") },
            { value: "manual", label: t("ha.triggerManual") },
            { value: "auto", label: t("ha.triggerAuto") },
            { value: "chaos", label: t("ha.triggerChaos") },
          ]}
        />
        <FilterSelect
          label={t("ha.filterStatus")}
          value={status}
          onChange={(v) => { setStatus(v as HealingStatus | ""); setPage(0); }}
          options={[
            { value: "", label: t("ha.filterAll") },
            { value: "in_progress", label: t("ha.statusInprogress") },
            { value: "completed", label: t("ha.statusCompleted") },
            { value: "failed", label: t("ha.statusFailed") },
            { value: "partial", label: t("ha.statusPartial") },
          ]}
        />
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("ha.filterNode")}
          <input
            value={node}
            onChange={(e) => { setNode(e.target.value); setPage(0); }}
            placeholder="node1"
            className="px-2 py-1 text-sm border border-border rounded bg-background w-32"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("ha.filterFrom")}
          <input
            type="date"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setPage(0); }}
            className="px-2 py-1 text-sm border border-border rounded bg-background"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("ha.filterTo")}
          <input
            type="date"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setPage(0); }}
            className="px-2 py-1 text-sm border border-border rounded bg-background"
          />
        </label>
        <span className="text-xs text-muted-foreground ml-auto">
          {t("ha.countTotal", { n: total })} · {clusters.length > 0 ? clusters.join(", ") : "—"}
        </span>
      </div>

      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm [&_tbody>tr]:transition-colors [&_tbody>tr]:hover:bg-surface-1">
          <thead className="bg-surface-1 border-b border-border">
            <tr>
              <th className="text-left px-3 py-2 text-label font-emphasis text-text-tertiary">{t("ha.colTime")}</th>
              <th className="text-left px-3 py-2 text-label font-emphasis text-text-tertiary">{t("ha.colCluster")}</th>
              <th className="text-left px-3 py-2 text-label font-emphasis text-text-tertiary">{t("ha.colNode")}</th>
              <th className="text-left px-3 py-2 text-label font-emphasis text-text-tertiary">{t("ha.colTrigger")}</th>
              <th className="text-left px-3 py-2 text-label font-emphasis text-text-tertiary">{t("ha.colActor")}</th>
              <th className="text-right px-3 py-2 text-label font-emphasis text-text-tertiary">{t("ha.colVMCount")}</th>
              <th className="text-left px-3 py-2 text-label font-emphasis text-text-tertiary">{t("ha.colStatus")}</th>
              <th className="text-right px-3 py-2 text-label font-emphasis text-text-tertiary">{t("ha.colDuration")}</th>
              <th className="text-right px-3 py-2 text-label font-emphasis text-text-tertiary"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  {t("common.loading")}
                </td>
              </tr>
            )}
            {!isLoading && events.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  {t("ha.empty")}
                </td>
              </tr>
            )}
            {events.map((ev) => (
              <EventRow key={ev.id} event={ev} onOpen={() => setOpenId(ev.id)} />
            ))}
          </tbody>
        </table>
      </div>

      {total > limit && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 border border-border rounded disabled:opacity-50"
          >
            {t("common.prev")}
          </button>
          <span className="text-xs text-muted-foreground">
            {page * limit + 1} – {Math.min((page + 1) * limit, total)} / {total}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={(page + 1) * limit >= total}
            className="px-3 py-1 border border-border rounded disabled:opacity-50"
          >
            {t("common.next")}
          </button>
        </div>
      )}

      <EventDetailDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1 text-sm border border-border rounded bg-background"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const statusToKind: Record<HealingStatus, StatusKind> = {
  in_progress: "pending",
  completed: "success",
  failed: "error",
  partial: "warning",
};

const triggerToKind: Record<HealingTrigger, StatusKind> = {
  manual: "disabled",
  auto: "pending",
  chaos: "warning",
};

function EventRow({
  event,
  onOpen,
}: {
  event: HealingEvent;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const vmCount = event.evacuated_vms?.length ?? 0;

  return (
    <tr className="border-t border-border hover:bg-surface-2 transition-colors">
      <td className="px-3 py-2 font-mono text-caption whitespace-nowrap">
        {formatDateTime(event.started_at)}
      </td>
      <td className="px-3 py-2">{event.cluster_name || `#${event.cluster_id}`}</td>
      <td className="px-3 py-2 font-mono">{event.node_name}</td>
      <td className="px-3 py-2">
        <StatusPill status={triggerToKind[event.trigger]}>
          {t(`ha.trigger${capitalize(event.trigger)}`)}
        </StatusPill>
      </td>
      <td className="px-3 py-2 text-caption">
        {event.actor_id ? `#${event.actor_id}` : "—"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{vmCount}</td>
      <td className="px-3 py-2">
        <StatusPill status={statusToKind[event.status]}>
          {t(`ha.status${capitalize(event.status.replace(/_/g, ""))}`)}
        </StatusPill>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {event.duration_seconds != null ? `${event.duration_seconds}s` : "—"}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={onOpen}
          className="text-caption text-accent hover:underline"
        >
          {t("common.details")}
        </button>
      </td>
    </tr>
  );
}
