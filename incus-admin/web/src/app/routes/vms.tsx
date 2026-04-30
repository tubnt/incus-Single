import type {VMService} from "@/features/vms/api";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Camera, ExternalLink, MoreHorizontal, Pause, Play, Plus, RefreshCw, Square, Terminal as TerminalIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { VMMetricsPanel } from "@/features/monitoring/vm-metrics-panel";
import { SnapshotPanel } from "@/features/snapshots/snapshot-panel";
import { useMyVMsQuery, useVMActionMutation } from "@/features/vms/api";
import { defaultUserForImage } from "@/features/vms/default-user";
import { useCommandActions } from "@/shared/components/command-palette/use-command-actions";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Button, buttonVariants } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { EmptyState } from "@/shared/components/ui/empty-state";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { CardSkeleton } from "@/shared/components/ui/skeleton";
import { StatusPill, vmStatusToKind } from "@/shared/components/ui/status";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/vms")({
  component: MyVMs,
});

type SheetKind = "snapshots" | "metrics" | null;

function MyVMs() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useMyVMsQuery();
  const services = data?.vms ?? [];

  const [sheetKind, setSheetKind] = useState<SheetKind>(null);
  const [sheetVM, setSheetVM] = useState<VMService | null>(null);

  const closeSheet = () => setSheetKind(null);

  useCommandActions(
    () => [
      {
        id: "user.create-vm",
        title: t("vm.createVm", { defaultValue: "新建 VM" }),
        icon: "Plus",
        perform: () => navigate({ to: "/billing" }),
      },
    ],
    [navigate, t],
  );

  return (
    <PageShell>
      <PageHeader
        title={t("vm.myVms", { defaultValue: "我的云主机" })}
        description={t("vm.myVmsDescription", {
          defaultValue: "管理你的虚拟机：启动 / 停止 / 控制台 / 快照。更多操作请进入详情页。",
        })}
        actions={
          <Link to="/billing" className={cn(buttonVariants({ variant: "primary" }))}>
            <Plus size={14} aria-hidden="true" />
            {t("vm.createVm", { defaultValue: "新建 VM" })}
          </Link>
        }
      />
      <PageContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : services.length === 0 ? (
          <EmptyState
            title={t("vm.noneYet", { defaultValue: "你还没有云主机" })}
            description={t("vm.noneYetHint", {
              defaultValue: "前往订单页选择套餐创建你的第一台 VM。",
            })}
            action={
              <Link to="/billing" className={cn(buttonVariants({ variant: "primary" }))}>
                <Plus size={14} aria-hidden="true" />
                {t("vm.createVm", { defaultValue: "新建 VM" })}
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {services.map((vm) => (
              <VMCard
                key={vm.id}
                vm={vm}
                onOpenSheet={(kind) => {
                  setSheetVM(vm);
                  setSheetKind(kind);
                }}
              />
            ))}
          </div>
        )}
      </PageContent>

      {sheetVM ? (
        <Sheet open={sheetKind !== null} onOpenChange={(o) => { if (!o) closeSheet(); }}>
          <SheetContent side="right" size="min(96vw, 38rem)">
            <SheetHeader>
              <SheetTitle>
                {sheetKind === "snapshots"
                  ? t("vm.snapshots", { defaultValue: "快照" })
                  : t("vm.metrics", { defaultValue: "指标" })}
                {" · "}
                <span className="font-mono text-text-tertiary">{sheetVM.name}</span>
              </SheetTitle>
              <SheetDescription>
                {sheetKind === "snapshots"
                  ? t("vm.snapshotsHelpUser", {
                      defaultValue: "你可以创建快照、回滚或删除（删除不可恢复）。",
                    })
                  : t("vm.metricsHelp", {
                      defaultValue: "实时指标流，每 5s 刷新一次。",
                    })}
              </SheetDescription>
            </SheetHeader>
            <SheetBody>
              {sheetKind === "snapshots" ? (
                <SnapshotPanel
                  vmName={sheetVM.name}
                  cluster={sheetVM.cluster}
                  project={sheetVM.project}
                  apiBase="/portal"
                />
              ) : null}
              {sheetKind === "metrics" && sheetVM.status === "running" ? (
                <VMMetricsPanel vmName={sheetVM.name} apiBase="/portal" />
              ) : null}
              {sheetKind === "metrics" && sheetVM.status !== "running" ? (
                <div className="text-sm text-muted-foreground">
                  {t("vm.metricsRunningOnly", {
                    defaultValue: "仅运行中的 VM 才有实时指标。",
                  })}
                </div>
              ) : null}
            </SheetBody>
          </SheetContent>
        </Sheet>
      ) : null}
    </PageShell>
  );
}

