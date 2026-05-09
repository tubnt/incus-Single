import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useClustersQuery } from "@/features/clusters/api";
import { NodeTopologyStrip } from "@/features/nodes/components/node-topology-strip";
import { ClusterVMsTable } from "@/features/vms/components/cluster-vms-table";
import { DriftVMsPanel } from "@/features/vms/components/drift-vms-panel";
import { useCommandActions } from "@/shared/components/command-palette/use-command-actions";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { buttonVariants } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

// PLAN-037 / OPS-040：URL 同步的 ?node=xxx 过滤值，前后端 admin/vms 与
// admin/nodes 之间共享，方便点击 NodeTopologyStrip chip 跳转。
interface AdminVMsSearch {
  node?: string;
}

export const Route = createFileRoute("/admin/vms")({
  component: AllVMsPage,
  validateSearch: (search: Record<string, unknown>): AdminVMsSearch => {
    const node = typeof search.node === "string" ? search.node : undefined;
    return node ? { node } : {};
  },
});

function AllVMsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: "/admin/vms" });
  const search = Route.useSearch();
  const nodeFilter = search.node ?? "";
  const setNodeFilter = (node: string) => {
    navigate({ search: node ? { node } : {} });
  };
  const { data: clustersData } = useClustersQuery();
  const clusters = clustersData?.clusters ?? [];

  useCommandActions(
    () => [
      {
        id: "vms.create",
        title: t("nav.createVm"),
        icon: "Plus",
        keywords: ["new", "vm", "create", "新建"],
        perform: () => navigate({ to: "/admin/create-vm" }),
      },
      {
        id: "vms.monitoring",
        title: t("nav.monitor"),
        icon: "Activity",
        perform: () => navigate({ to: "/admin/monitoring" }),
      },
    ],
    [navigate, t],
  );

  return (
    <PageShell>
      <PageHeader
        title={t("nav.allVms")}
        description={t("admin.vmsDescription", {
          defaultValue: "跨集群 VM 总览。点击 VM 名称查看详情；操作通过行内菜单。",
        })}
        breadcrumbs={[
          { label: t("nav.adminRoot", { defaultValue: "管理员" }) },
          { label: t("nav.allVms") },
        ]}
        actions={
          <Link
            to="/admin/create-vm"
            className={cn(buttonVariants({ variant: "primary" }))}
          >
            <Plus size={14} aria-hidden="true" />
            {t("nav.createVm")}
          </Link>
        }
      />
      <PageContent>
        <DriftVMsPanel />
        {/* PLAN-037 / OPS-040：每集群一个节点分布条带；点击 chip 设置 ?node= 过滤 */}
        {clusters.map((c) => (
          <NodeTopologyStrip
            key={`topo-${c.name}`}
            clusterName={c.name}
            onNodeClick={(n) => setNodeFilter(n === nodeFilter ? "" : n)}
          />
        ))}
        {clusters.map((c) => (
          <ClusterVMsTable
            key={c.name}
            clusterName={c.name}
            displayName={c.display_name}
            nodeFilter={nodeFilter}
            onNodeFilterChange={setNodeFilter}
          />
        ))}
      </PageContent>
    </PageShell>
  );
}
