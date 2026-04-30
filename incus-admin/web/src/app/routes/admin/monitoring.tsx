import type {VMMetric} from "@/features/monitoring/api";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useMetricsOverviewQuery } from "@/features/monitoring/api";
import { useCommandActions } from "@/shared/components/command-palette/use-command-actions";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { EmptyState, ErrorState } from "@/shared/components/ui/empty-state";
import { StatGridSkeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/admin/monitoring")({
  component: MonitoringPage,
});

function MonitoringPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useMetricsOverviewQuery();

  const clusters = data?.clusters ?? [];
  const allVMs = clusters.flatMap((c) => c.vms ?? []);
  const warning = data?.warning;
  const dbRunningTotal = clusters.reduce(
    (sum, c) => sum + (c.db_running_count ?? 0),
    0,
  );
  const drifted = allVMs.length === 0 && dbRunningTotal > 0;

  useCommandActions(
    () => [
      {
        id: "monitoring.refresh",
        title: t("monitoring.refresh", { defaultValue: "刷新指标" }),
        icon: "Activity",
        perform: () => refetch(),
      },
      {
        id: "monitoring.observability",
        title: t("admin.observability.title", { defaultValue: "可观测性面板" }),
        icon: "BarChart3",
        perform: () => navigate({ to: "/admin/observability" }),
      },
      {
        id: "monitoring.all-vms",
        title: t("nav.allVms", { defaultValue: "所有 VM" }),
        icon: "ServerCog",
        perform: () => navigate({ to: "/admin/vms" }),
      },
    ],
    [refetch, navigate, t],
  );

  return (
    <PageShell>
      <PageHeader
        title={t("monitoring.title")}
        description={t("monitoring.description", {
          defaultValue: "集群健康总览：CPU / 内存 / 磁盘 / 网络。",
        })}
      />
      <PageContent>
        {warning ? (
          <Alert variant="warning">
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        ) : null}

        {isLoading ? (
          <StatGridSkeleton count={4} />
        ) : error ? (
          <ErrorState
            title={t("monitoring.fetchFailed", {
              defaultValue: "拉取失败",
              error: (error as Error).message,
            })}
            description={(error as Error).message}
            retry={() => refetch()}
          />
        ) : allVMs.length === 0 ? (
          <EmptyState
            title={
              drifted
                ? t("monitoring.noDataDrift", {
                    defaultValue: "暂无指标（DB 标 {{count}} 台 Running，但 Incus 未上报）",
                    count: dbRunningTotal,
                  })
                : t("monitoring.noData", { defaultValue: "暂无指标" })
            }
          />
        ) : (
          <>
            <SummaryCards vms={allVMs} />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <CPUChart vms={allVMs} />
              <MemoryChart vms={allVMs} />
              <DiskChart vms={allVMs} />
              <NetworkChart vms={allVMs} />
            </div>
            <VMTable vms={allVMs} />
          </>
        )}
      </PageContent>
    </PageShell>
  );
}

