import type { FirewallGroup } from "@/features/firewall/api";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  usePortalBindVMFirewallMutation,
  usePortalDeleteFirewallGroupMutation,
  usePortalFirewallGroupsQuery,
  usePortalUnbindVMFirewallMutation,
  usePortalVMFirewallBindingsQuery,
} from "@/features/firewall/api";
import {
  CreateUserGroupSheet,
  EditUserGroupSheet,
} from "@/features/firewall/components/user-group-editor";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { StatusPill } from "@/shared/components/ui/status";
import { formatError } from "@/shared/lib/http";

export function PortalFirewallPanel({ vmID }: { vmID: number }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { data: allGroupsData, isLoading: groupsLoading } = usePortalFirewallGroupsQuery();
  const { data: bindingsData, isLoading: bindingsLoading } = usePortalVMFirewallBindingsQuery(vmID);
  const bindMutation = usePortalBindVMFirewallMutation(vmID);
  const unbindMutation = usePortalUnbindVMFirewallMutation(vmID);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<FirewallGroup | null>(null);

  const allGroups: FirewallGroup[] = allGroupsData?.groups ?? [];
  const boundGroups: FirewallGroup[] = bindingsData?.groups ?? [];
  const boundIDs = new Set(boundGroups.map((g) => g.id));

  // PLAN-035 按 owner 分区。owner_id 来自后端 ListGroupsForUser：NULL = admin 共享组，
  // number = 自己的私有组（同一 user_id 才能拿到）。
  const myGroups = allGroups.filter((g) => g.owner_id != null);
  const sharedGroups = allGroups.filter((g) => g.owner_id == null);

  if (groupsLoading || bindingsLoading) {
    return <Skeleton className="h-32" />;
  }

  const onUnbind = async (g: FirewallGroup) => {
    const ok = await confirm({
      title: t("vm.firewall.unbindConfirmTitle", { defaultValue: "解绑防火墙组" }),
      message: t("vm.firewall.unbindConfirmMessage", {
        defaultValue: "解绑后，{{name}} 的规则将不再应用到本 VM。运行中 VM 会自动 stop→PATCH→start。继续？",
        name: g.name,
      }),
      destructive: true,
    });
    if (!ok) return;
    unbindMutation.mutate(g.id, {
      onSuccess: () => toast.success(t("vm.firewall.unbindOk", { defaultValue: "已解绑" })),
      onError: (e) => toast.error(formatError(e)),
    });
  };

  const onBind = (g: FirewallGroup) =>
    bindMutation.mutate(g.id, {
      onSuccess: () => toast.success(t("vm.firewall.bindOk", { defaultValue: "已绑定" })),
      onError: (e) => toast.error(formatError(e)),
    });

  return (
    <div className="space-y-6">
      {/* 我的组：owner = self，可创建 / 编辑 / 删除 */}
      <section className="space-y-2">
        <header className="flex items-center justify-between">
          <h3 className="text-sm font-emphasis">
            {t("vm.firewall.userMyGroups", { defaultValue: "我的防火墙组" })}
          </h3>
          <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={12} aria-hidden="true" />
            {t("vm.firewall.userCreate", { defaultValue: "新建组" })}
          </Button>
        </header>
        {myGroups.length === 0 ? (
          <Alert variant="info">
            <AlertDescription>
              {t("vm.firewall.userMyGroupsEmpty", {
                defaultValue: "还没有自定义组。点 \"新建组\" 创建你自己的防火墙规则集。",
              })}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            {myGroups.map((g) => (
              <UserGroupRow
                key={g.id}
                group={g}
                bound={boundIDs.has(g.id)}
                onBind={() => onBind(g)}
                onUnbind={() => onUnbind(g)}
                onEdit={() => setEditing(g)}
                bindPending={bindMutation.isPending}
                unbindPending={unbindMutation.isPending}
              />
            ))}
          </div>
        )}
      </section>

      {/* 共享组：owner = NULL，仅可绑/解绑（admin 维护） */}
      <section className="space-y-2">
        <h3 className="text-sm font-emphasis">
          {t("vm.firewall.userSharedGroups", { defaultValue: "管理员共享组" })}
        </h3>
        {sharedGroups.length === 0 ? (
          <Alert variant="info">
            <AlertDescription>
              {t("vm.firewall.userSharedEmpty", { defaultValue: "管理员未发布任何共享组" })}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            {sharedGroups.map((g) => (
              <SharedGroupRow
                key={g.id}
                group={g}
                bound={boundIDs.has(g.id)}
                onBind={() => onBind(g)}
                onUnbind={() => onUnbind(g)}
                bindPending={bindMutation.isPending}
                unbindPending={unbindMutation.isPending}
              />
            ))}
          </div>
        )}
      </section>

      <p className="text-caption text-text-tertiary">
        {t("vm.firewall.coldModifyHint", {
          defaultValue: "提示：bind/unbind 时如果 VM 正在运行，后端会自动 stop→PATCH→start 以应用 ACL（约 10-15s 不可达）。",
        })}
      </p>

      <CreateUserGroupSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      <EditUserGroupSheet
        group={editing}
        open={editing !== null}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
      />
    </div>
  );
}