function VMCard({ vm, onOpenSheet }: { vm: VMService; onOpenSheet: (k: NonNullable<SheetKind>) => void }) {
  const { t } = useTranslation();
  const actionMutation = useVMActionMutation(vm.id);

  const runAction = (action: string) =>
    actionMutation.mutate(action, {
      onSuccess: () =>
        toast.success(`${vm.name}: ${action} ${t("vm.actionSubmitted", { defaultValue: "已提交" })}`),
      onError: () =>
        toast.error(`${vm.name}: ${action} ${t("vm.actionFailed", { defaultValue: "失败" })}`),
    });

  const status = vmStatusToKind(vm.status);
  const isRunning = vm.status === "running";
  const isStopped = vm.status === "stopped";

  return (
    <Card>
      <CardContent className="p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/vm-detail"
                search={{ id: vm.id } as any}
                className="font-mono font-[590] text-accent hover:underline truncate"
              >
                {vm.name}
              </Link>
              <StatusPill status={status}>{vm.status}</StatusPill>
              <span className="text-caption text-text-tertiary">
                {vm.cluster_display_name || vm.cluster}
              </span>
            </div>
            <div className="text-caption text-text-tertiary mt-1">
              {vm.cpu}C · {(vm.memory_mb / 1024).toFixed(0)}G RAM · {vm.disk_gb}G ·{" "}
              <span className="font-mono">{vm.os_image}</span>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-2 text-caption">
          <div>
            <dt className="text-text-tertiary">IP</dt>
            <dd className="font-mono mt-0.5">
              {vm.ip || t("vm.assigning", { defaultValue: "分配中..." })}
            </dd>
          </div>
          <div>
            <dt className="text-text-tertiary">{t("vm.username", { defaultValue: "Username" })}</dt>
            <dd className="font-mono mt-0.5">{defaultUserForImage(vm.os_image)}</dd>
          </div>
          <div>
            <dt className="text-text-tertiary">{t("vm.node", { defaultValue: "节点" })}</dt>
            <dd className="mt-0.5 truncate">{vm.node}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {isRunning ? (
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
          ) : null}
          {isStopped ? (
            <Button size="sm" variant="primary" disabled={actionMutation.isPending} onClick={() => runAction("start")}>
              <Play size={12} aria-hidden="true" />
              {t("vm.start")}
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={t("vm.moreActions", { defaultValue: "更多操作" })}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-1 px-2 text-xs font-[510] text-foreground hover:bg-surface-2 transition-colors"
                >
                  <MoreHorizontal size={14} aria-hidden="true" />
                </button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-[12rem]">
              {isRunning ? (
                <>
                  <DropdownMenuItem onClick={() => runAction("stop")}>
                    <Square size={14} aria-hidden="true" />
                    {t("vm.stop")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => runAction("restart")}>
                    <RefreshCw size={14} aria-hidden="true" />
                    {t("vm.restart")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenSheet("metrics")}>
                    <ExternalLink size={14} aria-hidden="true" />
                    {t("vm.monitor", { defaultValue: "监控" })}
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuItem onClick={() => onOpenSheet("snapshots")}>
                <Camera size={14} aria-hidden="true" />
                {t("vm.snapshots")}
              </DropdownMenuItem>
              {vm.status === "frozen" ? (
                <DropdownMenuItem onClick={() => runAction("unfreeze")}>
                  <Pause size={14} aria-hidden="true" />
                  {t("vm.unfreeze", { defaultValue: "解冻" })}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                render={
                  <Link
                    to="/vm-detail"
                    search={{ id: vm.id } as any}
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                    {t("vm.detailLink", { defaultValue: "详情页（更多操作）" })}
                  </Link>
                }
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
