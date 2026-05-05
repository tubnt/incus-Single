import type { FirewallGroup } from "@/features/firewall/api";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  usePortalFirewallBindBatchMutation,
  usePortalFirewallUnbindBatchMutation,
  usePortalGroupBoundVMsQuery,
} from "@/features/firewall/api";
import { useMyVMsQuery } from "@/features/vms/api";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { StatusPill } from "@/shared/components/ui/status";
import { formatError } from "@/shared/lib/http";
import { cn } from "@/shared/lib/utils";

/**
 * BindToVMsDialog —— PLAN-036 多 VM 批量绑定 / 解绑（集中管理页用）。
 *
 * 列出当前用户的所有 VM 多选 → 提交 bind:batch / unbind:batch endpoint。
 * 已绑定的 VM 用 StatusPill 标识 + 默认勾选不动；未绑定可勾上参与绑定。
 *
 * 显式 warning：将临时停机 N 台 running VM（D5 决策）。
 */
export function BindToVMsDialog({
  group,
  open,
  onOpenChange,
}: {
  group: FirewallGroup | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const myVMs = useMyVMsQuery();
  const boundVMs = usePortalGroupBoundVMsQuery(group?.id ?? null);
  const bindMutation = usePortalFirewallBindBatchMutation(group?.id ?? 0);
  const unbindMutation = usePortalFirewallUnbindBatchMutation(group?.id ?? 0);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  const boundIDs = useMemo(
    () => new Set((boundVMs.data?.vms ?? []).map((v) => v.id)),
    [boundVMs.data],
  );
  const allVMs = myVMs.data?.vms ?? [];
  const runningCount = useMemo(
    () => Array.from(selected).filter((id) => allVMs.find((v) => v.id === id)?.status === "running").length,
    [selected, allVMs],
  );

  if (!group) return null;

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBind = () => {
    const ids = Array.from(selected).filter((id) => !boundIDs.has(id));
    if (ids.length === 0) return;
    bindMutation.mutate(ids, {
      onSuccess: (res) => {
        if (res.failed.length === 0) {
          toast.success(
            t("firewall.bindBatchOk", { defaultValue: "已绑定 {{n}} 台 VM", n: res.succeeded.length }),
          );
        } else {
          toast.warning(
            t("firewall.bindBatchPartial", {
              defaultValue: "部分成功：{{ok}} 成功 / {{fail}} 失败",
              ok: res.succeeded.length,
              fail: res.failed.length,
            }),
          );
        }
        setSelected(new Set());
        onOpenChange(false);
      },
      onError: (e) => toast.error(formatError(e)),
    });
  };

  const runUnbind = () => {
    const ids = Array.from(selected).filter((id) => boundIDs.has(id));
    if (ids.length === 0) return;
    unbindMutation.mutate(ids, {
      onSuccess: (res) => {
        if (res.failed.length === 0) {
          toast.success(
            t("firewall.unbindBatchOk", { defaultValue: "已解绑 {{n}} 台 VM", n: res.succeeded.length }),
          );
        } else {
          toast.warning(
            t("firewall.unbindBatchPartial", {
              defaultValue: "部分成功：{{ok}} 成功 / {{fail}} 失败",
              ok: res.succeeded.length,
              fail: res.failed.length,
            }),
          );
        }
        setSelected(new Set());
        onOpenChange(false);
      },
      onError: (e) => toast.error(formatError(e)),
    });
  };

  const pending = bindMutation.isPending || unbindMutation.isPending;
  const loading = myVMs.isLoading || boundVMs.isLoading;

  // 拆分两组：可绑（未绑） vs 可解（已绑）—— 提交按钮根据当前选择动态 enable
  const selectedToBind = Array.from(selected).filter((id) => !boundIDs.has(id));
  const selectedToUnbind = Array.from(selected).filter((id) => boundIDs.has(id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent sheetWidth="min(92vw, 36rem)">
        <DialogHeader>
          <DialogTitle>
            {t("firewall.applyToVMsTitle", { defaultValue: "应用到 VMs" })}
            {" · "}
            <span className="font-mono text-text-tertiary">{group.slug}</span>
          </DialogTitle>
          <DialogDescription>
            {t("firewall.applyToVMsHint", {
              defaultValue: "勾选要绑定 / 解绑的 VM。已绑组的 VM 自带蓝色标签；勾选已绑表示要解绑。",
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-80 overflow-y-auto py-2">
          {loading ? (
            <Skeleton className="h-20 w-full" />
          ) : allVMs.length === 0 ? (
            <p className="text-caption text-text-tertiary">
              {t("firewall.applyToVMsEmpty", { defaultValue: "你还没有任何 VM。" })}
            </p>
          ) : (
            allVMs.map((vm) => {
              const isBound = boundIDs.has(vm.id);
              const isChecked = selected.has(vm.id);
              return (
                <label
                  key={vm.id}
                  className={cn(
                    "flex items-center gap-3 rounded-md border border-border p-2",
                    "hover:bg-surface-2 cursor-pointer",
                    isChecked && "bg-surface-2 ring-1 ring-accent/40",
                  )}
                >
                  <Checkbox checked={isChecked} onCheckedChange={() => toggle(vm.id)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{vm.name}</span>
                      {isBound ? (
                        <StatusPill status="success">
                          {t("firewall.boundChip", { defaultValue: "已绑" })}
                        </StatusPill>
                      ) : null}
                      <StatusPill status={vm.status === "running" ? "success" : "disabled"}>
                        {vm.status}
                      </StatusPill>
                    </div>
                    <div className="text-caption text-text-tertiary">
                      {vm.ip || "—"} · {vm.node}
                    </div>
                  </div>
                </label>
              );
            })
          )}
        </div>
        {selected.size > 0 && runningCount > 0 ? (
          <div className="rounded-md border border-status-warning/30 bg-status-warning/8 p-3 text-caption text-status-warning">
            {t("firewall.coldModifyWarning", {
              defaultValue: "⚠ 将临时停机 {{n}} 台运行中 VM（每台约 10–15s 不可达）。后端串行处理。",
              n: runningCount,
            })}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel", { defaultValue: "取消" })}
          </Button>
          <Button
            variant="subtle"
            disabled={pending || selectedToUnbind.length === 0}
            onClick={runUnbind}
          >
            {t("firewall.unbindCount", {
              defaultValue: "解绑 ({{n}})",
              n: selectedToUnbind.length,
            })}
          </Button>
          <Button
            variant="primary"
            disabled={pending || selectedToBind.length === 0}
            onClick={runBind}
          >
            {pending
              ? "..."
              : t("firewall.bindCount", {
                  defaultValue: "绑定 ({{n}})",
                  n: selectedToBind.length,
                })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