function SummaryCards({ vms }: { vms: VMMetric[] }) {
  const { t } = useTranslation();
  const totalMem = vms.reduce((s, v) => s + v.mem_total_bytes, 0);
  const usedMem = vms.reduce((s, v) => s + v.mem_used_bytes, 0);
  const totalDisk = vms.reduce((s, v) => s + v.disk_total_bytes, 0);
  const usedDisk = vms.reduce((s, v) => s + v.disk_used_bytes, 0);
  const avgCPU =
    vms.length > 0
      ? vms.reduce((s, v) => s + v.cpu_user_pct + v.cpu_system_pct, 0) / vms.length
      : 0;

  const cards = [
    { label: t("monitoring.vmCount"), value: String(vms.length) },
    { label: t("monitoring.avgCpu"), value: `${avgCPU.toFixed(1)}%` },
    { label: t("monitoring.totalMemory"), value: `${fmtBytes(usedMem)} / ${fmtBytes(totalMem)}` },
    { label: t("monitoring.totalDisk"), value: `${fmtBytes(usedDisk)} / ${fmtBytes(totalDisk)}` },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => (
        <Card key={c.label} className="bg-surface-1">
          <CardContent className="p-4">
            <div className="text-caption font-[510] text-text-tertiary uppercase tracking-wide mb-1">
              {c.label}
            </div>
            <div className="text-h3 font-[510] tabular-nums tracking-[-0.24px] text-foreground">
              {c.value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="bg-surface-1">
      <CardHeader className="border-b border-border">
        <CardTitle className="text-h3">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

function CPUChart({ vms }: { vms: VMMetric[] }) {
  const { t } = useTranslation();
  const chartData = vms.map((v) => ({
    name: v.name,
    user: +v.cpu_user_pct.toFixed(1),
    system: +v.cpu_system_pct.toFixed(1),
  }));

  return (
    <ChartCard title={t("monitoring.cpu")}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
          <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
          <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => `${v}%`} />
          <Bar dataKey="user" stackId="cpu" fill="var(--accent)" name={t("monitoring.legendUser")} />
          <Bar dataKey="system" stackId="cpu" fill="var(--status-error)" name={t("monitoring.legendSystem")} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function MemoryChart({ vms }: { vms: VMMetric[] }) {
  const { t } = useTranslation();
  const chartData = vms.map((v) => ({
    name: v.name,
    used: +(v.mem_used_bytes / 1024 / 1024 / 1024).toFixed(2),
    total: +(v.mem_total_bytes / 1024 / 1024 / 1024).toFixed(2),
  }));

  return (
    <ChartCard title={t("monitoring.memory")}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
          <XAxis type="number" tickFormatter={(v) => `${v} GB`} />
          <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => `${v} GB`} />
          <Bar dataKey="total" fill="var(--surface-tint-3)" name={t("monitoring.memTotal")} />
          <Bar dataKey="used" fill="var(--accent)" name={t("monitoring.memUsed")} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function DiskChart({ vms }: { vms: VMMetric[] }) {
  const { t } = useTranslation();
  const chartData = vms
    .filter((v) => v.disk_total_bytes > 0)
    .map((v) => ({ name: v.name, pct: +v.disk_used_pct.toFixed(1) }));

  return (
    <ChartCard title={t("monitoring.disk")}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
          <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
          <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => `${v}%`} />
          <Bar dataKey="pct" name={t("monitoring.usageLegend")}>
            {chartData.map((_, i) => (
              <Cell
                key={i}
                fill={
                  chartData[i].pct > 90
                    ? "var(--status-error)"
                    : chartData[i].pct > 70
                      ? "var(--status-warning)"
                      : "var(--status-success)"
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function NetworkChart({ vms }: { vms: VMMetric[] }) {
  const { t } = useTranslation();
  const chartData = vms
    .filter((v) => v.net_rx_bytes > 0 || v.net_tx_bytes > 0)
    .map((v) => ({
      name: v.name,
      rx: +(v.net_rx_bytes / 1024 / 1024).toFixed(1),
      tx: +(v.net_tx_bytes / 1024 / 1024).toFixed(1),
    }));

  if (chartData.length === 0) {
    return (
      <ChartCard title={t("monitoring.network")}>
        <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
          {t("monitoring.noNetworkData")}
        </div>
      </ChartCard>
    );
  }

  return (
    <ChartCard title={t("monitoring.network")}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
          <XAxis type="number" tickFormatter={(v) => `${v} MB`} />
          <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => `${v} MB`} />
          <Bar dataKey="rx" fill="var(--status-success)" name={t("monitoring.netReceive")} />
          <Bar dataKey="tx" fill="var(--accent)" name={t("monitoring.netSend")} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function VMTable({ vms }: { vms: VMMetric[] }) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<"cpu" | "mem" | "disk">("cpu");

  const sorted = [...vms].sort((a, b) => {
    if (sort === "cpu") return b.cpu_user_pct + b.cpu_system_pct - (a.cpu_user_pct + a.cpu_system_pct);
    if (sort === "mem") return b.mem_used_pct - a.mem_used_pct;
    return b.disk_used_pct - a.disk_used_pct;
  });

  const sortLabel = (s: "cpu" | "mem" | "disk") =>
    s === "cpu" ? "CPU" : s === "mem" ? t("monitoring.sortMem") : t("monitoring.sortDisk");

  return (
    <Card className="bg-surface-1 overflow-hidden">
      <CardHeader className="border-b border-border flex-row items-center justify-between">
        <CardTitle className="text-h3">{t("monitoring.vmMetricsTitle")}</CardTitle>
        <div className="flex gap-1">
          {(["cpu", "mem", "disk"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              className={cn(
                "px-2.5 h-7 rounded-md text-label font-[510] transition-colors",
                sort === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-2 text-text-tertiary hover:bg-surface-3",
              )}
            >
              {sortLabel(s)}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-1 border-b border-border">
              <tr>
                <th className="text-left px-4 py-2 font-[510] text-label text-text-tertiary">VM</th>
                <th className="text-right px-4 py-2 font-[510] text-label text-text-tertiary">CPU</th>
                <th className="text-right px-4 py-2 font-[510] text-label text-text-tertiary">{t("monitoring.sortMem")}</th>
                <th className="text-right px-4 py-2 font-[510] text-label text-text-tertiary">{t("monitoring.sortDisk")}</th>
                <th className="text-right px-4 py-2 font-[510] text-label text-text-tertiary">{t("monitoring.networkColumn")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((vm) => (
                <tr key={vm.name} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-caption">{vm.name}</td>
                  <td className="px-4 py-2 text-right">
                    <UsageBadge pct={vm.cpu_user_pct + vm.cpu_system_pct} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <UsageBadge pct={vm.mem_used_pct} />
                    <span className="text-caption text-muted-foreground ml-1">
                      {fmtBytes(vm.mem_used_bytes)}/{fmtBytes(vm.mem_total_bytes)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <UsageBadge pct={vm.disk_used_pct} />
                    <span className="text-caption text-muted-foreground ml-1">
                      {fmtBytes(vm.disk_used_bytes)}/{fmtBytes(vm.disk_total_bytes)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-caption text-muted-foreground">
                    {fmtBytes(vm.net_rx_bytes)} / {fmtBytes(vm.net_tx_bytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function UsageBadge({ pct }: { pct: number }) {
  const tone =
    pct > 90
      ? "text-status-error border-status-error/40"
      : pct > 70
        ? "text-status-warning border-status-warning/40"
        : "text-status-success border-status-success/40";
  return (
    <span
      className={cn(
        "inline-block rounded-pill border px-1.5 py-0.5 text-label font-[510] tabular-nums",
        tone,
      )}
    >
      {pct.toFixed(1)}%
    </span>
  );
}

function fmtBytes(bytes: number): string {
  if (bytes === 0) return "0";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
  const val = bytes / 1024 ** i;
  return `${val.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}
