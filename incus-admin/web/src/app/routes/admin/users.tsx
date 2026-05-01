import type {PageParams, Quota} from "@/features/users/api";
import type { User } from "@/shared/lib/auth";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck, UserCog } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useAdminUsersQuery,
  useBatchUserMutation,
  useTopUpBalanceMutation,
  useTopUpQuotaQuery,
  useUpdateUserQuotaMutation,
  useUpdateUserRoleMutation,
  useUserQuotaQuery,
} from "@/features/users/api";
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
import { Input, Textarea } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Pagination } from "@/shared/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
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
import { http } from "@/shared/lib/http";
import { formatCurrency } from "@/shared/lib/utils";

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

function UserRow({
  user,
  selected,
  onSelect,
}: {
  user: User;
  selected: boolean;
  onSelect: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [showTopUp, setShowTopUp] = useState(false);
  const [showQuota, setShowQuota] = useState(false);
  const [shadowOpen, setShadowOpen] = useState(false);
  const [amount, setAmount] = useState("");

  const roleMutation = useUpdateUserRoleMutation(user.id);
  const topUpMutation = useTopUpBalanceMutation(user.id);
  const { data: quota } = useTopUpQuotaQuery(user.id, showTopUp);
  const amountNum = Number.parseFloat(amount);
  const quotaExceeded =
    !!quota && amountNum > 0 && amountNum > quota.remaining;

  const changeRole = async (newRole: string) => {
    if (newRole === user.role) return;
    const isDowngrade = user.role === "admin" && newRole === "customer";
    if (isDowngrade) {
      const ok = await confirm({
        title: t("admin.roleDowngradeTitle", { defaultValue: "降级管理员？" }),
        message: t("admin.roleDowngradeMessage", {
          defaultValue: "确认将 {{email}} 从 admin 降级为 customer？该用户将失去所有管理权限。",
          email: user.email,
        }),
        destructive: true,
        typeToConfirm: user.email,
      });
      if (!ok) return;
    }
    roleMutation.mutate(newRole);
  };

  const confirmTopUp = async () => {
    const amt = Number.parseFloat(amount);
    if (!(amt > 0)) return;
    const ok = await confirm({
      title: t("admin.topUpConfirmTitle", { defaultValue: "确认充值" }),
      message: t("admin.topUpConfirmMessage", {
        defaultValue: "确认给 {{email}} 充值 {{amount}}？",
        email: user.email,
        amount: formatCurrency(amt),
      }),
    });
    if (!ok) return;
    topUpMutation.mutate(amt, {
      onSuccess: () => { setShowTopUp(false); setAmount(""); },
    });
  };

  const startShadowLogin = async () => {
    const ok = await confirm({
      title: t("shadow.confirmTitle", { defaultValue: "Shadow Login 确认" }),
      message: t("shadow.confirmMessage", {
        defaultValue: "你将以 {{email}} 的身份登入。所有操作都会按 admin shadow 审计记录。继续吗？",
        email: user.email,
      }),
      destructive: true,
      typeToConfirm: user.email,
    });
    if (!ok) return;
    setShadowOpen(true);
  };

  return (
    <>
      <TableRow>
        <TableCell className="w-10">
          <Checkbox
            checked={selected}
            onCheckedChange={onSelect}
            aria-label={`Select user ${user.email}`}
          />
        </TableCell>
        <TableCell>{user.id}</TableCell>
        <TableCell className="font-mono text-xs">{user.email}</TableCell>
        <TableCell>
          <Select
            value={user.role}
            onValueChange={(v) => changeRole(String(v))}
            disabled={roleMutation.isPending}
          >
            <SelectTrigger className="h-7 w-select-sm text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="customer">customer</SelectItem>
              <SelectItem value="admin">admin</SelectItem>
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell className="text-right font-mono">
          {formatCurrency(user.balance)}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowQuota(!showQuota); setShowTopUp(false); }}
            >
              {t("admin.quota", { defaultValue: "配额" })}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => { setShowTopUp(!showTopUp); setShowQuota(false); }}
            >
              {t("admin.topUp", { defaultValue: "充值" })}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={startShadowLogin}
              aria-label={`Shadow login as ${user.email}`}
              data-testid={`shadow-login-${user.id}`}
              title={t("shadow.loginTitle", { defaultValue: "以该用户身份登入（审计、排障用）" })}
            >
              ⚠ Shadow
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {showTopUp && (
        <TableRow className="bg-surface-2">
          <TableCell colSpan={6}>
            <div className="flex flex-col gap-2 max-w-md">
              <div className="flex items-center gap-2">
                <span className="text-sm">$</span>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={t("admin.amount", { defaultValue: "Amount" })}
                  className="flex-1"
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={confirmTopUp}
                  disabled={topUpMutation.isPending || !amount || quotaExceeded}
                >
                  {topUpMutation.isPending ? "..." : t("common.confirm", { defaultValue: "Confirm" })}
                </Button>
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => setShowTopUp(false)}
                >
                  {t("common.cancel", { defaultValue: "Cancel" })}
                </Button>
              </div>
              {quota && (
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <span>
                    {t("user.topup.usedToday", {
                      defaultValue: "今日已用 {{used}} / 上限 {{limit}}",
                      used: formatCurrency(quota.used),
                      limit: formatCurrency(quota.limit),
                    })}
                  </span>
                  {quotaExceeded && (
                    <StatusPill status="error">
                      {t("user.topup.quotaExceeded", {
                        defaultValue: "超出日额度（剩余 {{remaining}}）",
                        remaining: formatCurrency(quota.remaining),
                      })}
                    </StatusPill>
                  )}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
      {showQuota && (
        <TableRow className="bg-surface-2">
          <TableCell colSpan={6}>
            <QuotaEditor userId={user.id} onClose={() => setShowQuota(false)} />
          </TableCell>
        </TableRow>
      )}
      <ShadowLoginDialog
        open={shadowOpen}
        onOpenChange={setShadowOpen}
        user={user}
      />
    </>
  );
}

function ShadowLoginDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: User;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setReason("");
    setSubmitting(false);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const submit = async () => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const resp = await http.post<{ redirect_url: string }>(
        `/admin/users/${user.id}/shadow-login`,
        { reason: trimmed },
      );
      // 服务端 OIDC 跳转，必须用 window.location.href
      window.location.href = resp.redirect_url;
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("shadow.confirmTitle", { defaultValue: "Shadow Login 确认" })}
          </DialogTitle>
          <DialogDescription>
            {t("shadow.reasonWarning", {
              defaultValue:
                "你将以 {{email}} 的身份登入，所有操作都会按 admin shadow 审计记录。请填写本次操作原因。",
              email: user.email,
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`shadow-reason-${user.id}`} required>
            {t("shadow.reasonLabel", {
              defaultValue: "原因（必填，审计记录用）",
            })}
          </Label>
          <Textarea
            id={`shadow-reason-${user.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            autoFocus
            data-testid={`shadow-reason-${user.id}`}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            variant="destructive"
            disabled={!reason.trim() || submitting}
            onClick={submit}
            data-testid={`shadow-submit-${user.id}`}
          >
            {submitting
              ? "..."
              : t("shadow.submit", { defaultValue: "确认登入" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuotaEditor({ userId, onClose }: { userId: number; onClose: () => void }) {
  const { t } = useTranslation();
  const { data, isLoading } = useUserQuotaQuery(userId);
  const [form, setForm] = useState<Quota | null>(null);

  const quota = data?.quota;
  const usage = data?.usage;

  const saveMutation = useUpdateUserQuotaMutation(userId);

  if (isLoading) return <div className="text-xs text-muted-foreground">{t("common.loading")}</div>;

  const current = form ?? quota ?? {
    max_vms: 5, max_vcpus: 16, max_ram_mb: 16384, max_disk_gb: 500, max_ips: 5, max_snapshots: 10,
  };

  const set = (k: keyof Quota, v: number) => setForm({ ...current, [k]: v });

  const save = () => {
    saveMutation.mutate(current, {
      onSuccess: () => {
        toast.success(t("admin.quotaUpdated", { defaultValue: "配额已更新" }));
        onClose();
      },
      onError: () => toast.error(t("admin.quotaUpdateFailed", { defaultValue: "配额更新失败" })),
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-strong">{t("admin.userQuotaTitle", { defaultValue: "用户配额" })} (ID: {userId})</h4>
        <Button variant="link" size="sm" onClick={onClose}>
          {t("common.close", { defaultValue: "关闭" })}
        </Button>
      </div>
      {usage && (
        <div className="text-xs text-muted-foreground mb-2">
          {t("admin.currentUsage", { defaultValue: "当前使用" })}: {usage.vms} VMs / {usage.vcpus} vCPUs / {(usage.ram_mb / 1024).toFixed(1)}G RAM / {usage.disk_gb}G Disk
        </div>
      )}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-3">
        <QuotaField label={t("admin.maxVms", { defaultValue: "最大VM数" })} value={current.max_vms} onChange={(v) => set("max_vms", v)} />
        <QuotaField label={t("admin.maxVcpus", { defaultValue: "最大vCPU" })} value={current.max_vcpus} onChange={(v) => set("max_vcpus", v)} />
        <QuotaField label={t("admin.maxRamMb", { defaultValue: "最大RAM(MB)" })} value={current.max_ram_mb} onChange={(v) => set("max_ram_mb", v)} />
        <QuotaField label={t("admin.maxDiskGb", { defaultValue: "最大磁盘(GB)" })} value={current.max_disk_gb} onChange={(v) => set("max_disk_gb", v)} />
        <QuotaField label={t("admin.maxIps", { defaultValue: "最大IP数" })} value={current.max_ips} onChange={(v) => set("max_ips", v)} />
        <QuotaField label={t("admin.maxSnapshots", { defaultValue: "最大快照" })} value={current.max_snapshots} onChange={(v) => set("max_snapshots", v)} />
      </div>
      <Button
        variant="primary"
        size="sm"
        onClick={save}
        disabled={saveMutation.isPending}
      >
        {saveMutation.isPending ? t("admin.saving", { defaultValue: "保存中..." }) : t("admin.saveQuota", { defaultValue: "保存配额" })}
      </Button>
    </div>
  );
}

function QuotaField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="h-8 text-xs font-mono"
      />
    </div>
  );
}
