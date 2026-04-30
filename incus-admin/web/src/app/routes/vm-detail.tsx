import type {FirewallGroup} from "@/features/firewall/api";
import type {ResetPasswordMode} from "@/features/vms/api";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Play, RefreshCw, RotateCcw, ShieldCheck, ShieldX, Square, Terminal as TerminalIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  usePortalBindVMFirewallMutation,
  usePortalFirewallGroupsQuery,
  usePortalUnbindVMFirewallMutation,
  usePortalVMFirewallBindingsQuery,
} from "@/features/firewall/api";
import { VMMetricsPanel } from "@/features/monitoring/vm-metrics-panel";
import { SnapshotPanel } from "@/features/snapshots/snapshot-panel";
import { DEFAULT_TEMPLATE_SLUG, TemplatePicker } from "@/features/templates/template-picker";
import {
  useMyVMDetailQuery,
  usePortalReinstallVMMutation,
  usePortalRescueEnterMutation,
  usePortalRescueExitMutation,
  useResetVMPasswordMutation,
  useVMActionMutation,
} from "@/features/vms/api";
import { defaultUserForImage } from "@/features/vms/default-user";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button, buttonVariants } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { EmptyState } from "@/shared/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { StatusPill, vmStatusToKind } from "@/shared/components/ui/status";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/vm-detail")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: Number(search.id) || 0,
  }),
  component: UserVMDetailPage,
});

function UserVMDetailPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { id } = Route.useSearch();
  const [reinstallOpen, setReinstallOpen] = useState(false);
  const [reinstallSlug, setReinstallSlug] = useState(DEFAULT_TEMPLATE_SLUG);
  const [resetPwdOpen, setResetPwdOpen] = useState(false);
  const [resetPwdMode, setResetPwdMode] = useState<ResetPasswordMode>("auto");

  const { data, isLoading } = useMyVMDetailQuery(id);
  const vm = data?.vm;

  const actionMutation = useVMActionMutation(id);
  const resetPwdMutation = useResetVMPasswordMutation(id);
  const reinstallMutation = usePortalReinstallVMMutation(id);
  const rescueEnterMutation = usePortalRescueEnterMutation(id);
  const rescueExitMutation = usePortalRescueExitMutation(id);

  const runResetPwd = () =>
    resetPwdMutation.mutate(resetPwdMode, {
      onSuccess: (data) => {
        const ch = data.channel ?? "online";
        const note = data.fallback ? `${ch} (fallback)` : ch;
        toast.success(
          t("vm.passwordResetToastWithChannel", {
            password: data.password,
            channel: note,
            defaultValue: "新密码: {{password}} · 通道: {{channel}}",
          }),
          {
            duration: 15000,
            action: {
              label: t("vm.passwordCopy", { defaultValue: "复制" }),
              onClick: () => {
                navigator.clipboard
                  .writeText(data.password)
                  .then(() =>
                    toast.success(t("vm.passwordCopied", { defaultValue: "已复制到剪贴板" })),
                  )
                  .catch(() =>
                    toast.error(
                      t("vm.passwordCopyFailed", { defaultValue: "复制失败，请手动复制" }),
                    ),
                  );
              },
            },
          },
        );
        setResetPwdOpen(false);
      },
      onError: () => toast.error(t("vm.passwordResetFailed")),
    });

  const runReinstall = async () => {
    if (!vm) return;
    const ok = await confirm({
      title: t("deleteConfirm.reinstallTitle"),
      message: t("deleteConfirm.reinstallMessage", { name: vm.name }),
      destructive: true,
      typeToConfirm: vm.name,
      typeToConfirmLabel: t("confirmDialog.typeVmName", {
        defaultValue: "请输入 VM 名称 {{name}} 以确认",
        name: vm.name,
      }),
    });
    if (!ok) return;
    reinstallMutation.mutate(
      { template_slug: reinstallSlug },
      {
        onSuccess: (data) => {
          toast.success(
            t("vm.reinstallDone", {
              username: data.username,
              password: data.password,
              defaultValue: "重装完成 · {{username}} / {{password}}",
            }),
            { duration: 20_000 },
          );
          setReinstallOpen(false);
        },
        onError: (err) => toast.error((err as Error).message),
      },
    );
  };

  const runRescueEnter = async () => {
    if (!vm) return;
    const ok = await confirm({
      title: t("vm.rescueEnterTitle", { defaultValue: "进入 Rescue 模式" }),
      message: t("vm.rescueEnterMessage", {
        name: vm.name,
        defaultValue: "确认让 {{name}} 进入 Rescue 模式？会先拍快照再停机。",
      }),
      destructive: true,
    });
    if (!ok) return;
    rescueEnterMutation.mutate(undefined, {
      onSuccess: (res) =>
        toast.success(
          t("vm.rescueEntered", {
            snap: res.snapshot,
            defaultValue: "已进入 Rescue；快照 {{snap}}",
          }),
          { duration: 15_000 },
        ),
      onError: (err) => toast.error((err as Error).message),
    });
  };

  const runRescueExit = async (restore: boolean) => {
    if (!vm) return;
    const ok = await confirm({
      title: t("vm.rescueExitTitle", { defaultValue: "退出 Rescue 模式" }),
      message: restore
        ? t("vm.rescueExitRestoreMessage", {
            name: vm.name,
            defaultValue: "确认退出 Rescue 并恢复快照？{{name}} 会回滚到进入前的状态。",
          })
        : t("vm.rescueExitMessage", {
            name: vm.name,
            defaultValue: "确认退出 Rescue？{{name}} 会直接启动（不恢复快照）。",
          }),
      destructive: restore,
    });
    if (!ok) return;
    rescueExitMutation.mutate(
      { restore, delete_snapshot: false },
      {
        onSuccess: () =>
          toast.success(
            restore
              ? t("vm.rescueExitedRestored", { defaultValue: "已恢复快照并启动" })
              : t("vm.rescueExited", { defaultValue: "已退出 Rescue" }),
          ),
        onError: (err) => toast.error((err as Error).message),
      },
    );
  };

  if (id > 0 && isLoading) {
    return (
      <PageShell>
        <PageHeader title={<Skeleton className="h-8 w-40" />} />
        <PageContent>
          <Skeleton className="h-32" />
        </PageContent>
      </PageShell>
    );
  }

  if (!vm) {
    return (
      <PageShell>
        <PageContent>
          <EmptyState
            title={t("vm.notFoundTitle")}
            description={t("vm.notFoundHint")}
            action={
              <Button variant="primary" onClick={() => navigate({ to: "/vms" })}>
                {t("vm.backToList")}
              </Button>
            }
          />
        </PageContent>
      </PageShell>
    );
  }

  const isRunning = vm.status === "running";
  const isStopped = vm.status === "stopped";

  return (
    <PageShell>
      <PageHeader
        title={<span className="font-mono">{vm.name}</span>}
        breadcrumbs={[{ label: t("vm.myVms", { defaultValue: "我的云主机" }), to: "/vms" }, { label: vm.name }]}
        meta={<StatusPill status={vmStatusToKind(vm.status)}>{vm.status}</StatusPill>}
        description={`${vm.cpu}C · ${(vm.memory_mb / 1024).toFixed(0)}G RAM · ${vm.disk_gb}G Disk`}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {isRunning ? (
              <>
                <Link
                  to="/console"
                  search={{
                    vm: vm.name,
                    cluster: vm.cluster,
                    project: vm.project,
                    from: "portal",
                  } as any}
                  className={cn(buttonVariants({ variant: "primary", size: "sm" }))}
                >
                  <TerminalIcon size={12} aria-hidden="true" />
                  {t("vm.console")}
                </Link>
                <Button size="sm" variant="ghost" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate("stop")}>
                  <Square size={12} aria-hidden="true" />
                  {t("vm.stop")}
                </Button>
                <Button size="sm" variant="ghost" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate("restart")}>
                  <RefreshCw size={12} aria-hidden="true" />
                  {t("vm.restart")}
                </Button>
                <Button size="sm" variant="ghost" disabled={resetPwdMutation.isPending} onClick={() => setResetPwdOpen(true)}>
                  {t("vm.passwordReset", { defaultValue: "重置密码" })}
                </Button>
              </>
            ) : null}
            {isStopped ? (
              <Button size="sm" variant="primary" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate("start")}>
                <Play size={12} aria-hidden="true" />
                {t("vm.start")}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" disabled={reinstallMutation.isPending} onClick={() => setReinstallOpen(true)}>
              <RotateCcw size={12} aria-hidden="true" />
              {t("vm.reinstall")}
            </Button>
            {vm.status !== "rescue" ? (
              <Button size="sm" variant="ghost" disabled={rescueEnterMutation.isPending} onClick={runRescueEnter}>
                <ShieldCheck size={12} aria-hidden="true" />
                {t("vm.rescueEnter", { defaultValue: "Rescue" })}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" disabled={rescueExitMutation.isPending} onClick={() => runRescueExit(false)}>
                <ShieldX size={12} aria-hidden="true" />
                {t("vm.rescueExit", { defaultValue: "Rescue 退出" })}
              </Button>
            )}
          </div>
        }
      />
      <PageContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <InfoCard label="IP" value={vm.ip || "—"} mono />
          <InfoCard label="Username" value={defaultUserForImage(vm.os_image)} mono />
          <InfoCard label="Node" value={vm.node} />
          <InfoCard label="Created" value={new Date(vm.created_at).toLocaleDateString()} />
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">{t("vm.monitor", { defaultValue: "监控" })}</TabsTrigger>
            <TabsTrigger value="snapshots">{t("vm.snapshots", { defaultValue: "快照" })}</TabsTrigger>
            <TabsTrigger value="firewall">{t("vm.firewall.tab", { defaultValue: "防火墙" })}</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <VMMetricsPanel vmName={vm.name} apiBase="/portal" />
          </TabsContent>
          <TabsContent value="snapshots">
            <SnapshotPanel vmName={vm.name} cluster={vm.cluster} project={vm.project} apiBase="/portal" />
          </TabsContent>
          <TabsContent value="firewall">
            <PortalFirewallPanel vmID={vm.id} />
          </TabsContent>
        </Tabs>
      </PageContent>

      {/* Reinstall Sheet */}
      <Sheet open={reinstallOpen} onOpenChange={(o) => { if (!o) setReinstallOpen(false); }}>
        <SheetContent side="right" size="min(96vw, 32rem)">
          <SheetHeader>
            <SheetTitle>
              {`${t("vm.reinstall")} · ${vm.name}`}
            </SheetTitle>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <Alert variant="error">
              <AlertDescription>{t("vm.reinstallWarning")}</AlertDescription>
            </Alert>
            <div className="space-y-1.5">
              <label className="text-sm font-[510]">
                {t("vm.targetTemplate", { defaultValue: "目标系统镜像" })}
              </label>
              <TemplatePicker
                value={reinstallSlug}
                onChange={setReinstallSlug}
                className="h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-sm focus:outline-none focus:border-[color:var(--accent)]"
              />
            </div>
          </SheetBody>
          <SheetFooter>
            <Button variant="ghost" onClick={() => setReinstallOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" disabled={reinstallMutation.isPending} onClick={runReinstall}>
              {reinstallMutation.isPending ? t("vm.reinstalling") : t("vm.reinstallConfirm")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Reset Password Sheet */}
      <Sheet open={resetPwdOpen} onOpenChange={(o) => { if (!o) setResetPwdOpen(false); }}>
        <SheetContent side="right" size="min(96vw, 28rem)">
          <SheetHeader>
            <SheetTitle>
              {t("vm.resetPwdHeading", { name: vm.name, defaultValue: "重置 {{name}} 密码" })}
            </SheetTitle>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <p className="text-caption text-muted-foreground">
              {t("vm.resetPwdModeHint", {
                defaultValue: "auto：先 online 失败后回落 offline；online：guest-agent chpasswd；offline：cloud-init 重启",
              })}
            </p>
            <div className="space-y-1.5">
              <label className="text-sm font-[510]">
                {t("vm.resetPwdMode", { defaultValue: "模式" })}
              </label>
              <Select value={resetPwdMode} onValueChange={(v) => setResetPwdMode(String(v) as ResetPasswordMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">auto</SelectItem>
                  <SelectItem value="online">online</SelectItem>
                  <SelectItem value="offline">offline</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </SheetBody>
          <SheetFooter>
            <Button variant="ghost" onClick={() => setResetPwdOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={resetPwdMutation.isPending} onClick={runResetPwd}>
              {resetPwdMutation.isPending ? t("vm.passwordResetting") : t("vm.passwordReset")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}

function InfoCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-caption text-text-tertiary">{label}</div>
        <div className={cn("text-sm font-[510] mt-0.5", mono && "font-mono")}>{value}</div>
      </CardContent>
    </Card>
  );
}

function PortalFirewallPanel({ vmID }: { vmID: number }) {
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
        <h3 className="text-sm font-[510]">
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
        <h3 className="text-sm font-[510]">
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
          <div className="font-[510] text-sm">{g.name}</div>
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
