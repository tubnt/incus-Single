import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useIPRegistryQuery } from "@/features/ip-pools/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Card } from "@/shared/components/ui/card";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { Input } from "@/shared/components/ui/input";
import { StatusPill } from "@/shared/components/ui/status";

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
    <PageShell>
      <PageHeader
        title={t("admin.ipRegistry.title", { defaultValue: "IP Registry" })}
        meta={
          <span className="text-xs text-muted-foreground">
            {t("admin.ipRegistry.assignedCount", {
              count: data?.count ?? 0,
              defaultValue: "{{count}} addresses assigned",
            })}
          </span>
        }
      />
      <PageContent>
        <Input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("admin.ipRegistry.searchPlaceholder", {
            defaultValue: "Search by IP or VM name...",
          })}
        />

        {isLoading ? (
          <div className="text-muted-foreground">{t("common.loading")}</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={t("admin.ipRegistry.empty", {
              defaultValue: "No IP addresses assigned.",
            })}
          />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm [&_tbody>tr]:transition-colors [&_tbody>tr]:hover:bg-surface-1">
              <thead className="bg-surface-1 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2 text-label font-[510] text-text-tertiary">
                    {t("admin.ipRegistry.ip", { defaultValue: "IP Address" })}
                  </th>
                  <th className="text-left px-4 py-2 text-label font-[510] text-text-tertiary">VM</th>
                  <th className="text-left px-4 py-2 text-label font-[510] text-text-tertiary">{t("vm.status")}</th>
                  <th className="text-left px-4 py-2 text-label font-[510] text-text-tertiary">{t("vm.node")}</th>
                  <th className="text-left px-4 py-2 text-label font-[510] text-text-tertiary">
                    {t("admin.ipRegistry.clusterProject", {
                      defaultValue: "Cluster / Project",
                    })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ip) => (
                  <tr key={ip.ip + ip.vm} className="border-t border-border">
                    <td className="px-4 py-2 font-mono">{ip.ip}</td>
                    <td className="px-4 py-2">
                      <Link
                        to="/admin/vm-detail"
                        search={{
                          name: ip.vm,
                          cluster: ip.cluster,
                          project: ip.project,
                        }}
                        className="text-primary hover:underline font-mono"
                      >
                        {ip.vm}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <StatusPill
                        status={ip.status === "Running" ? "success" : "disabled"}
                      >
                        {ip.status}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-2">{ip.node}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">
                      {ip.cluster} / {ip.project}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </PageContent>
    </PageShell>
  );
}
