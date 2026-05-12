import type {
  AlertRule,
  AlertRuleKind,
  AlertScope,
  AlertSeverity,
  CreateAlertRulePayload,
  UpdateAlertRulePayload,
} from "@/features/alert-rules/api";
import { createFileRoute } from "@tanstack/react-router";
import { Lock, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  useAlertDeliveriesQuery,
  useAlertRulesQuery,
  useCreateAlertRuleMutation,
  useDeleteAlertRuleMutation,
  useToggleAlertRuleMutation,
  useUpdateAlertRuleMutation,
} from "@/features/alert-rules/api";
import { useNotifyChannelsQuery } from "@/features/notify-channels/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { StatusPill } from "@/shared/components/ui/status";

// routeTree.gen.ts 在新路由首次 typecheck 时还没更新；用 as never 暂避
// （bun run dev 会自动 regenerate）。
export const Route = createFileRoute("/admin/alert-rules" as never)({
  component: AlertRulesPage,
});

const KIND_LABELS: Record<AlertRuleKind, string> = {
  imbalance: "集群不均衡",
  vm_cpu: "VM CPU 占用过高",
  vm_mem: "VM 内存占用过高",
  vm_disk: "VM 磁盘占用过高",
  vm_down: "VM 异常 (gone/error)",
  cluster_node_offline: "集群节点离线",
  order_failed: "订单失败率",
  job_failed: "Job 失败率",
  balance_low: "余额低于阈值",
  backup_failed: "备份失败",
};

const SEVERITY_OPTIONS: AlertSeverity[] = ["info", "warning", "error", "critical"];
const SCOPE_OPTIONS: AlertScope[] = ["global", "cluster", "vm", "user"];

function severityTone(s: AlertSeverity): "pending" | "success" | "warning" | "error" {
  if (s === "critical" || s === "error") return "error";
  if (s === "warning") return "warning";
  return "pending";
}

function AlertRulesPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useAlertRulesQuery();
  const channels = useNotifyChannelsQuery();
  const rules = data?.rules ?? [];
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<AlertRule | null>(null);

  const channelLabel = (id: number) =>
    channels.data?.channels.find((c) => c.id === id)?.name ?? `#${id}`;

  return (
    <PageShell>
      <PageHeader
        title={t("alertRule.title", "告警规则")}
        description={t(
          "alertRule.description",
          "评估器 1 分钟评估一次。规则触发 → upsert system_alerts → 按 channel_ids 推送通知。imbalance 是内置规则，不可删但可改通道。",
        )}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            {t("alertRule.add", "添加规则")}
          </Button>
        }
      />
      <PageContent>
        {isLoading ? (
          <div className="text-muted-foreground">{t("common.loading", "加载中...")}</div>
        ) : rules.length === 0 ? (
          <EmptyState title={t("alertRule.empty", "尚无规则。")} />
        ) : (
          <div className="space-y-3">
            {rules.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-medium">{r.name}</span>
                      <StatusPill status="pending">{KIND_LABELS[r.kind] ?? r.kind}</StatusPill>
                      <StatusPill status={severityTone(r.severity)}>{r.severity}</StatusPill>
                      <StatusPill status={r.enabled ? "success" : "pending"}>
                        {r.enabled ? t("common.enabled", "启用") : t("common.disabled", "停用")}
                      </StatusPill>
                      {r.builtin && (
                        <StatusPill status="pending">
                          <Lock size={11} />
                          {t("alertRule.builtin", "内置")}
                        </StatusPill>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {t("alertRule.scope", "作用域")}: {r.scope_kind}
                      {r.threshold !== null && (
                        <>
                          {" · "}
                          {t("alertRule.threshold", "阈值")}: {r.threshold}
                        </>
                      )}
                      {" · "}
                      {t("alertRule.window", "窗口")}: {r.window_seconds}s
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("alertRule.channels", "通道")}:{" "}
                      {r.channel_ids.length === 0
                        ? t("alertRule.noChannels", "未绑定 (告警仅入 system_alerts，不推送)")
                        : r.channel_ids.map(channelLabel).join(" · ")}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <ToggleEnabled rule={r} />
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setDeliveriesFor(r)}>
                        {t("alertRule.history", "历史")}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                        {t("common.edit", "编辑")}
                      </Button>
                      <DeleteRuleButton rule={r} />
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        <CreateRuleSheet open={createOpen} onClose={() => setCreateOpen(false)} />
        <EditRuleSheet rule={editing} onClose={() => setEditing(null)} />
        <DeliveriesDialog rule={deliveriesFor} onClose={() => setDeliveriesFor(null)} />
      </PageContent>
    </PageShell>
  );
}

function ToggleEnabled({ rule }: { rule: AlertRule }) {
  const { t } = useTranslation();
  const m = useToggleAlertRuleMutation(rule.id);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        m.mutate(!rule.enabled, {
          onSuccess: () =>
            toast.success(rule.enabled ? t("alertRule.disabled", "已停用") : t("alertRule.enabledOk", "已启用")),
          onError: (e) => toast.error(`${e}`),
        });
      }}
      disabled={m.isPending}
    >
      {rule.enabled ? t("common.disable", "停用") : t("common.enable", "启用")}
    </Button>
  );
}

