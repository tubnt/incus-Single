import type {PageParams} from "@/features/users/api";
import type { User } from "@/shared/lib/auth";
import { createFileRoute } from "@tanstack/react-router";
import { CircleDollarSign, ShieldCheck, UserCog } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useAdminUsersQuery,
  useBatchUserMutation,
} from "@/features/users/api";
import { UserDetailSheet } from "@/features/users/components/user-detail-sheet";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Pagination } from "@/shared/components/ui/pagination";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { formatError, http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";
import { formatCurrency } from "@/shared/lib/utils";

export const Route = createFileRoute("/admin/users")({
  component: UsersPage,
});

// 批量充值预设；与 UserDetailSheet 同一档位口径，便于运维形成肌肉记忆。
const BATCH_TOPUP_PRESETS = [10, 50, 200] as const;

function UsersPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [page, setPage] = useState<PageParams>({ limit: 50, offset: 0 });
  const [selectedIds, setSelectedIds] = useState<Record<number, boolean>>({});
  const [openUser, setOpenUser] = useState<User | null>(null);
  const [batchTopUpOpen, setBatchTopUpOpen] = useState(false);
  const [batchAmount, setBatchAmount] = useState<string>("");
  const [batchPending, setBatchPending] = useState(false);
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
        onError: (e) => toast.error(formatError(e)),
      },
    );
  };

  // 批量充值：每人 X 元（不是平均分配 —— 业界 admin top-up 通常按"每人统一额度"
  // 来奖励/补偿一组用户）。后端无 batch endpoint；前端 Promise.all 单笔下发，每笔
  // 独立 audit log。partial 失败时返回数量对比。
  const runBatchTopUp = async (amount: number) => {
    if (!(amount > 0) || selected.length === 0) return;
    const ok = await confirm({
      title: t("admin.users.batchTopUpTitle", { defaultValue: "批量充值" }),
      message: t("admin.users.batchTopUpMessage", {
        defaultValue: "确认给 {{count}} 个用户 每人充值 {{amount}}（合计 {{total}}）？",
        count: selected.length,
        amount: formatCurrency(amount),
        total: formatCurrency(amount * selected.length),
      }),
    });
    if (!ok) return;
    setBatchPending(true);
    const results = await Promise.allSettled(
      selected.map((id) =>
        http.post(
          `/admin/users/${id}/balance`,
          { amount, description: "Admin batch top-up" },
          {
            intent: {
              action: "user.topup",
              args: { user_id: id, amount, batch: true },
              description: `批量充值 #${id} +${amount}`,
            },
          },
        ),
      ),
    );
    setBatchPending(false);
    const okCount = results.filter((r) => r.status === "fulfilled").length;
    const failCount = results.length - okCount;
    queryClient.invalidateQueries({ queryKey: ["user"] });
    if (failCount === 0) {
      toast.success(
        t("admin.users.batchTopUpOk", {
          defaultValue: "批量充值成功：{{n}} 人 × {{amt}}",
          n: okCount,
          amt: formatCurrency(amount),
        }),
      );
    } else {
      toast.warning(
        t("admin.users.batchTopUpPartial", {
          defaultValue: "部分成功：成功 {{ok}} 失败 {{fail}}",
          ok: okCount,
          fail: failCount,
        }),
      );
    }
    setBatchTopUpOpen(false);
    setBatchAmount("");
    clearSelection();
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
            disabled={batchMutation.isPending || batchPending}
            onClick={() => setBatchTopUpOpen(true)}
          >
            <CircleDollarSign size={12} aria-hidden="true" />
            {t("admin.users.batchTopUp", { defaultValue: "批量充值" })}
          </Button>
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
                      onOpen={() => setOpenUser(u)}
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

      <UserDetailSheet
        user={openUser}
        open={openUser !== null}
        onOpenChange={(o) => { if (!o) setOpenUser(null); }}
      />

      <Dialog open={batchTopUpOpen} onOpenChange={setBatchTopUpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.users.batchTopUp", { defaultValue: "批量充值" })}</DialogTitle>
            <DialogDescription>
              {t("admin.users.batchTopUpHint", {
                defaultValue: "已选 {{count}} 个用户。每人将单独入账并产生独立 audit log。",
                count: selected.length,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex flex-wrap gap-1.5">
              {BATCH_TOPUP_PRESETS.map((amt) => (
                <Button
                  key={amt}
                  size="sm"
                  variant={Number.parseFloat(batchAmount) === amt ? "primary" : "subtle"}
                  onClick={() => setBatchAmount(String(amt))}
                >
                  {`+${formatCurrency(amt)}`}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-caption text-text-tertiary">$</span>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={batchAmount}
                onChange={(e) => setBatchAmount(e.target.value)}
                placeholder={t("admin.amount", { defaultValue: "金额" })}
              />
            </div>
            {batchAmount && Number.parseFloat(batchAmount) > 0 ? (
              <p className="text-caption text-text-tertiary">
                {t("admin.users.batchTopUpTotalPreview", {
                  defaultValue: "合计 {{total}}（{{count}} × {{each}}）",
                  total: formatCurrency(Number.parseFloat(batchAmount) * selected.length),
                  count: selected.length,
                  each: formatCurrency(Number.parseFloat(batchAmount)),
                })}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="subtle" onClick={() => setBatchTopUpOpen(false)}>
              {t("common.cancel", { defaultValue: "取消" })}
            </Button>
            <Button
              variant="primary"
              disabled={batchPending || !(Number.parseFloat(batchAmount) > 0)}
              onClick={() => runBatchTopUp(Number.parseFloat(batchAmount))}
            >
              {batchPending
                ? "..."
                : t("admin.users.batchTopUpExecute", {
                    defaultValue: "执行（{{count}} 人）",
                    count: selected.length,
                  })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
