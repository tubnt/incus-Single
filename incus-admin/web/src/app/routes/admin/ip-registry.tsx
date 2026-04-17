import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useIPRegistryQuery } from "@/features/ip-pools/api";

export const Route = createFileRoute("/admin/ip-registry")({
  component: IPRegistryPage,
});

function IPRegistryPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const { data, isLoading } = useIPRegistryQuery();

  const ips = data?.ips ?? [];
  const filtered = search
    ? ips.filter((ip) => ip.ip.includes(search) || ip.vm.includes(search))
    : ips;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("admin.ipRegistry.title", { defaultValue: "IP Registry" })}</h1>
        <span className="text-xs text-muted-foreground">
          {t("admin.ipRegistry.assignedCount", { count: data?.count ?? 0, defaultValue: "{{count}} addresses assigned" })}
        </span>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("admin.ipRegistry.searchPlaceholder", { defaultValue: "Search by IP or VM name..." })}
        className="w-full px-4 py-2 mb-4 rounded-lg border border-border bg-card text-sm"
      />

      {isLoading ? (
        <div className="text-muted-foreground">{t("common.loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="border border-border rounded-lg p-6 text-center text-muted-foreground">
          {t("admin.ipRegistry.empty", { defaultValue: "No IP addresses assigned." })}
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2 font-medium">{t("admin.ipRegistry.ip", { defaultValue: "IP Address" })}</th>
                <th className="text-left px-4 py-2 font-medium">VM</th>
                <th className="text-left px-4 py-2 font-medium">{t("vm.status")}</th>
                <th className="text-left px-4 py-2 font-medium">{t("vm.node")}</th>
                <th className="text-left px-4 py-2 font-medium">{t("admin.ipRegistry.clusterProject", { defaultValue: "Cluster / Project" })}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ip) => (
                <tr key={ip.ip + ip.vm} className="border-t border-border">
                  <td className="px-4 py-2 font-mono">{ip.ip}</td>
                  <td className="px-4 py-2">
                    <a href={`/admin/vm-detail?name=${ip.vm}&cluster=${ip.cluster}&project=${ip.project}`}
                      className="text-primary hover:underline font-mono">{ip.vm}</a>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${ip.status === "Running" ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"}`}>
                      {ip.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">{ip.node}</td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">{ip.cluster} / {ip.project}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
