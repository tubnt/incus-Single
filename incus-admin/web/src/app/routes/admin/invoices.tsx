import type { PageParams } from "@/shared/lib/pagination";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminInvoicesQuery } from "@/features/billing/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Card, CardContent } from "@/shared/components/ui/card";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { Pagination } from "@/shared/components/ui/pagination";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { StatusPill } from "@/shared/components/ui/status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { formatInvoiceStatus } from "@/shared/lib/status-i18n";
import { formatCurrency, formatDate } from "@/shared/lib/utils";

export const Route = createFileRoute("/admin/invoices")({
  component: AdminInvoicesPage,
});

function AdminInvoicesPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState<PageParams>({ limit: 50, offset: 0 });
  const { data, isLoading } = useAdminInvoicesQuery(page);
  const invoices = data?.invoices ?? [];
  const total = data?.total ?? invoices.length;

  return (
    <PageShell>
      <PageHeader
        title={t("admin.invoices.title", { defaultValue: "发票管理" })}
      />
      <PageContent>
        {isLoading ? (
          <Card>
            <CardContent className="p-4 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
        ) : invoices.length === 0 ? (
          <EmptyState
            title={t("admin.invoices.empty", { defaultValue: "暂无发票记录" })}
          />
        ) : (
          <>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>ID</TableHead>
                    <TableHead>
                      {t("admin.invoices.orderId", { defaultValue: "订单" })}
                    </TableHead>
                    <TableHead>
                      {t("admin.invoices.userId", { defaultValue: "用户" })}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("admin.invoices.amount", { defaultValue: "金额" })}
                    </TableHead>
                    <TableHead>
                      {t("admin.invoices.status", { defaultValue: "状态" })}
                    </TableHead>
                    <TableHead>
                      {t("admin.invoices.dueAt", { defaultValue: "到期日" })}
                    </TableHead>
                    <TableHead>
                      {t("admin.invoices.paidAt", { defaultValue: "支付日" })}
                    </TableHead>
                    <TableHead>
                      {t("admin.invoices.createdAt", {
                        defaultValue: "创建时间",
                      })}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-xs">
                        #{inv.id}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        #{inv.order_id}
                      </TableCell>
                      <TableCell className="text-xs">{inv.user_id}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatCurrency(inv.amount, inv.currency)}
                      </TableCell>
                      <TableCell>
                        <InvoiceStatusPill status={inv.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {inv.due_at
                          ? formatDate(inv.due_at)
                          : "-"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {inv.paid_at
                          ? formatDate(inv.paid_at)
                          : "-"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(inv.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
            <Pagination
              total={total}
              limit={page.limit}
              offset={page.offset}
              onChange={(limit, offset) => setPage({ limit, offset })}
              className="mt-3"
            />
          </>
        )}
      </PageContent>
    </PageShell>
  );
}

function InvoiceStatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  const kind = (() => {
    switch (status) {
      case "paid":
        return "success" as const;
      case "pending":
        return "pending" as const;
      case "overdue":
        return "error" as const;
      case "cancelled":
        return "disabled" as const;
      default:
        return "disabled" as const;
    }
  })();
  return <StatusPill status={kind}>{formatInvoiceStatus(t, status)}</StatusPill>;
}
