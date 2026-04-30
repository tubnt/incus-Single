import type {ResetPasswordMode} from "@/features/vms/api";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Play, RefreshCw, RotateCcw, ShieldCheck, Square, Terminal as TerminalIcon, Trash2, Truck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { VMMetricsPanel } from "@/features/monitoring/vm-metrics-panel";
import { NodePicker } from "@/features/nodes/node-picker";
import { SnapshotPanel } from "@/features/snapshots/snapshot-panel";
import { DEFAULT_TEMPLATE_SLUG, TemplatePicker } from "@/features/templates/template-picker";
import {
  useAdminResetPasswordByNameMutation,
  useAdminVMDetailQuery,
  useDeleteVMMutation,
  useMigrateVMMutation,
  useReinstallVMMutation,
  useRescueEnterByNameMutation,
  useRescueExitByNameMutation,
  useVMStateMutation,
} from "@/features/vms/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button, buttonVariants } from "@/shared/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/admin/vm-detail")({
  validateSearch: (search: Record<string, unknown>) => ({
    name: (search.name as string) || "",
    cluster: (search.cluster as string) || "",
    project: (search.project as string) || "customers",
  }),
  component: VMDetailPage,
});

function VMDetailPage() {
  const { t } = useTranslation();
  const { name, cluster, project } = Route.useSearch();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [migrateTarget, setMigrateTarget] = useState("");
  const [reinstallOpen, setReinstallOpen] = useState(false);
  const [resetPwdOpen, setResetPwdOpen] = useState(false);
  const [reinstallSlug, setReinstallSlug] = useState(DEFAULT_TEMPLATE_SLUG);
  const [resetPwdMode, setResetPwdMode] = useState<ResetPasswordMode>("auto");

  const { data: detailData, isLoading: detailLoading, isError: detailError } =
    useAdminVMDetailQuery(cluster, name, project || undefined, 15_000);
  const resolvedProject = detailData?.project || project;
  const currentNode = detailData?.vm?.location ?? "";

  const stateMutation = useVMStateMutation();
  const migrateMutation = useMigrateVMMutation();
  const deleteMutation = useDeleteVMMutation();
  const reinstallMutation = useReinstallVMMutation();
  const resetPwdMutation = useAdminResetPasswordByNameMutation(name);
  const rescueEnterMutation = useRescueEnterByNameMutation();
  const rescueExitMutation = useRescueExitByNameMutation(name);

  const runAction = (action: string) =>
    stateMutation.mutate(
      { name, action, cluster, project },
      {
        onSuccess: () => toast.success(`${name}: ${action} ${t("vm.actionSubmitted")}`),
        onError: () => toast.error(`${name}: ${action} ${t("vm.actionFailed")}`),
      },
    );

  const runMigrate = (target: string) =>
    migrateMutation.mutate(
      { name, cluster, project, target_node: target },
      {
        onSuccess: () => {
          toast.success(`${name} ${t("admin.migrated", { defaultValue: "已迁移" })}`);
          setMigrateOpen(false);
          setMigrateTarget("");
        },
        onError: () =>
          toast.error(`${name} ${t("admin.migrateFailed", { defaultValue: "迁移失败" })}`),
      },
    );

  const runDelete = async () => {
    const ok = await confirm({
      title: t("deleteConfirm.vmTitle"),
      message: t("deleteConfirm.vmMessage", { name }),
      destructive: true,
      typeToConfirm: name,
      typeToConfirmLabel: t("confirmDialog.typeVmName", {
        defaultValue: "请输入 VM 名称 {{name}} 以确认",
        name,
      }),
    });
    if (!ok) return;
    deleteMutation.mutate(
      { name, cluster, project },
      { onSuccess: () => navigate({ to: "/admin/vms" }) },
    );
  };

  const runRescueEnter = async () => {
    const ok = await confirm({
      title: t("vm.rescueEnterTitle", { defaultValue: "进入 Rescue 模式" }),
      message: t("vm.rescueEnterMessage", {
        name,
        defaultValue: "确认让 {{name}} 进入 Rescue 模式？会先拍快照再停机。",
      }),
      destructive: true,
    });
    if (!ok) return;
    rescueEnterMutation.mutate(name, {
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

  const runRescueExit = async () => {
    const ok = await confirm({
      title: t("vm.rescueExitTitle", { defaultValue: "退出 Rescue 模式" }),
      message: t("vm.rescueExitRestoreMessage", {
        name,
        defaultValue: "确认退出 Rescue 并恢复快照？{{name}} 会回滚到进入前的状态。",
      }),
      destructive: true,
    });
    if (!ok) return;
    rescueExitMutation.mutate(
      { restore: true, delete_snapshot: false },
      {
        onSuccess: () =>
          toast.success(t("vm.rescueExitedRestored", { defaultValue: "已恢复快照并启动" })),
        onError: (err) => toast.error((err as Error).message),
      },
    );
  };

  const runReinstall = async () => {
    const ok = await confirm({
      title: t("deleteConfirm.reinstallTitle"),
      message: t("deleteConfirm.reinstallMessage", { name }),
      destructive: true,
      typeToConfirm: name,
      typeToConfirmLabel: t("confirmDialog.typeVmName", {
        defaultValue: "请输入 VM 名称 {{name}} 以确认",
        name,
      }),
    });
    if (!ok) return;
    reinstallMutation.mutate(
      { name, cluster, project, template_slug: reinstallSlug },
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

  const runResetPwd = () =>
    resetPwdMutation.mutate(
      { cluster, project, username: "ubuntu", mode: resetPwdMode },
      {
        onSuccess: (data) => {
          const ch = data.channel ?? "online";
          const note = data.fallback ? `${ch} (fallback)` : ch;
          toast.success(
            t("vm.passwordResetResult", {
              user: data.username,
              password: data.password,
              channel: note,
              defaultValue: "{{user}} / {{password}} · via {{channel}}",
            }),
            { duration: 20_000 },
          );
          setResetPwdOpen(false);
        },
        onError: (err) => toast.error((err as Error).message),
      },
    );

  const runMigrateConfirm = async () => {
    if (!migrateTarget) return;
    const ok = await confirm({
      title: t("deleteConfirm.migrateTitle"),
      message: t("deleteConfirm.migrateMessage", { name, target: migrateTarget }),
    });
    if (ok) runMigrate(migrateTarget);
  };

  if (!name || !cluster) {
    return (
      <PageShell>
        <PageContent>
          <Alert variant="warning">
            <AlertDescription>Missing vm name or cluster.</AlertDescription>
          </Alert>
        </PageContent>
      </PageShell>
    );
  }

  if (detailLoading) {
    return (
      <PageShell>
        <PageHeader title={<Skeleton className="h-8 w-40" />} />
        <PageContent>
          <Skeleton className="h-32" />
        </PageContent>
      </PageShell>
    );
  }

  if (detailError || !detailData?.vm) {
    return (
      <PageShell>
        <PageContent>
          <EmptyState
            title={t("vm.notFoundTitle")}
            description={t("vm.notFoundHint")}
            action={
              <Button variant="primary" onClick={() => navigate({ to: "/admin/vms" })}>
                {t("vm.backToList")}
              </Button>
            }
          />
        </PageContent>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title={<span className="font-mono">{name}</span>}
        breadcrumbs={[
          { label: t("nav.allVms"), to: "/admin/vms" },
          { label: name },
        ]}
        description={`${cluster} / ${resolvedProject}${currentNode ? ` · ${currentNode}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              to="/console"
              search={{ vm: name, cluster, project, from: "admin" } as any}
              className={cn(buttonVariants({ variant: "primary", size: "sm" }))}
            >
              <TerminalIcon size={12} aria-hidden="true" />
              {t("vm.console")}
            </Link>
            <Button size="sm" variant="ghost" disabled={stateMutation.isPending} onClick={() => runAction("start")}>
              <Play size={12} aria-hidden="true" />
              {t("vm.start")}
            </Button>
            <Button size="sm" variant="ghost" disabled={stateMutation.isPending} onClick={() => runAction("stop")}>
              <Square size={12} aria-hidden="true" />
              {t("vm.stop")}
            </Button>
            <Button size="sm" variant="ghost" disabled={stateMutation.isPending} onClick={() => runAction("restart")}>
              <RefreshCw size={12} aria-hidden="true" />
              {t("vm.restart")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMigrateOpen(true)}>
              <Truck size={12} aria-hidden="true" />
              {t("admin.migrate", { defaultValue: "迁移" })}
            </Button>
            <Button size="sm" variant="ghost" disabled={reinstallMutation.isPending} onClick={() => setReinstallOpen(true)}>
              <RotateCcw size={12} aria-hidden="true" />
              {t("vm.reinstall")}
            </Button>
            <Button size="sm" variant="ghost" disabled={resetPwdMutation.isPending} onClick={() => setResetPwdOpen(true)}>
              {t("vm.passwordReset", { defaultValue: "重置密码" })}
            </Button>
            <Button size="sm" variant="ghost" disabled={rescueEnterMutation.isPending} onClick={runRescueEnter}>
              <ShieldCheck size={12} aria-hidden="true" />
              {t("vm.rescueEnter", { defaultValue: "Rescue" })}
            </Button>
            <Button size="sm" variant="ghost" disabled={rescueExitMutation.isPending} onClick={runRescueExit}>
              {t("vm.rescueExitRestore", { defaultValue: "Rescue 恢复" })}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={deleteMutation.isPending}
              aria-label={t("vm.deleteVmAriaLabel", { name, defaultValue: "Delete VM {{name}}" })}
              data-testid="delete-vm-button"
              onClick={runDelete}
            >
              <Trash2 size={12} aria-hidden="true" />
              {t("vm.delete")}
            </Button>
          </div>
        }
      />
      <PageContent>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">{t("vm.tabOverview", { defaultValue: "Overview" })}</TabsTrigger>
            <TabsTrigger value="console">{t("vm.console")}</TabsTrigger>
            <TabsTrigger value="snapshots">{t("vm.snapshots")}</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <VMMetricsPanel vmName={name} apiBase="/admin" cluster={cluster} />
          </TabsContent>
          <TabsContent value="console">
            <div className="rounded-lg border border-border overflow-hidden">
              <iframe
                src={`/console?vm=${name}&cluster=${cluster}&project=${project}`}
                className="w-full h-[500px] bg-black"
                title="VM Console"
              />
            </div>
          </TabsContent>
          <TabsContent value="snapshots">
            <SnapshotPanel vmName={name} cluster={cluster} project={project} />
          </TabsContent>
        </Tabs>
      </PageContent>

      {/* Migrate Sheet */}
      <Sheet open={migrateOpen} onOpenChange={(o) => { if (!o) setMigrateOpen(false); }}>
        <SheetContent side="right" size="min(96vw, 28rem)">
          <SheetHeader>
            <SheetTitle>{t("admin.migrateTitle", { defaultValue: "迁移到目标节点" })}</SheetTitle>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-[510]">
                {t("admin.targetNode", { defaultValue: "目标节点" })}
              </label>
              <NodePicker
                clusterName={cluster}
                value={migrateTarget}
                onChange={setMigrateTarget}
                excludeNodes={currentNode ? [currentNode] : []}
                placeholder={t("admin.targetNode", { defaultValue: "目标节点" })}
                className="w-full font-mono"
              />
            </div>
          </SheetBody>
          <SheetFooter>
            <Button variant="ghost" onClick={() => setMigrateOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={migrateMutation.isPending || !migrateTarget}
              onClick={runMigrateConfirm}
            >
              {migrateMutation.isPending
                ? "..."
                : t("admin.migrateRun", { defaultValue: "迁移" })}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Reinstall Sheet */}
      <Sheet open={reinstallOpen} onOpenChange={(o) => { if (!o) setReinstallOpen(false); }}>
        <SheetContent side="right" size="min(96vw, 32rem)">
          <SheetHeader>
            <SheetTitle>{`${t("vm.reinstall")} · ${name}`}</SheetTitle>
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
              {reinstallMutation.isPending
                ? t("vm.reinstalling")
                : t("vm.reinstallConfirm")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Reset Password Sheet */}
      <Sheet open={resetPwdOpen} onOpenChange={(o) => { if (!o) setResetPwdOpen(false); }}>
        <SheetContent side="right" size="min(96vw, 28rem)">
          <SheetHeader>
            <SheetTitle>
              {t("vm.resetPwdHeading", { name, defaultValue: "重置 {{name}} 密码" })}
            </SheetTitle>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <p className="text-caption text-muted-foreground">
              {t("vm.resetPwdModeHint", {
                defaultValue:
                  "auto：先 online 失败后回落 offline；online：guest-agent chpasswd；offline：cloud-init 重启",
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
