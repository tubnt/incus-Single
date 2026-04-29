import type {VMMetric} from "@/features/monitoring/api";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMetricsOverviewQuery  } from "@/features/monitoring/api";

export const Route = createFileRoute("/admin/monitoring")({
  component: MonitoringPage,
});

function MonitoringPage() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useMetricsOverviewQuery();

  const clusters = data?.clusters ?? [];
  const allVMs = clusters.flatMap((c) => c.vms ?? []);
  const hasWarning = data?.warning;
  const dbRunningTotal = clusters.reduce(
    (sum, c) => sum + (c.db_running_count ?? 0),
    0,
  );
  const drifted = allVMs.length === 0 && dbRunningTotal > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("monitoring.title")}</h1>
        <span className="text-xs text-muted-foreground">
          {t("monitoring.refresh")}
        </span>
      </div>

      {hasWarning && (
        <div className="border border-warning/30 rounded-lg p-3 mb-4 text-sm text-warning">
          ⚠ {hasWarning}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border border-border rounded-lg bg-card p-4 space-y-2">
              <div className="h-3 w-16 animate-pulse rounded bg-muted" />
              <div className="h-6 w-24 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="border border-destructive/30 rounded-lg p-4 text-destructive text-sm">
          {t("monitoring.fetchFailed", { error: (error as Error).message })}
        </div>
      ) : allVMs.length === 0 ? (
        <div className="border border-border rounded-lg p-6 text-center text-muted-foreground">
          {drifted
            ? t("monitoring.noDataDrift", { count: dbRunningTotal })
            : t("monitoring.noData")}
        </div>
      ) : (
        <div className="space-y-6">
          <SummaryCards vms={allVMs} />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <CPUChart vms={allVMs} />
            <MemoryChart vms={allVMs} />
            <DiskChart vms={allVMs} />
            <NetworkChart vms={allVMs} />
          </div>
          <VMTable vms={allVMs} />
        </div>
      )}
    </div>
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
      ? vms.reduce((s, v) => s + v.cpu_user_pct + v.cpu_system_pct, 0) /
        vms.length
      : 0;

  const cards = [
    { label: t("monitoring.vmCount"), value: String(vms.length) },
    { label: t("monitoring.avgCpu"), value: `${avgCPU.toFixed(1)}%` },
    {
      label: t("monitoring.totalMemory"),
      value: `${fmtBytes(usedMem)} / ${fmtBytes(totalMem)}`,
    },
    {
      label: t("monitoring.totalDisk"),
      value: `${fmtBytes(usedDisk)} / ${fmtBytes(totalDisk)}`,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="border border-border rounded-lg bg-card p-4"
        >
          <div className="text-xs text-muted-foreground mb-1">{c.label}</div>
          <div className="text-lg font-semibold">{c.value}</div>
        </div>
      ))}
    </div>
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
          <Bar dataKey="user" stackId="cpu" fill="var(--color-primary)" name={t("monitoring.legendUser")} />
          <Bar dataKey="system" stackId="cpu" fill="var(--color-destructive)" name={t("monitoring.legendSystem")} />
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
    pct: +v.mem_used_pct.toFixed(1),
  }));

  return (
    <ChartCard title={t("monitoring.memory")}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
          <XAxis type="number" tickFormatter={(v) => `${v} GB`} />
          <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => `${v} GB`} />
          <Bar dataKey="total" fill="var(--color-muted)" name={t("monitoring.memTotal")} />
          <Bar dataKey="used" fill="var(--color-primary)" name={t("monitoring.memUsed")} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function DiskChart({ vms }: { vms: VMMetric[] }) {
  const { t } = useTranslation();
  const chartData = vms
    .filter((v) => v.disk_total_bytes > 0)
    .map((v) => ({
      name: v.name,
      pct: +v.disk_used_pct.toFixed(1),
    }));

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
                    ? "var(--color-destructive)"
                    : chartData[i].pct > 70
                      ? "#f59e0b"
                      : "var(--color-success)"
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
          <Bar dataKey="rx" fill="var(--color-success)" name={t("monitoring.netReceive")} />
          <Bar dataKey="tx" fill="var(--color-primary)" name={t("monitoring.netSend")} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function VMTable({ vms }: { vms: VMMetric[] }) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<"cpu" | "mem" | "disk">("cpu");

  const sorted = [...vms].sort((a, b) => {
    if (sort === "cpu")
      return (
        b.cpu_user_pct + b.cpu_system_pct - (a.cpu_user_pct + a.cpu_system_pct)
      );
    if (sort === "mem") return b.mem_used_pct - a.mem_used_pct;
    return b.disk_used_pct - a.disk_used_pct;
  });

  const sortLabel = (s: "cpu" | "mem" | "disk") =>
    s === "cpu" ? "CPU" : s === "mem" ? t("monitoring.sortMem") : t("monitoring.sortDisk");

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold text-sm">{t("monitoring.vmMetricsTitle")}</h3>
        <div className="flex gap-1">
          {(["cpu", "mem", "disk"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`px-2 py-1 text-xs rounded ${sort === s ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
            >
              {sortLabel(s)}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left px-4 py-2 font-medium">VM</th>
              <th className="text-right px-4 py-2 font-medium">CPU</th>
              <th className="text-right px-4 py-2 font-medium">{t("monitoring.sortMem")}</th>
              <th className="text-right px-4 py-2 font-medium">{t("monitoring.sortDisk")}</th>
              <th className="text-right px-4 py-2 font-medium">{t("monitoring.networkColumn")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((vm) => (
              <tr key={vm.name} className="border-t border-border">
                <td className="px-4 py-2 font-mono text-xs">{vm.name}</td>
                <td className="px-4 py-2 text-right">
                  <UsageBadge pct={vm.cpu_user_pct + vm.cpu_system_pct} />
                </td>
                <td className="px-4 py-2 text-right">
                  <UsageBadge pct={vm.mem_used_pct} />
                  <span className="text-xs text-muted-foreground ml-1">
                    {fmtBytes(vm.mem_used_bytes)}/{fmtBytes(vm.mem_total_bytes)}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  <UsageBadge pct={vm.disk_used_pct} />
                  <span className="text-xs text-muted-foreground ml-1">
                    {fmtBytes(vm.disk_used_bytes)}/{fmtBytes(vm.disk_total_bytes)}
                  </span>
                </td>
                <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                  {fmtBytes(vm.net_rx_bytes)} / {fmtBytes(vm.net_tx_bytes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsageBadge({ pct }: { pct: number }) {
  const color =
    pct > 90
      ? "bg-destructive/20 text-destructive"
      : pct > 70
        ? "bg-warning/20 text-warning"
        : "bg-success/20 text-success";
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>
      {pct.toFixed(1)}%
    </span>
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
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function fmtBytes(bytes: number): string {
  if (bytes === 0) return "0";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
  const val = bytes / 1024**i;
  return `${val.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}
