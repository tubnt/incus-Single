import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { User } from "@/shared/lib/auth";
import {
  type Quota,
  useAdminUsersQuery,
  useTopUpBalanceMutation,
  useUpdateUserQuotaMutation,
  useUpdateUserRoleMutation,
  useUserQuotaQuery,
} from "@/features/users/api";

export const Route = createFileRoute("/admin/users")({
  component: UsersPage,
});

function UsersPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useAdminUsersQuery();
  const users = data?.users ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t("admin.users", { defaultValue: "Users" })} ({users.length})</h1>
      {isLoading ? (
        <div className="text-muted-foreground">{t("common.loading")}</div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-3 font-medium">ID</th>
                <th className="text-left px-4 py-3 font-medium">{t("admin.email", { defaultValue: "Email" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t("admin.role", { defaultValue: "Role" })}</th>
                <th className="text-right px-4 py-3 font-medium">{t("common.balance", { defaultValue: "Balance" })}</th>
                <th className="text-right px-4 py-3 font-medium">{t("vm.actions", { defaultValue: "Actions" })}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow key={u.id} user={u} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UserRow({ user }: { user: User }) {
  const { t } = useTranslation();
  const [showTopUp, setShowTopUp] = useState(false);
  const [showQuota, setShowQuota] = useState(false);
  const [amount, setAmount] = useState("");

  const roleMutation = useUpdateUserRoleMutation(user.id);
  const topUpMutation = useTopUpBalanceMutation(user.id);

  const confirmTopUp = () => {
    const amt = parseFloat(amount);
    if (amt > 0) topUpMutation.mutate(amt, {
      onSuccess: () => { setShowTopUp(false); setAmount(""); },
    });
  };

  return (
    <>
      <tr className="border-t border-border">
        <td className="px-4 py-3">{user.id}</td>
        <td className="px-4 py-3 font-mono text-xs">{user.email}</td>
        <td className="px-4 py-3">
          <select
            value={user.role}
            onChange={(e) => roleMutation.mutate(e.target.value)}
            disabled={roleMutation.isPending}
            className="px-2 py-1 rounded text-xs border border-border bg-card"
          >
            <option value="customer">customer</option>
            <option value="admin">admin</option>
          </select>
        </td>
        <td className="px-4 py-3 text-right font-mono">${user.balance.toFixed(2)}</td>
        <td className="px-4 py-3 text-right">
          <div className="flex justify-end gap-1">
            <button
              onClick={() => { setShowQuota(!showQuota); setShowTopUp(false); }}
              className="px-2 py-1 rounded text-xs border border-border hover:bg-muted"
            >
              {t("admin.quota", { defaultValue: "配额" })}
            </button>
            <button
              onClick={() => { setShowTopUp(!showTopUp); setShowQuota(false); }}
              className="px-2 py-1 rounded text-xs bg-primary/20 text-primary hover:bg-primary/30"
            >
              + {t("admin.topUp", { defaultValue: "Top Up" })}
            </button>
          </div>
        </td>
      </tr>
      {showTopUp && (
        <tr className="border-t border-border bg-card/50">
          <td colSpan={5} className="px-4 py-3">
            <div className="flex items-center gap-2 max-w-md">
              <span className="text-sm">$</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={t("admin.amount", { defaultValue: "Amount" })}
                className="flex-1 px-3 py-1.5 rounded border border-border bg-card text-sm"
              />
              <button
                onClick={confirmTopUp}
                disabled={topUpMutation.isPending || !amount}
                className="px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground disabled:opacity-50"
              >
                {topUpMutation.isPending ? "..." : t("common.confirm", { defaultValue: "Confirm" })}
              </button>
              <button
                onClick={() => setShowTopUp(false)}
                className="px-3 py-1.5 rounded text-xs bg-muted text-muted-foreground"
              >
                {t("common.cancel", { defaultValue: "Cancel" })}
              </button>
            </div>
          </td>
        </tr>
      )}
      {showQuota && (
        <tr className="border-t border-border bg-card/50">
          <td colSpan={5} className="px-4 py-3">
            <QuotaEditor userId={user.id} onClose={() => setShowQuota(false)} />
          </td>
        </tr>
      )}
    </>
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
        <h4 className="text-sm font-semibold">{t("admin.userQuotaTitle", { defaultValue: "用户配额" })} (ID: {userId})</h4>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
          {t("common.close", { defaultValue: "关闭" })}
        </button>
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
      <button
        onClick={save}
        disabled={saveMutation.isPending}
        className="px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground disabled:opacity-50"
      >
        {saveMutation.isPending ? t("admin.saving", { defaultValue: "保存中..." }) : t("admin.saveQuota", { defaultValue: "保存配额" })}
      </button>
    </div>
  );
}

function QuotaField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="w-full px-2 py-1 rounded border border-border bg-card text-xs font-mono"
      />
    </div>
  );
}
