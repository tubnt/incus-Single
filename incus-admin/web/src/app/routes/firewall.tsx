import type { FirewallGroup, FirewallRule } from "@/features/firewall/api";
import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Plus, Search, Server, Settings, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  usePortalDeleteFirewallGroupMutation,
  usePortalFirewallDefaultsQuery,
  usePortalFirewallGroupsQuery,
} from "@/features/firewall/api";
import { BindToVMsDialog } from "@/features/firewall/components/bind-to-vms-dialog";
import { DefaultGroupsManager } from "@/features/firewall/components/default-groups-manager";
import {
  CreateUserGroupSheet,
  EditUserGroupSheet,
} from "@/features/firewall/components/user-group-editor";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { Input } from "@/shared/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { StatusPill } from "@/shared/components/ui/status";
import { formatError } from "@/shared/lib/http";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/firewall")({
  component: UserFirewallPage,
});

type Filter = "all" | "mine" | "shared";

/**
 * /firewall —— PLAN-036 用户级集中管理页（B 简化重构）。
 *
 * 旧版 3 sections：Default + My + Shared，4 级标题 + 大空状态 + 重复 Tip。
 * 新版：1 行 toolbar（Default 摘要 + filter + 新建）+ 1 个统一列表。
 *
 * 默认组管理收到右抽屉，避免在主区永久占位。
 */
function UserFirewallPage() {
  const { t } = useTranslation();
  const groupsQuery = usePortalFirewallGroupsQuery();
  const defaultsQuery = usePortalFirewallDefaultsQuery();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<FirewallGroup | null>(null);
  const [bindingTo, setBindingTo] = useState<FirewallGroup | null>(null);
  const [defaultsOpen, setDefaultsOpen] = useState(false);

  const allGroups = groupsQuery.data?.groups ?? [];
  const defaultsCount = defaultsQuery.data?.groups?.length ?? 0;

  // mine 在前，shared 在后；mine 内按 id desc（新组在前），shared 按 id asc（稳定）
  const sortedGroups = useMemo(() => {
    const mine = allGroups.filter((g) => g.owner_id != null).sort((a, b) => b.id - a.id);
    const shared = allGroups.filter((g) => g.owner_id == null).sort((a, b) => a.id - b.id);
    return [...mine, ...shared];
  }, [allGroups]);

  const filtered = useMemo(() => {
    let list = sortedGroups;
    if (filter === "mine") list = list.filter((g) => g.owner_id != null);
    if (filter === "shared") list = list.filter((g) => g.owner_id == null);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (g) =>
          g.name.toLowerCase().includes(q)
          || g.slug.toLowerCase().includes(q)
          || g.description.toLowerCase().includes(q),
      );
    }
    return list;
  }, [sortedGroups, filter, search]);

  const counts = useMemo(
    () => ({
      all: sortedGroups.length,
      mine: sortedGroups.filter((g) => g.owner_id != null).length,
      shared: sortedGroups.filter((g) => g.owner_id == null).length,
    }),
    [sortedGroups],
  );

  return (
    <PageShell>
      <PageHeader
        title={t("firewall.userPageTitle", { defaultValue: "我的防火墙" })}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} aria-hidden="true" />
            {t("vm.firewall.userCreate", { defaultValue: "新建组" })}
          </Button>
        }
      />
      <PageContent>
        {/* Toolbar 行：filter chips + 搜索 + 默认组摘要 */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <FilterChips filter={filter} onChange={setFilter} counts={counts} />
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={12} aria-hidden="true" className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("firewall.searchPlaceholder", { defaultValue: "搜索 name / slug" })}
                className="h-7 w-input-narrow pl-7 text-caption"
              />
            </div>
            <Button variant="subtle" size="sm" onClick={() => setDefaultsOpen(true)}>
              <Settings size={12} aria-hidden="true" />
              {t("firewall.defaultsButton", {
                defaultValue: "默认组 · {{n}}",
                n: defaultsCount,
              })}
            </Button>
          </div>
        </div>

        {groupsQuery.isLoading ? (
          <Skeleton className="h-32" />
        ) : filtered.length === 0 ? (
          <div className="rounded-md border border-border bg-surface-1 p-6 text-center text-caption text-text-tertiary">
            {filter === "mine"
              ? t("firewall.userMyGroupsEmptyHint", {
                  defaultValue: "点上方 \"新建组\" 创建你的第一个 firewall 规则集。",
                })
              : t("firewall.listEmpty", { defaultValue: "无防火墙组。" })}
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((g) => (
              <GroupRow
                key={g.id}
                group={g}
                onEdit={() => setEditing(g)}
                onApply={() => setBindingTo(g)}
              />
            ))}
          </div>
        )}
      </PageContent>

      <CreateUserGroupSheet open={createOpen} onOpenChange={setCreateOpen} />
      <EditUserGroupSheet
        group={editing}
        open={editing !== null}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
      />
      <BindToVMsDialog
        group={bindingTo}
        open={bindingTo !== null}
        onOpenChange={(o) => { if (!o) setBindingTo(null); }}
      />

      {/* 默认组管理抽屉 */}
      <Sheet open={defaultsOpen} onOpenChange={setDefaultsOpen}>
        <SheetContent side="right" size="min(96vw, 32rem)">
          <SheetHeader>
            <SheetTitle>
              {t("firewall.defaultsSheetTitle", { defaultValue: "默认组（仅新建 VM 自动应用）" })}
            </SheetTitle>
          </SheetHeader>
          <SheetBody>
            <DefaultGroupsManager />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}

