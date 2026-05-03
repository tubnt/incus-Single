import type { User } from "@/shared/lib/auth";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useTopUpBalanceMutation,
  useTopUpQuotaQuery,
  useUpdateUserRoleMutation,
} from "@/features/users/api";
import { QuotaEditor } from "@/features/users/components/quota-editor";
import { ShadowLoginDialog } from "@/features/users/components/shadow-login-dialog";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { StatusPill } from "@/shared/components/ui/status";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { formatCurrency } from "@/shared/lib/utils";

export function UserRow({
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
