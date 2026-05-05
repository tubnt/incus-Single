import type { FirewallGroup } from "@/features/firewall/api";
import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Plus, Server, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  usePortalDeleteFirewallGroupMutation,
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
import { EmptyState } from "@/shared/components/ui/empty-state";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { StatusPill } from "@/shared/components/ui/status";
import { formatError } from "@/shared/lib/http";

export const Route = createFileRoute("/firewall")({
  component: UserFirewallPage,
});

/**
 * /firewall —— PLAN-036 用户级集中管理页。
 *
 * 三 section：
 *   1. 默认 firewall 组（仅新建 VM 自动应用，DefaultGroupsManager）
 *   2. 我的组（CRUD + 应用到 VMs）
 *   3. 管理员共享组（read-only + 应用到 VMs）
 */
function UserFirewallPage() {
  const { t } = useTranslation();
  const groupsQuery = usePortalFirewallGroupsQuery();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<FirewallGroup | null>(null);
  const [bindingTo, setBindingTo] = useState<FirewallGroup | null>(null);

  const groups = groupsQuery.data?.groups ?? [];
  const myGroups = groups.filter((g) => g.owner_id != null);
  const sharedGroups = groups.filter((g) => g.owner_id == null);

  return (
    <PageShell>
      <PageHeader
        title={t("firewall.userPageTitle", { defaultValue: "我的防火墙" })}
        description={t("firewall.userPageDescription", {
          defaultValue: "集中管理你的 firewall 组、规则、默认策略和绑定关系。",
        })}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} aria-hidden="true" />
            {t("vm.firewall.userCreate", { defaultValue: "新建组" })}
          </Button>
        }
      />
      <PageContent>
        {groupsQuery.isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="space-y-8">
            {/* Section 1：默认组 */}
            <DefaultGroupsManager />

            {/* Section 2：我的组 */}
            <section className="space-y-2">
              <h3 className="text-sm font-emphasis">
                {t("vm.firewall.userMyGroups", { defaultValue: "我的防火墙组" })}
              </h3>
              {myGroups.length === 0 ? (
                <EmptyState
                  title={t("firewall.userMyGroupsEmptyTitle", {
                    defaultValue: "还没有自定义组",
                  })}
                  description={t("firewall.userMyGroupsEmptyHint", {
                    defaultValue: "点上方 \"新建组\" 创建你的第一个 firewall 规则集。",
                  })}
                />
              ) : (
                <div className="space-y-2">
                  {myGroups.map((g) => (
                    <UserGroupRow
                      key={g.id}
                      group={g}
                      onEdit={() => setEditing(g)}
                      onApply={() => setBindingTo(g)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Section 3：管理员共享组 */}
            <section className="space-y-2">
              <h3 className="text-sm font-emphasis">
                {t("vm.firewall.userSharedGroups", { defaultValue: "管理员共享组" })}
              </h3>
              {sharedGroups.length === 0 ? (
                <Card>
                  <CardContent className="p-3 text-caption text-text-tertiary">
                    {t("vm.firewall.userSharedEmpty", {
                      defaultValue: "管理员未发布任何共享组",
                    })}
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {sharedGroups.map((g) => (
                    <SharedGroupRow
                      key={g.id}
                      group={g}
                      onApply={() => setBindingTo(g)}
                    />
                  ))}
                </div>
              )}
            </section>
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
    </PageShell>
  );
}

function UserGroupRow({
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
      <CardContent className="p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-emphasis text-sm">{g.name}</div>
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
          <Button size="sm" variant="primary" onClick={onApply} aria-label={`Apply firewall group ${g.slug} to VMs`}>
            <Server size={12} aria-hidden="true" />
            {t("firewall.applyToVMs", { defaultValue: "应用到 VMs" })}
          </Button>
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
  onApply,
}: {
  group: FirewallGroup;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-emphasis text-sm">{g.name}</span>
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
          <Button size="sm" variant="primary" onClick={onApply} aria-label={`Apply shared firewall group ${g.slug} to VMs`}>
            <Server size={12} aria-hidden="true" />
            {t("firewall.applyToVMs", { defaultValue: "应用到 VMs" })}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
