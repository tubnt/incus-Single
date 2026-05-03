import type {PageParams} from "@/features/users/api";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck, UserCog } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useAdminUsersQuery,
  useBatchUserMutation,
} from "@/features/users/api";
import { UserRow } from "@/features/users/components/user-row";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { BatchToolbar } from "@/shared/components/ui/batch-toolbar";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { Pagination } from "@/shared/components/ui/pagination";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

export const Route = createFileRoute("/admin/users")({
  component: UsersPage,
});

function UsersPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [page, setPage] = useState<PageParams>({ limit: 50, offset: 0 });
  const [selectedIds, setSelectedIds] = useState<Record<number, boolean>>({});
  const { data, isLoading } = useAdminUsersQuery(page);
  const users = data?.users ?? [];
  const total = data?.total ?? users.length;
  const batchMutation = useBatchUserMutation();

  const selected = useMemo(
    () =>
      Object.entries(selectedIds)
        .filter(([, v]) => v)
        .map(([k]) => Number(k)),
    [selectedIds],
  );
  const clearSelection = () => setSelectedIds({});

  const allChecked = users.length > 0 && users.every((u) => selectedIds[u.id]);
  const someChecked = users.some((u) => selectedIds[u.id]);

  const toggleAll = (next: boolean) => {
    if (next) {
      const all: Record<number, boolean> = {};
      users.forEach((u) => { all[u.id] = true; });
      setSelectedIds(all);
    } else {
      setSelectedIds({});
    }
  };

  const runBatchRole = async (role: "admin" | "customer") => {
    if (selected.length === 0) return;
    const ok = await confirm({
      title:
        role === "customer"
          ? t("admin.users.batchDowngradeTitle", { defaultValue: "批量降级为 customer？" })
          : t("admin.users.batchPromoteTitle", { defaultValue: "批量提升为 admin？" }),
      message:
        role === "customer"
          ? t("admin.users.batchDowngradeMessage", {
              defaultValue: "将把 {{count}} 个用户降级为 customer，他们会失去管理权限。请输入 DOWNGRADE 以确认。",
              count: selected.length,
            })
          : t("admin.users.batchPromoteMessage", {
              defaultValue: "将把 {{count}} 个用户提升为 admin。",
              count: selected.length,
            }),
      destructive: role === "customer",
      typeToConfirm: role === "customer" ? "DOWNGRADE" : undefined,
      typeToConfirmLabel:
        role === "customer"
          ? t("confirmDialog.typeDowngrade", { defaultValue: "请输入 DOWNGRADE 以确认" })
          : undefined,
    });
    if (!ok) return;
    batchMutation.mutate(
      { ids: selected, action: "change_role", role },
      {
        onSuccess: (res) => {
          if (res.failed.length === 0) {
            toast.success(
              t("admin.users.batchSuccess", {
                defaultValue: "批量改角色成功（{{count}}）",
                count: res.succeeded.length,
              }),
            );
          } else {
            toast.warning(
              t("admin.users.batchPartial", {
                defaultValue: "部分成功：成功 {{ok}}，失败 {{fail}}",
                ok: res.succeeded.length,
                fail: res.failed.length,
              }),
              {
                description: res.failed.map((f) => `#${f.key}: ${f.error}`).join("\n"),
                duration: 15000,
              },
            );
          }
          clearSelection();
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  return (
    <PageShell>
      <PageHeader
        title={`${t("admin.users.title", { defaultValue: "Users" })} (${total})`}
      />
      <PageContent>
        <BatchToolbar count={selected.length} onClear={clearSelection}>
          <Button
            size="sm"
            variant="ghost"
            disabled={batchMutation.isPending}
            onClick={() => runBatchRole("admin")}
          >
            <ShieldCheck size={12} aria-hidden="true" />
            {t("admin.users.batchPromoteAdmin", { defaultValue: "批量设为 admin" })}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={batchMutation.isPending}
            onClick={() => runBatchRole("customer")}
          >
            <UserCog size={12} aria-hidden="true" />
            {t("admin.users.batchDowngradeCustomer", { defaultValue: "批量降级 customer" })}
          </Button>
        </BatchToolbar>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allChecked}
                        indeterminate={!allChecked && someChecked}
                        onCheckedChange={(v) => toggleAll(v)}
                        aria-label={t("dataTable.selectAll", { defaultValue: "全选" })}
                      />
                    </TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>
                      {t("admin.email", { defaultValue: "Email" })}
                    </TableHead>
                    <TableHead>
                      {t("admin.role", { defaultValue: "Role" })}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("common.balance", { defaultValue: "Balance" })}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("vm.actions", { defaultValue: "Actions" })}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <UserRow
                      key={u.id}
                      user={u}
                      selected={!!selectedIds[u.id]}
                      onSelect={(next) =>
                        setSelectedIds((prev) => ({ ...prev, [u.id]: next }))
                      }
                    />
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
