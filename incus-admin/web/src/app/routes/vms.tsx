import type {VMService} from "@/features/vms/api";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Camera, ExternalLink, MoreHorizontal, Pause, Play, Plus, RefreshCw, Square, Terminal as TerminalIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { StatusDot, vmStatusToKind } from "@/shared/components/ui/status";
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
  // 高亮锁定到 VM ID，避免 useMyVMsQuery 后台 refetch 重排数组时
  // 数字索引指到不同 VM 的 race（用户按 Enter 跳错详情）
  const [hlVmId, setHlVmId] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const closeSheet = () => setSheetKind(null);

  // Linear 风键盘导航：j/k 上下、Enter 进详情、n 新建。表单/弹窗内禁用。
  useEffect(() => {
    if (services.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target.isContentEditable) return;
        if (target.closest("[role='dialog'], [cmdk-input]")) return;
      }
      const curIdx =
        hlVmId != null ? services.findIndex((v) => v.id === hlVmId) : -1;
      if (e.key === "j") {
        e.preventDefault();
        const next = Math.min(services.length - 1, (curIdx < 0 ? -1 : curIdx) + 1);
        setHlVmId(services[next]?.id ?? null);
      } else if (e.key === "k") {
        e.preventDefault();
        const next = Math.max(0, (curIdx < 0 ? services.length : curIdx) - 1);
        setHlVmId(services[next]?.id ?? null);
      } else if (e.key === "Enter" && hlVmId != null) {
        e.preventDefault();
        navigate({ to: "/vm-detail", search: { id: hlVmId } });
      } else if (e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        navigate({ to: "/launch" });
      } else if (e.key === "Escape") {
        setHlVmId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [services, hlVmId, navigate]);

  // 焦点滚动跟踪
  useEffect(() => {
    if (hlVmId == null) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-vm-id='${hlVmId}']`);
    el?.scrollIntoView({ block: "nearest" });
  }, [hlVmId]);

  useCommandActions(
    () => [
      {
        id: "user.create-vm",
        title: t("vm.createVm", { defaultValue: "新建 VM" }),
        icon: "Plus",
        perform: () => navigate({ to: "/launch" }),
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
          <Link to="/launch" className={cn(buttonVariants({ variant: "primary" }))}>
            <Plus size={14} aria-hidden="true" />
            {t("vm.createVm", { defaultValue: "新建 VM" })}
          </Link>
        }
      />
      <PageContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              // eslint-disable-next-line react/no-array-index-key -- skeleton 占位
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : services.length === 0 ? (
          <EmptyState
            title={t("vm.noneYet", { defaultValue: "你还没有云主机" })}
            description={t("vm.noneYetHint", {
              defaultValue: "前往订单页选择套餐创建你的第一台 VM。",
            })}
            action={
              <Link to="/launch" className={cn(buttonVariants({ variant: "primary" }))}>
                <Plus size={14} aria-hidden="true" />
                {t("vm.createVm", { defaultValue: "新建 VM" })}
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col gap-1.5" ref={listRef}>
            {services.map((vm) => (
              <VMCard
                key={vm.id}
                vm={vm}
                highlighted={vm.id === hlVmId}
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

function VMCard({
  vm,
  highlighted,
  onOpenSheet,
}: {
  vm: VMService;
  highlighted: boolean;
  onOpenSheet: (k: NonNullable<SheetKind>) => void;
}) {
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

  /*
   * Linear-style VM 行：
   *   - 主行：状态 dot + 名字（白、mono）+ 主操作（hover/always）+ overflow（hover 显现）
   *   - 副行：所有元数据浓缩成一行（灰、caption），用 · 分隔
   *   - hover 整行轻微提亮，强化"可点击"
   */
  return (
    <Card
      data-vm-id={vm.id}
      className={cn(
        "group/vm hover:bg-surface-secondary/40 transition-colors",
        // Linear 风键盘高亮：左侧 2px accent indicator + 轻底色
        highlighted && "bg-surface-secondary/40 ring-1 ring-accent/40",
      )}
    >
      <CardContent className="p-3 flex flex-col gap-1">
        <div className="flex items-center gap-3 min-w-0">
          <StatusDot status={status} pulse={status === "pending"} />
          <Link
            to="/vm-detail"
            search={{ id: vm.id }}
            className="text-body font-mono font-strong text-foreground hover:text-accent transition-colors truncate"
          >
            {vm.name}
          </Link>
          <span className="text-caption text-text-tertiary truncate hidden sm:inline">
            {vm.cluster_display_name || vm.cluster}
          </span>
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {isRunning ? (
              <Link
                to="/console"
                search={{
                  vm: vm.name,
                  cluster: vm.cluster,
                  project: vm.project,
                  from: "portal",
                }}
                className={cn(buttonVariants({ variant: "subtle", size: "sm" }))}
              >
                <TerminalIcon size={12} aria-hidden="true" />
                <span className="hidden sm:inline">{t("vm.console")}</span>
              </Link>
            ) : null}
            {isStopped ? (
              <Button
                size="sm"
                variant="primary"
                disabled={actionMutation.isPending}
                onClick={() => runAction("start")}
              >
                <Play size={12} aria-hidden="true" />
                <span className="hidden sm:inline">{t("vm.start")}</span>
              </Button>
            ) : null}
            <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={t("vm.moreActions", { defaultValue: "更多操作" })}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-1 px-2 text-xs font-emphasis text-foreground hover:bg-surface-2 transition-colors"
                >
                  <MoreHorizontal size={14} aria-hidden="true" />
                </button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-row-actions-menu">
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
                    search={{ id: vm.id }}
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                    {t("vm.detailLink", { defaultValue: "详情页（更多操作）" })}
                  </Link>
                }
              />
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>
        {/* 副行：所有元数据浓缩到一行（灰、caption），用 · 分隔 */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-text-tertiary pl-5">
          <span className="font-mono text-text-secondary">
            {vm.ip || t("vm.assigning", { defaultValue: "分配中..." })}
          </span>
          <span aria-hidden>·</span>
          <span>{vm.cpu}C / {(vm.memory_mb / 1024).toFixed(0)}G / {vm.disk_gb}G</span>
          <span aria-hidden>·</span>
          <span className="font-mono">{defaultUserForImage(vm.os_image)}@{vm.node}</span>
          <span aria-hidden>·</span>
          <span className="font-mono truncate">{vm.os_image}</span>
        </div>
      </CardContent>
    </Card>
  );
}
