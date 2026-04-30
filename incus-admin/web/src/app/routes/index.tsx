import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CreditCard, MessageSquare, Plus, Server, Ticket } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMyTicketsQuery } from "@/features/tickets/api";
import { useMyVMsQuery } from "@/features/vms/api";
import { useCommandActions } from "@/shared/components/command-palette/use-command-actions";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Card, CardContent } from "@/shared/components/ui/card";
import { fetchCurrentUser } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/")({
  component: UserDashboard,
});

/**
 * 用户视角首页：
 *   - 3 个 Stat 卡片（VM 数 / 余额 / 工单）
 *   - 快捷操作区
 *   - 命令面板注册：新建 VM / 充值 / 提工单
 */
function UserDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: user } = useQuery({
    queryKey: ["currentUser"],
    queryFn: fetchCurrentUser,
  });
  const { data: vmsData } = useMyVMsQuery();
  const { data: ticketsData } = useMyTicketsQuery();

  const myVmCount = vmsData?.vms?.length ?? 0;
  const openTickets = ticketsData?.tickets?.filter((tk) => tk.status !== "closed").length ?? 0;

  useCommandActions(
    () => [
      {
        id: "user.create-vm",
        title: t("dashboard.quickCreateVm", { defaultValue: "新建云主机" }),
        icon: "Plus",
        keywords: ["vm", "新建", "create"],
        perform: () => navigate({ to: "/billing" }),
      },
      {
        id: "user.tickets-topup",
        title: t("dashboard.quickTopup", { defaultValue: "充值" }),
        icon: "CreditCard",
        keywords: ["topup", "余额", "充值"],
        perform: () => navigate({ to: "/tickets", search: { subject: "topup" } as any }),
      },
      {
        id: "user.create-ticket",
        title: t("dashboard.quickCreateTicket", { defaultValue: "提工单" }),
        icon: "MessageSquare",
        keywords: ["ticket", "工单"],
        perform: () => navigate({ to: "/tickets" }),
      },
    ],
    [navigate, t],
  );

  return (
    <PageShell>
      <PageHeader
        title={t("nav.dashboard")}
        description={t("dashboard.welcome", {
          defaultValue: "你的云主机、余额和工单全景。",
        })}
      />
      <PageContent>
        <QuickActions highlightCreate={myVmCount === 0} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            title={t("vm.title")}
            value={myVmCount}
            icon={<Server size={16} aria-hidden="true" />}
          />
          <StatCard
            title={t("common.balance")}
            value={user ? `$${user.balance.toFixed(2)}` : "—"}
            icon={<CreditCard size={16} aria-hidden="true" />}
          />
          <StatCard
            title={t("ticket.title")}
            value={openTickets}
            icon={<Ticket size={16} aria-hidden="true" />}
          />
        </div>
      </PageContent>
    </PageShell>
  );
}

function QuickActions({ highlightCreate }: { highlightCreate: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      <ActionLink
        to="/billing"
        icon={<Plus size={14} aria-hidden="true" />}
        label={t("dashboard.quickCreateVm", { defaultValue: "新建云主机" })}
        highlighted={highlightCreate}
      />
      <ActionLink
        to="/tickets"
        search={{ subject: "topup" }}
        icon={<CreditCard size={14} aria-hidden="true" />}
        label={t("dashboard.quickTopup", { defaultValue: "充值" })}
      />
      <ActionLink
        to="/tickets"
        icon={<MessageSquare size={14} aria-hidden="true" />}
        label={t("dashboard.quickCreateTicket", { defaultValue: "提工单" })}
      />
    </div>
  );
}

function ActionLink({
  to,
  search,
  icon,
  label,
  highlighted,
}: {
  to: string;
  search?: Record<string, string>;
  icon: React.ReactNode;
  label: string;
  highlighted?: boolean;
}) {
  return (
    <Link
      to={to as any}
      search={search as any}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3.5 h-9 text-sm font-emphasis transition-colors",
        highlighted
          ? "bg-primary text-primary-foreground hover:bg-accent-hover"
          : "border border-border bg-surface-1 text-foreground hover:bg-surface-2",
      )}
    >
      {icon}
      {label}
    </Link>
  );
}

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: number | string;
  icon?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption font-emphasis text-text-tertiary uppercase tracking-wide">
            {title}
          </span>
          <span className="text-text-tertiary">{icon}</span>
        </div>
        <div className="mt-1 text-h2 font-emphasis tabular-nums text-foreground">
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