function DeleteRuleButton({ rule }: { rule: AlertRule }) {
  const { t } = useTranslation();
  const m = useDeleteAlertRuleMutation();
  const confirm = useConfirm();
  if (rule.builtin) {
    return (
      <Button variant="ghost" size="sm" disabled title={t("alertRule.cannotDeleteBuiltin", "内置规则不可删除")}>
        <Trash2 size={14} />
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        const ok = await confirm({
          title: t("alertRule.deleteConfirm", "删除告警规则？"),
          message: rule.name,
          confirmLabel: t("common.delete", "删除"),
          destructive: true,
        });
        if (!ok) return;
        m.mutate(rule.id, {
          onSuccess: () => toast.success(t("alertRule.deleted", "规则已删除")),
          onError: (e) => toast.error(`${e}`),
        });
      }}
    >
      <Trash2 size={14} />
    </Button>
  );
}

function CreateRuleSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const channels = useNotifyChannelsQuery();
  const m = useCreateAlertRuleMutation();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AlertRuleKind>("vm_down");
  const [scope, setScope] = useState<AlertScope>("global");
  const [threshold, setThreshold] = useState<string>("");
  const [windowSec, setWindowSec] = useState(300);
  const [severity, setSeverity] = useState<AlertSeverity>("warning");
  const [channelIDs, setChannelIDs] = useState<number[]>([]);

  const reset = () => {
    setName("");
    setKind("vm_down");
    setScope("global");
    setThreshold("");
    setWindowSec(300);
    setSeverity("warning");
    setChannelIDs([]);
  };

  const submit = () => {
    if (!name.trim()) {
      toast.error(t("alertRule.nameRequired", "名称必填"));
      return;
    }
    const payload: Record<string, unknown> = {
      name,
      kind,
      scope_kind: scope,
      window_seconds: windowSec,
      severity,
      channel_ids: channelIDs,
    };
    if (threshold.trim() !== "") {
      const n = Number(threshold);
      if (Number.isNaN(n)) {
        toast.error(t("alertRule.thresholdInvalid", "阈值必须是数字"));
        return;
      }
      payload.threshold = n;
    }
    m.mutate(payload as unknown as CreateAlertRulePayload, {
      onSuccess: () => {
        toast.success(t("alertRule.created", "规则已创建"));
        reset();
        onClose();
      },
      onError: (e) => toast.error(`${e}`),
    });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && (reset(), onClose())}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t("alertRule.addTitle", "添加告警规则")}</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <div className="space-y-1">
            <Label>{t("alertRule.name", "名称")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="VM down on production" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("alertRule.kind", "类型")}</Label>
              <select
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value as AlertRuleKind)}
              >
                {Object.entries(KIND_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>{t("alertRule.scope", "作用域")}</Label>
              <select
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={scope}
                onChange={(e) => setScope(e.target.value as AlertScope)}
              >
                {SCOPE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("alertRule.threshold", "阈值")}</Label>
              <Input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="0.9 / 100" />
            </div>
            <div className="space-y-1">
              <Label>{t("alertRule.window", "窗口 (秒)")}</Label>
              <Input
                type="number"
                value={windowSec}
                onChange={(e) => setWindowSec(Number(e.target.value) || 300)}
                min={30}
                max={86400}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t("alertRule.severity", "级别")}</Label>
            <select
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as AlertSeverity)}
            >
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>{t("alertRule.channels", "通道")}</Label>
            <div className="space-y-1">
              {(channels.data?.channels ?? []).map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={channelIDs.includes(c.id)}
                    onChange={(e) => {
                      if (e.target.checked) setChannelIDs([...channelIDs, c.id]);
                      else setChannelIDs(channelIDs.filter((x) => x !== c.id));
                    }}
                  />
                  {c.name} <span className="text-muted-foreground">({c.kind})</span>
                </label>
              ))}
              {(channels.data?.channels ?? []).length === 0 && (
                <div className="text-xs text-muted-foreground">
                  {t("alertRule.noChannelsHint", "尚无通道，请先去 /admin/notify-channels 添加。")}
                </div>
              )}
            </div>
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel", "取消")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={m.isPending}>
            {t("common.save", "保存")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function EditRuleSheet({ rule, onClose }: { rule: AlertRule | null; onClose: () => void }) {
  const { t } = useTranslation();
  const channels = useNotifyChannelsQuery();
  const m = useUpdateAlertRuleMutation(rule?.id ?? 0);
  const [name, setName] = useState(rule?.name ?? "");
  const [threshold, setThreshold] = useState<string>(rule?.threshold?.toString() ?? "");
  const [windowSec, setWindowSec] = useState(rule?.window_seconds ?? 300);
  const [severity, setSeverity] = useState<AlertSeverity>(rule?.severity ?? "warning");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [channelIDs, setChannelIDs] = useState<number[]>(rule?.channel_ids ?? []);
  const [synced, setSynced] = useState<number | null>(null);

  // 切换不同 rule 时重新填表（极简，避免上下文 reuse 复杂化）
  if (rule && synced !== rule.id) {
    setSynced(rule.id);
    setName(rule.name);
    setThreshold(rule.threshold?.toString() ?? "");
    setWindowSec(rule.window_seconds);
    setSeverity(rule.severity);
    setEnabled(rule.enabled);
    setChannelIDs(rule.channel_ids);
  }

  if (!rule) return null;

  const submit = () => {
    const payload: Record<string, unknown> = {
      name,
      window_seconds: windowSec,
      severity,
      channel_ids: channelIDs,
      enabled,
    };
    if (threshold.trim() !== "") {
      const n = Number(threshold);
      if (Number.isNaN(n)) {
        toast.error(t("alertRule.thresholdInvalid", "阈值必须是数字"));
        return;
      }
      payload.threshold = n;
    }
    m.mutate(payload as unknown as UpdateAlertRulePayload, {
      onSuccess: () => {
        toast.success(t("alertRule.updated", "规则已更新"));
        setSynced(null);
        onClose();
      },
      onError: (e) => toast.error(`${e}`),
    });
  };

  return (
    <Sheet open={!!rule} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>
            {t("alertRule.editTitle", "编辑规则")} — {rule.name}
            {rule.builtin && (
              <StatusPill status="pending" className="ml-2">{/* builtin */}
                {t("alertRule.builtin", "内置")}
              </StatusPill>
            )}
          </SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <div className="space-y-1">
            <Label>{t("alertRule.name", "名称")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("alertRule.threshold", "阈值")}</Label>
              <Input value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("alertRule.window", "窗口 (秒)")}</Label>
              <Input
                type="number"
                value={windowSec}
                onChange={(e) => setWindowSec(Number(e.target.value) || 300)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t("alertRule.severity", "级别")}</Label>
            <select
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as AlertSeverity)}
            >
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>{t("alertRule.channels", "通道")}</Label>
            <div className="space-y-1">
              {(channels.data?.channels ?? []).map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={channelIDs.includes(c.id)}
                    onChange={(e) => {
                      if (e.target.checked) setChannelIDs([...channelIDs, c.id]);
                      else setChannelIDs(channelIDs.filter((x) => x !== c.id));
                    }}
                  />
                  {c.name} <span className="text-muted-foreground">({c.kind})</span>
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {t("notify.enabled", "启用")}
          </label>
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel", "取消")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={m.isPending}>
            {t("common.save", "保存")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function DeliveriesDialog({ rule, onClose }: { rule: AlertRule | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { data, isLoading } = useAlertDeliveriesQuery(rule?.id);
  const channels = useNotifyChannelsQuery();
  const channelLabel = (id: number) =>
    channels.data?.channels.find((c) => c.id === id)?.name ?? `#${id}`;
  if (!rule) return null;
  const items = data?.deliveries ?? [];
  return (
    <Dialog open={!!rule} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("alertRule.historyTitle", "送达历史")} — {rule.name}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="text-muted-foreground">{t("common.loading", "加载中...")}</div>
        ) : items.length === 0 ? (
          <EmptyState title={t("alertRule.noHistory", "尚无送达记录")} />
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {items.map((d) => (
              <div key={d.id} className="rounded-md border border-border p-2 text-sm">
                <div className="flex items-center gap-2">
                  <StatusPill
                    status={
                      d.status === "success" || d.status === "resolved"
                        ? "success"
                        : d.status === "failed"
                          ? "error"
                          : "pending"
                    }
                  >
                    {d.status}
                  </StatusPill>
                  <span className="text-xs text-muted-foreground">{d.phase}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{d.created_at}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  → {channelLabel(d.channel_id)} (尝试 {d.attempts})
                </div>
                {d.last_error && <div className="mt-1 text-xs text-destructive">{d.last_error}</div>}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
