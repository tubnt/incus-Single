import type { FirewallGroup } from "@/features/firewall/api";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  usePortalBindVMFirewallMutation,
  usePortalFirewallGroupsQuery,
  usePortalUnbindVMFirewallMutation,
  usePortalVMFirewallBindingsQuery,
} from "@/features/firewall/api";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { Skeleton } from "@/shared/components/ui/skeleton";

export function PortalFirewallPanel({ vmID }: { vmID: number }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { data: allGroupsData, isLoading: groupsLoading } = usePortalFirewallGroupsQuery();
  const { data: bindingsData, isLoading: bindingsLoading } = usePortalVMFirewallBindingsQuery(vmID);
  const bindMutation = usePortalBindVMFirewallMutation(vmID);
  const unbindMutation = usePortalUnbindVMFirewallMutation(vmID);

  const allGroups: FirewallGroup[] = allGroupsData?.groups ?? [];
  const boundGroups: FirewallGroup[] = bindingsData?.groups ?? [];
  const boundIDs = new Set(boundGroups.map((g) => g.id));
  const availableGroups = allGroups.filter((g) => !boundIDs.has(g.id));

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
      onError: (e) => toast.error((e as Error).message),
    });
  };

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="text-sm font-emphasis">
          {t("vm.firewall.bound", { defaultValue: "已绑定的防火墙组" })}
        </h3>
        {boundGroups.length === 0 ? (
          <Alert variant="info">
            <AlertDescription>
              {t("vm.firewall.noBound", { defaultValue: "尚未绑定任何防火墙组" })}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            {boundGroups.map((g) => (
              <FirewallGroupRow key={g.id} group={g}>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={unbindMutation.isPending}
                  onClick={() => onUnbind(g)}
                  aria-label={`Unbind firewall group ${g.slug}`}
                  data-testid={`unbind-firewall-${g.slug}`}
                >
                  {t("vm.firewall.unbind", { defaultValue: "解绑" })}
                </Button>
              </FirewallGroupRow>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-emphasis">
          {t("vm.firewall.available", { defaultValue: "可绑定的防火墙组" })}
        </h3>
        {availableGroups.length === 0 ? (
          <Alert variant="info">
            <AlertDescription>
              {boundGroups.length === allGroups.length && allGroups.length > 0
                ? t("vm.firewall.allBound", { defaultValue: "已绑定全部可用组" })
                : t("vm.firewall.noGroupsConfigured", { defaultValue: "当前没有可绑定的防火墙组" })}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            {availableGroups.map((g) => (
              <FirewallGroupRow key={g.id} group={g}>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={bindMutation.isPending}
                  onClick={() =>
                    bindMutation.mutate(g.id, {
                      onSuccess: () => toast.success(t("vm.firewall.bindOk", { defaultValue: "已绑定" })),
                      onError: (e) => toast.error((e as Error).message),
                    })
                  }
                  aria-label={`Bind firewall group ${g.slug}`}
                  data-testid={`bind-firewall-${g.slug}`}
                >
                  {bindMutation.isPending ? "..." : t("vm.firewall.bind", { defaultValue: "绑定" })}
                </Button>
              </FirewallGroupRow>
            ))}
          </div>
        )}
      </section>

      <p className="text-caption text-text-tertiary">
        {t("vm.firewall.coldModifyHint", {
          defaultValue: "提示：bind/unbind 时如果 VM 正在运行，后端会自动 stop→PATCH→start 以应用 ACL（约 10-15s 不可达）。",
        })}
      </p>
    </div>
  );
}

function FirewallGroupRow({
  group: g,
  children,
}: {
  group: FirewallGroup;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-emphasis text-sm">{g.name}</div>
          <div className="text-caption text-text-tertiary font-mono">{g.slug}</div>
          {g.description ? (
            <div className="text-caption text-text-tertiary mt-0.5">{g.description}</div>
          ) : null}
        </div>
        <div className="shrink-0">{children}</div>
      </CardContent>
    </Card>
  );
}
