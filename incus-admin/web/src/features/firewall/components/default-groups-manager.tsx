import type { FirewallGroup } from "@/features/firewall/api";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  usePortalFirewallDefaultsQuery,
  usePortalFirewallGroupsQuery,
  usePortalReplaceFirewallDefaultsMutation,
} from "@/features/firewall/api";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { StatusPill } from "@/shared/components/ui/status";
import { formatError } from "@/shared/lib/http";

/**
 * DefaultGroupsManager —— PLAN-036：用户的默认 firewall_groups 列表。
 *
 * 仅"新建 VM"会自动应用。要把默认组应用到现有 VM，用 BindToVMsDialog。
 *
 * 操作：列表（带 sort_order 上下移动）、+ 添加（从未在列表中的可见组中选）、X 移除。
 * 任何变更立即 PUT /portal/firewall/defaults（整列表替换）。
 */
export function DefaultGroupsManager() {
  const { t } = useTranslation();
  const defaultsQuery = usePortalFirewallDefaultsQuery();
  const groupsQuery = usePortalFirewallGroupsQuery();
  const mutation = usePortalReplaceFirewallDefaultsMutation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedID, setPickedID] = useState<string>("");

  const defaults = defaultsQuery.data?.groups ?? [];
  const allGroups = groupsQuery.data?.groups ?? [];
  const defaultIDs = useMemo(() => new Set(defaults.map((g) => g.id)), [defaults]);
  const candidates = allGroups.filter((g) => !defaultIDs.has(g.id));

  const persist = (next: FirewallGroup[]) => {
    mutation.mutate(
      next.map((g) => g.id),
      {
        onSuccess: () =>
          toast.success(t("firewall.defaultsSavedOk", { defaultValue: "默认组已更新" })),
        onError: (e) => toast.error(formatError(e)),
      },
    );
  };

  const remove = (id: number) => {
    persist(defaults.filter((g) => g.id !== id));
  };
  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    const next = [...defaults];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    persist(next);
  };
  const moveDown = (idx: number) => {
    if (idx >= defaults.length - 1) return;
    const next = [...defaults];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    persist(next);
  };
  const add = () => {
    const id = Number.parseInt(pickedID, 10);
    if (!Number.isFinite(id) || id <= 0) return;
    const target = allGroups.find((g) => g.id === id);
    if (!target) return;
    persist([...defaults, target]);
    setPickedID("");
    setPickerOpen(false);
  };

  if (defaultsQuery.isLoading || groupsQuery.isLoading) {
    return <Skeleton className="h-24" />;
  }

  return (
    <div className="space-y-2">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-emphasis">
          {t("firewall.defaultsTitle", { defaultValue: "默认 firewall 组（仅新建 VM 生效）" })}
        </h3>
        <Button
          size="sm"
          variant="primary"
          disabled={candidates.length === 0}
          onClick={() => setPickerOpen(true)}
        >
          <Plus size={12} aria-hidden="true" />
          {t("firewall.defaultsAdd", { defaultValue: "添加默认" })}
        </Button>
      </header>

      {defaults.length === 0 ? (
        <Card>
          <CardContent className="p-3 text-caption text-text-tertiary">
            {t("firewall.defaultsEmpty", {
              defaultValue: "未设置默认组。新创建的 VM 不会自动绑定任何 firewall 组。",
            })}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {defaults.map((g, idx) => (
            <Card key={g.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex flex-col gap-0.5">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => moveUp(idx)}
                    disabled={idx === 0 || mutation.isPending}
                    aria-label={t("firewall.defaultsMoveUp", { defaultValue: "上移" })}
                  >
                    <ChevronUp size={12} aria-hidden="true" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => moveDown(idx)}
                    disabled={idx === defaults.length - 1 || mutation.isPending}
                    aria-label={t("firewall.defaultsMoveDown", { defaultValue: "下移" })}
                  >
                    <ChevronDown size={12} aria-hidden="true" />
                  </Button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-emphasis text-sm">{g.name}</span>
                    {g.owner_id == null ? (
                      <StatusPill status="disabled">
                        {t("vm.firewall.userSharedBadge", { defaultValue: "共享" })}
                      </StatusPill>
                    ) : null}
                  </div>
                  <div className="text-caption text-text-tertiary font-mono">{g.slug}</div>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => remove(g.id)}
                  disabled={mutation.isPending}
                  aria-label={t("firewall.defaultsRemove", { defaultValue: "移除" })}
                  className="text-status-error"
                >
                  <X size={14} aria-hidden="true" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-caption text-text-tertiary">
        {t("firewall.defaultsHint", {
          defaultValue: "提示：默认组仅对新创建的 VM 自动应用。要应用到现有 VM 请用 \"应用到 VMs\"。",
        })}
      </p>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent sheetWidth="min(92vw, 24rem)">
          <DialogHeader>
            <DialogTitle>
              {t("firewall.defaultsPickTitle", { defaultValue: "添加默认组" })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Select value={pickedID} onValueChange={(v) => setPickedID(String(v))}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {pickedID
                    ? allGroups.find((g) => g.id === Number.parseInt(pickedID, 10))?.name
                    : t("firewall.defaultsPickPlaceholder", { defaultValue: "选择一个组" })}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {candidates.length === 0 ? (
                  <SelectItem value="empty" disabled>
                    {t("firewall.defaultsPickAllUsed", { defaultValue: "已全部加为默认" })}
                  </SelectItem>
                ) : null}
                {candidates.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.name}
                    {" · "}
                    {g.owner_id == null
                      ? t("vm.firewall.userSharedBadge", { defaultValue: "共享" })
                      : t("firewall.defaultsMine", { defaultValue: "我的" })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPickerOpen(false)}>
              {t("common.cancel", { defaultValue: "取消" })}
            </Button>
            <Button variant="primary" disabled={!pickedID || mutation.isPending} onClick={add}>
              {t("common.add", { defaultValue: "添加" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
