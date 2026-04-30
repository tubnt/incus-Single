import type {IncusInstance} from "@/features/vms/api";
import { Link } from "@tanstack/react-router";
import {
  Camera, ExternalLink, MoreHorizontal, Pause,
  Play, RefreshCw, RotateCcw, ShieldCheck, ShieldX,
  Square, Terminal as TerminalIcon, Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useDeleteVMMutation,
  useRescueEnterByNameMutation,
  useRescueExitByNameMutation,
  useVMStateMutation,
} from "@/features/vms/api";
import { Button } from "@/shared/components/ui/button";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";

interface VMRowActionsProps {
  vm: IncusInstance;
  cluster: string;
  /** 父组件提供：打开 sheet */
  onOpenSheet: (kind: "snapshots" | "metrics" | "reinstall") => void;
}

/**
 * VM 行操作（M1.E3 核心）：
 *   - 1 主操作（按 vm.status 切换语义）
 *   - 其余动作通过 DropdownMenu overflow（Carbon/PatternFly 推荐模式）
 *   - 删除走 TypedConfirmDialog（H 矩阵）
 */
export function VMRowActions({ vm, cluster, onOpenSheet }: VMRowActionsProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const project = vm.project || "customers";

  const stateMutation = useVMStateMutation();
  const deleteMutation = useDeleteVMMutation();
  const rescueEnterMutation = useRescueEnterByNameMutation();
  const rescueExitMutation = useRescueExitByNameMutation(vm.name);

  const isActing =
    stateMutation.isPending
    || deleteMutation.isPending
    || rescueEnterMutation.isPending
    || rescueExitMutation.isPending;

  const runState = (action: string) =>
    stateMutation.mutate(
      { name: vm.name, action, cluster, project },
      {
        onSuccess: () => toast.success(`${vm.name}: ${action} ${t("vm.actionSubmitted")}`),
        onError: () => toast.error(`${vm.name}: ${action} ${t("vm.actionFailed")}`),
      },
    );

  const runDelete = async () => {
    const ok = await confirm({
      title: t("deleteConfirm.vmTitle"),
      message: t("deleteConfirm.vmMessage", { name: vm.name }),
      destructive: true,
      typeToConfirm: vm.name,
      typeToConfirmLabel: t("confirmDialog.typeVmName", {
        defaultValue: "请输入 VM 名称 {{name}} 以确认",
        name: vm.name,
      }),
    });
    if (!ok) return;
    deleteMutation.mutate(
      { name: vm.name, cluster, project },
      {
        onSuccess: () => toast.success(`${vm.name} ${t("vm.deleted")}`),
        onError: () => toast.error(`${vm.name} ${t("vm.deleteFailed")}`),
        // A1: 删除是 step-up sensitive；http 层会自动 saveIntent
        // 注意：mutationFn 内部 http.delete 没传 intent 对象 -> 在 PLAN-023 接入时统一加
      },
    );
  };

  const runRescueEnter = async () => {
    const ok = await confirm({
      title: t("vm.rescueEnterTitle", { defaultValue: "进入 Rescue 模式" }),
      message: t("vm.rescueEnterMessage", {
        name: vm.name,
        defaultValue: "确认让 {{name}} 进入 Rescue 模式？会先拍快照再停机。",
      }),
      destructive: true,
    });
    if (!ok) return;
    rescueEnterMutation.mutate(vm.name, {
      onSuccess: (res) => toast.success(
        t("vm.rescueEntered", { snap: res.snapshot, defaultValue: "已进入 Rescue；快照 {{snap}}" }),
        { duration: 15_000 },
      ),
      onError: (err) => toast.error((err as Error).message),
    });
  };

  const runRescueExit = async (restore: boolean) => {
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
        onSuccess: () => toast.success(
          restore
            ? t("vm.rescueExitedRestored", { defaultValue: "已恢复快照并启动" })
            : t("vm.rescueExited", { defaultValue: "已退出 Rescue" }),
        ),
        onError: (err) => toast.error((err as Error).message),
      },
    );
  };

  // 主操作：按状态切换。光标 hover 行才 opacity-100 出现（row hover gate）
  const primary = (() => {
    if (vm.status === "Stopped") {
      return (
        <Button size="sm" variant="primary" disabled={isActing} onClick={() => runState("start")}>
          <Play size={12} aria-hidden="true" />
          {t("vm.start")}
        </Button>
      );
    }
    if (vm.status === "Running") {
      return (
        <Link
          to="/console"
          search={{
            vm: vm.name,
            cluster,
            project,
            from: "admin",
          } as any}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md h-7 px-2.5 text-xs font-emphasis",
            "bg-primary text-primary-foreground hover:bg-accent-hover",
          )}
        >
          <TerminalIcon size={12} aria-hidden="true" />
          {t("vm.console")}
        </Link>
      );
    }
    return null;
  })();

  const isRescue = vm.status === "Rescue";

  return (
    // Linear 模式：操作组在行 hover 时才完整显现（"平静态干净"），dropdown 触发器
    // 永久可见（避免操作不可发现），主操作仅 hover 显现。focus-within 保证键盘
    // 用户也能看到。row group 由父级 TableRow 提供 (`group/row`)。
    <div className="flex items-center justify-end gap-1.5">
      <span className="opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 transition-opacity">
        {primary}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={t("vm.moreActions", { defaultValue: "更多操作" })}
              disabled={isActing}
              className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-surface-1 text-text-tertiary hover:bg-surface-2 hover:text-foreground transition-colors disabled:opacity-50"
            >
              <MoreHorizontal size={14} aria-hidden="true" />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-[12rem]">
          {vm.status === "Running" ? (
            <>
              <DropdownMenuItem onClick={() => runState("stop")}>
                <Square size={14} aria-hidden="true" />
                {t("vm.stop")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => runState("restart")}>
                <RefreshCw size={14} aria-hidden="true" />
                {t("vm.restart")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onOpenSheet("metrics")}>
                <ExternalLink size={14} aria-hidden="true" />
                {t("vm.monitor")}
              </DropdownMenuItem>
            </>
          ) : null}
          {vm.status === "Stopped" ? (
            <DropdownMenuItem
              render={
                <a
                  href={`/console?vm=${encodeURIComponent(vm.name)}&cluster=${encodeURIComponent(cluster)}&project=${encodeURIComponent(project)}&from=admin`}
                >
                  <TerminalIcon size={14} aria-hidden="true" />
                  {t("vm.console")}
                </a>
              }
            />
          ) : null}
          <DropdownMenuItem onClick={() => onOpenSheet("snapshots")}>
            <Camera size={14} aria-hidden="true" />
            {t("vm.snapshots")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onOpenSheet("reinstall")}>
            <RotateCcw size={14} aria-hidden="true" />
            {t("vm.reinstall")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {!isRescue ? (
            <DropdownMenuItem onClick={runRescueEnter} disabled={isActing}>
              <ShieldCheck size={14} aria-hidden="true" />
              {t("vm.rescueEnter", { defaultValue: "Rescue" })}
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onClick={() => runRescueExit(true)} disabled={isActing}>
                <ShieldCheck size={14} aria-hidden="true" />
                {t("vm.rescueExitRestore", { defaultValue: "Rescue 恢复" })}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => runRescueExit(false)} disabled={isActing}>
                <ShieldX size={14} aria-hidden="true" />
                {t("vm.rescueExit", { defaultValue: "Rescue 退出" })}
              </DropdownMenuItem>
            </>
          )}
          {vm.status === "Frozen" ? (
            <DropdownMenuItem onClick={() => runState("unfreeze")}>
              <Pause size={14} aria-hidden="true" />
              {t("vm.unfreeze", { defaultValue: "解冻" })}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onClick={runDelete} disabled={isActing}>
            <Trash2 size={14} aria-hidden="true" />
            {t("vm.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