function FilterChips({
  filter,
  onChange,
  counts,
}: {
  filter: Filter;
  onChange: (next: Filter) => void;
  counts: { all: number; mine: number; shared: number };
}) {
  const { t } = useTranslation();
  const items: Array<{ key: Filter; label: string; n: number }> = [
    { key: "all", label: t("firewall.filterAll", { defaultValue: "全部" }), n: counts.all },
    { key: "mine", label: t("firewall.filterMine", { defaultValue: "我的" }), n: counts.mine },
    { key: "shared", label: t("firewall.filterShared", { defaultValue: "共享" }), n: counts.shared },
  ];
  return (
    <div className="inline-flex rounded-md border border-border bg-surface-1 p-0.5" role="tablist">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="tab"
          aria-selected={filter === it.key}
          onClick={() => onChange(it.key)}
          className={cn(
            "px-3 h-7 rounded-md text-caption font-emphasis transition-colors",
            filter === it.key
              ? "bg-surface-2 text-foreground"
              : "text-text-tertiary hover:text-foreground",
          )}
        >
          {it.label}
          <span className="ml-1.5 text-text-quaternary">{it.n}</span>
        </button>
      ))}
    </div>
  );
}

function GroupRow({
  group: g,
  onEdit,
  onApply,
}: {
  group: FirewallGroup;
  onEdit: () => void;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const deleteMutation = usePortalDeleteFirewallGroupMutation(g.id);
  const isMine = g.owner_id != null;
  const ruleCount = g.rules?.length ?? 0;

  const onDelete = async () => {
    const ok = await confirm({
      title: t("vm.firewall.userDeleteTitle", { defaultValue: "删除防火墙组" }),
      message: t("vm.firewall.userDeleteMessage", {
        defaultValue: "确认删除 {{name}}？删除后规则永久消失；如组被 VM 绑定将无法删除。",
        name: g.name,
      }),
      destructive: true,
      typeToConfirm: g.slug,
      typeToConfirmLabel: t("vm.firewall.userDeleteType", {
        defaultValue: "请输入 slug {{slug}} 以确认",
        slug: g.slug,
      }),
    });
    if (!ok) return;
    deleteMutation.mutate(undefined, {
      onSuccess: () => toast.success(t("vm.firewall.userDeleteOk", { defaultValue: "已删除组" })),
      onError: (e) => toast.error(formatError(e)),
    });
  };

  const bindingCount = g.binding_count ?? 0;
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="font-emphasis text-sm truncate">{g.name}</span>
            {!isMine ? (
              <StatusPill status="disabled">
                {t("vm.firewall.userSharedBadge", { defaultValue: "共享" })}
              </StatusPill>
            ) : null}
            <span className="font-mono text-caption text-text-tertiary truncate">{g.slug}</span>
            {/* 规则数 chip — hover 弹 popover 展示具体规则 */}
            {ruleCount > 0 ? (
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="inline-flex items-center rounded-pill border border-border bg-surface-1 px-2 py-0.5 text-caption text-text-secondary hover:bg-surface-2 transition-colors"
                      aria-label={t("firewall.rulesPreview", { defaultValue: "查看规则" })}
                    >
                      {ruleCount}
                      {" "}
                      {t("vm.firewall.userRulesCount", { defaultValue: "条规则" })}
                    </button>
                  }
                />
                <PopoverContent>
                  <RulesPreview rules={g.rules ?? []} />
                </PopoverContent>
              </Popover>
            ) : (
              <span className="text-caption text-text-quaternary">
                {t("admin.firewall.noRules", { defaultValue: "无规则" })}
              </span>
            )}
            {/* 已绑 VM 数量 chip — 只对自己 VM 计数 */}
            {bindingCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-pill border border-status-success/30 bg-status-success/8 px-2 py-0.5 text-caption text-status-success">
                <Server size={10} aria-hidden="true" />
                {t("firewall.boundCount", { defaultValue: "已绑 {{n}}", n: bindingCount })}
              </span>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          {isMine ? (
            <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit firewall group ${g.slug}`}>
              <Pencil size={12} aria-hidden="true" />
              {t("common.edit", { defaultValue: "编辑" })}
            </Button>
          ) : null}
          <Button size="sm" variant="primary" onClick={onApply} aria-label={`Apply firewall group ${g.slug} to VMs`}>
            <Server size={12} aria-hidden="true" />
            {t("firewall.applyToVMs", { defaultValue: "应用到 VMs" })}
          </Button>
          {isMine ? (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onDelete}
              disabled={deleteMutation.isPending}
              aria-label={`Delete firewall group ${g.slug}`}
              className="text-status-error"
            >
              <Trash2 size={14} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function RulesPreview({ rules }: { rules: FirewallRule[] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5 min-w-[16rem]">
      <div className="text-caption font-emphasis text-text-tertiary uppercase">
        {t("vm.firewall.userRules", { defaultValue: "规则" })}
      </div>
      <table className="w-full text-caption">
        <thead className="text-text-tertiary">
          <tr>
            <th className="text-left pr-2 font-emphasis">{t("admin.firewall.ruleAction", { defaultValue: "动作" })}</th>
            <th className="text-left pr-2 font-emphasis">{t("admin.firewall.ruleProtocol", { defaultValue: "协议" })}</th>
            <th className="text-left pr-2 font-emphasis">{t("admin.firewall.ruleDestPort", { defaultValue: "端口" })}</th>
            <th className="text-left font-emphasis">{t("admin.firewall.ruleSource", { defaultValue: "来源" })}</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id ?? `${r.direction}-${r.action}-${r.destination_port}-${r.source_cidr}`} className="border-t border-border">
              <td className="pr-2 py-1 font-mono">{r.action}</td>
              <td className="pr-2 py-1 font-mono">{r.protocol || "any"}</td>
              <td className="pr-2 py-1 font-mono">{r.destination_port || "any"}</td>
              <td className="py-1 font-mono">{r.source_cidr || "any"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
