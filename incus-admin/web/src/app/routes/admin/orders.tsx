import type { AdminOrderStatus } from "@/features/billing/api";
import type { PageParams } from "@/shared/lib/pagination";
import { createFileRoute } from "@tanstack/react-router";
import { Ban, Check, FileX } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useAdminOrdersQuery,
  useAdminUpdateOrderStatusMutation,
} from "@/features/billing/api";
import { useAdminProductsQuery } from "@/features/products/api";
import { useAdminUsersQuery } from "@/features/users/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
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
import { formatError } from "@/shared/lib/http";
import { formatOrderStatus } from "@/shared/lib/status-i18n";
import { formatCurrency, formatDate, formatDateTime } from "@/shared/lib/utils";

export const Route = createFileRoute("/admin/orders")({
  component: AdminOrdersPage,
});

function AdminOrdersPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [page, setPage] = useState<PageParams>({ limit: 50, offset: 0 });
  const { data, isLoading } = useAdminOrdersQuery(page);
  const updateStatus = useAdminUpdateOrderStatusMutation();
  // OPS-028 P3.2：把 user_id / product_id 映射成 email / 产品名（admin 视角
  // 不必让运维记数字）。用 limit=200 一次拉够 — 用户+产品数量级很小。
  const usersQuery = useAdminUsersQuery({ limit: 200, offset: 0 });
  const productsQuery = useAdminProductsQuery({ limit: 200, offset: 0 });
  const orders = data?.orders ?? [];
  const total = data?.total ?? orders.length;
  const userEmail = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of usersQuery.data?.users ?? []) m.set(u.id, u.email);
    return m;
  }, [usersQuery.data]);
  const productName = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of productsQuery.data?.products ?? []) m.set(p.id, p.name);
    return m;
  }, [productsQuery.data]);

  const transition = async (
    orderId: number,
    status: AdminOrderStatus,
    confirmTitleKey: string,
    confirmMessageKey: string,
    destructive: boolean,
  ) => {
    const ok = await confirm({
      title: t(confirmTitleKey, {
        defaultValue:
          status === "paid" ? "批准订单" : status === "cancelled" ? "拒绝订单" : "作废订单",
      }),
      message: t(confirmMessageKey, {
        defaultValue: `确认将订单 #${orderId} 状态置为 ${status}？`,
        orderId,
        status,
      }),
      destructive,
    });
    if (!ok) return;
    updateStatus.mutate(
      { orderId, status },
      {
        onSuccess: () =>
          toast.success(
            t("admin.orders.statusChanged", {
              defaultValue: "订单 #{{id}} 已置为 {{status}}",
              id: orderId,
              status,
            }),
          ),
        onError: (e) => toast.error(formatError(e)),
      },
    );
  };

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
                    <TableHead className="text-right">
                      {t("vm.actions", { defaultValue: "操作" })}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>{o.id}</TableCell>
                      <TableCell className="text-xs">
                        {userEmail.get(o.user_id) ?? `#${o.user_id}`}
                      </TableCell>
                      <TableCell className="text-xs">
                        {productName.get(o.product_id) ?? `#${o.product_id}`}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatCurrency(o.amount, o.currency)}
                      </TableCell>
                      <TableCell>
                        <OrderStatusPill status={o.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {o.expires_at
                          ? formatDate(o.expires_at)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateTime(o.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {o.status === "pending" ? (
                            <>
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={updateStatus.isPending}
                                onClick={() =>
                                  transition(
                                    o.id,
                                    "paid",
                                    "admin.orders.approveTitle",
                                    "admin.orders.approveMessage",
                                    false,
                                  )
                                }
                              >
                                <Check size={12} aria-hidden="true" />
                                {t("admin.orders.approve", { defaultValue: "批准" })}
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={updateStatus.isPending}
                                onClick={() =>
                                  transition(
                                    o.id,
                                    "cancelled",
                                    "admin.orders.rejectTitle",
                                    "admin.orders.rejectMessage",
                                    true,
                                  )
                                }
                              >
                                <Ban size={12} aria-hidden="true" />
                                {t("admin.orders.reject", { defaultValue: "拒绝" })}
                              </Button>
                            </>
                          ) : null}
                          {o.status === "paid" || o.status === "active" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={updateStatus.isPending}
                              onClick={() =>
                                transition(
                                  o.id,
                                  "expired",
                                  "admin.orders.expireTitle",
                                  "admin.orders.expireMessage",
                                  true,
                                )
                              }
                            >
                              <FileX size={12} aria-hidden="true" />
                              {t("admin.orders.expire", { defaultValue: "作废" })}
                            </Button>
                          ) : null}
                        </div>
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
  const { t } = useTranslation();
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
  return <StatusPill status={kind}>{formatOrderStatus(t, status)}</StatusPill>;
}
