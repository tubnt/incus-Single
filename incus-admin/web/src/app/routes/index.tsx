import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, CreditCard, MessageSquare } from "lucide-react";
import { fetchCurrentUser } from "@/shared/lib/auth";
import { useMyVMsQuery } from "@/features/vms/api";
import { useMyTicketsQuery } from "@/features/tickets/api";

export const Route = createFileRoute("/")({
  component: UserDashboard,
});

// `/` 是用户视角仪表盘。管理员视角走独立路由 `/admin/monitoring`，本组件不再渲染 admin 汇总卡片。
function UserDashboard() {
  const { t } = useTranslation();
  const { data: user } = useQuery({
    queryKey: ["currentUser"],
    queryFn: fetchCurrentUser,
  });

  const { data: vmsData } = useMyVMsQuery();
  const { data: ticketsData } = useMyTicketsQuery();

  const myVmCount = vmsData?.vms?.length ?? 0;
  const openTickets = ticketsData?.tickets?.filter((tk) => tk.status !== "closed").length ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t("nav.dashboard")}</h1>

      <QuickActions highlightCreate={myVmCount === 0} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatCard title={t("vm.title")} value={String(myVmCount)} />
        <StatCard title={t("common.balance")} value={user ? `$${user.balance.toFixed(2)}` : "—"} />
        <StatCard title={t("ticket.title")} value={String(openTickets)} />
      </div>
    </div>
  );
}

function QuickActions({ highlightCreate }: { highlightCreate: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      <ActionLink
        href="/billing"
        icon={<Plus size={16} />}
        label={t("dashboard.quickCreateVm", { defaultValue: "新建云主机" })}
        highlighted={highlightCreate}
      />
      <ActionLink
        href="/tickets?subject=topup"
        icon={<CreditCard size={16} />}
        label={t("dashboard.quickTopup", { defaultValue: "充值" })}
      />
      <ActionLink
        href="/tickets"
        icon={<MessageSquare size={16} />}
        label={t("dashboard.quickCreateTicket", { defaultValue: "提工单" })}
      />
    </div>
  );
}

function ActionLink({
  href,
  icon,
  label,
  highlighted,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  highlighted?: boolean;
}) {
  const base = "inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors";
  const classes = highlighted
    ? "bg-primary text-primary-foreground hover:opacity-90"
    : "border border-border bg-card hover:bg-muted/50";
  return (
    <a href={href} className={`${base} ${classes}`}>
      {icon}
      {label}
    </a>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
