import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useClustersQuery } from "@/features/clusters/api";
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

export const Route = createFileRoute("/admin/vms")({
  component: AllVMsPage,
});

function AllVMsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
        {clusters.map((c) => (
          <ClusterVMsTable
            key={c.name}
            clusterName={c.name}
            displayName={c.display_name}
          />
        ))}
      </PageContent>
    </PageShell>
  );
}