// ============================================================================
// Row components
// ============================================================================

function UserGroupRow({
  group: g,
  bound,
  onBind,
  onUnbind,
  onEdit,
  bindPending,
  unbindPending,
}: {
  group: FirewallGroup;
  bound: boolean;
  onBind: () => void;
  onUnbind: () => void;
  onEdit: () => void;
  bindPending: boolean;
  unbindPending: boolean;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const deleteMutation = usePortalDeleteFirewallGroupMutation(g.id);

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

  return (
    <Card>
      <CardContent className="p-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-emphasis text-sm">{g.name}</span>
            {bound ? (
              <StatusPill status="success">
                {t("vm.firewall.userBoundBadge", { defaultValue: "已绑定" })}
              </StatusPill>
            ) : null}
          </div>
          <div className="text-caption text-text-tertiary font-mono">{g.slug}</div>
          {g.description ? (
            <div className="text-caption text-text-tertiary mt-0.5">{g.description}</div>
          ) : null}
          <div className="text-caption text-text-tertiary mt-0.5">
            {(g.rules?.length ?? 0)}
            {" "}
            {t("vm.firewall.userRulesCount", { defaultValue: "条规则" })}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit firewall group ${g.slug}`}>
            <Pencil size={12} aria-hidden="true" />
            {t("common.edit", { defaultValue: "编辑" })}
          </Button>
          {bound ? (
            <Button
              size="sm"
              variant="subtle"
              disabled={unbindPending}
              onClick={onUnbind}
              data-testid={`unbind-firewall-${g.slug}`}
            >
              {t("vm.firewall.unbind", { defaultValue: "解绑" })}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={bindPending}
              onClick={onBind}
              data-testid={`bind-firewall-${g.slug}`}
            >
              {t("vm.firewall.bind", { defaultValue: "绑定" })}
            </Button>
          )}
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
        </div>
      </CardContent>
    </Card>
  );
}

function SharedGroupRow({
  group: g,
  bound,
  onBind,
  onUnbind,
  bindPending,
  unbindPending,
}: {
  group: FirewallGroup;
  bound: boolean;
  onBind: () => void;
  onUnbind: () => void;
  bindPending: boolean;
  unbindPending: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="p-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-emphasis text-sm">{g.name}</span>
            {bound ? (
              <StatusPill status="success">
                {t("vm.firewall.userBoundBadge", { defaultValue: "已绑定" })}
              </StatusPill>
            ) : null}
            <StatusPill status="disabled">
              {t("vm.firewall.userSharedBadge", { defaultValue: "共享" })}
            </StatusPill>
          </div>
          <div className="text-caption text-text-tertiary font-mono">{g.slug}</div>
          {g.description ? (
            <div className="text-caption text-text-tertiary mt-0.5">{g.description}</div>
          ) : null}
        </div>
        <div className="shrink-0">
          {bound ? (
            <Button
              size="sm"
              variant="subtle"
              disabled={unbindPending}
              onClick={onUnbind}
              data-testid={`unbind-firewall-${g.slug}`}
            >
              {t("vm.firewall.unbind", { defaultValue: "解绑" })}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={bindPending}
              onClick={onBind}
              data-testid={`bind-firewall-${g.slug}`}
            >
              {t("vm.firewall.bind", { defaultValue: "绑定" })}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
