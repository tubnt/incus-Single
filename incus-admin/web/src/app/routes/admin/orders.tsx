import type { PageParams } from "@/shared/lib/pagination";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminOrdersQuery } from "@/features/billing/api";
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
import { formatCurrency } from "@/shared/lib/utils";

export const Route = createFileRoute("/admin/orders")({
  component: AdminOrdersPage,
});

function AdminOrdersPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState<PageParams>({ limit: 50, offset: 0 });
  const { data, isLoading } = useAdminOrdersQuery(page);
  const orders = data?.orders ?? [];
  const total = data?.total ?? orders.length;

  return (
    <PageShell>
      <PageHeader title={t("admin.ordersTitle")} />
      <PageContent>
        {isLoading ? (
          <Card>
            <CardContent className="p-4 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
        ) : orders.length === 0 ? (
          <EmptyState title={t("common.noData")} />
        ) : (
          <>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>#</TableHead>
                    <TableHead>{t("admin.orderUser")}</TableHead>
                    <TableHead>{t("admin.orderProduct")}</TableHead>
                    <TableHead className="text-right">
                      {t("admin.orderAmount")}
                    </TableHead>
                    <TableHead>{t("admin.orderStatus")}</TableHead>
                    <TableHead>{t("admin.orderExpires")}</TableHead>
                    <TableHead>{t("admin.orderCreatedAt")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>{o.id}</TableCell>
                      <TableCell className="text-xs">#{o.user_id}</TableCell>
                      <TableCell className="text-xs">
                        #{o.product_id}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatCurrency(o.amount, o.currency)}
                      </TableCell>
                      <TableCell>
                        <OrderStatusPill status={o.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {o.expires_at
                          ? new Date(o.expires_at).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(o.created_at).toLocaleString()}
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

function OrderStatusPill({ status }: { status: string }) {
  const kind = (() => {
    switch (status) {
      case "paid":
      case "active":
      case "provisioned":
        return "success" as const;
      case "pending":
        return "pending" as const;
      case "expired":
        return "stale" as const;
      case "cancelled":
        return "error" as const;
      default:
        return "disabled" as const;
    }
  })();
  return <StatusPill status={kind}>{status}</StatusPill>;
}
