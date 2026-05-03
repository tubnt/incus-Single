import type { Quota } from "@/features/users/api";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useUpdateUserQuotaMutation,
  useUserQuotaQuery,
} from "@/features/users/api";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

export function QuotaEditor({ userId, onClose }: { userId: number; onClose: () => void }) {
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
