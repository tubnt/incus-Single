import type {IncusInstance} from "@/features/vms/api";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight, Camera, ExternalLink, Pause, Play,
  RefreshCw, Square, Terminal as TerminalIcon, X,
} from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { extractIP, useVMStateMutation } from "@/features/vms/api";
import { Button } from "@/shared/components/ui/button";
import { StatusPill, vmStatusToKind } from "@/shared/components/ui/status";
import { cn } from "@/shared/lib/utils";

interface VMPeekPanelProps {
  vm: IncusInstance | null;
  cluster: string;
  onClose: () => void;
  onOpenSnapshots?: () => void;
}

/**
 * VMPeekPanel —— PLAN-024.C：admin VM 列表行点击的右侧"详情速览"。
 *
 * 与独立 vm-detail 路由的关系：peek 只展示 VM 概要 + 主操作；点"完整详情"
 * 才跳页。Linear 风：fixed 右侧、无 backdrop（不阻塞列表交互）、可连续切换不同行。
 *
 * 键盘：Esc 关闭。
 */
export function VMPeekPanel({ vm, cluster, onClose, onOpenSnapshots }: VMPeekPanelProps) {
  const { t } = useTranslation();
  const stateMutation = useVMStateMutation();

  useEffect(() => {
    if (!vm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const target = e.target as HTMLElement | null;
        if (target?.closest("[role='dialog'], [cmdk-input], input, textarea")) return;
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vm, onClose]);

  if (!vm) return null;

  const project = vm.project || "customers";
  const ip = vm.ip || extractIP(vm) || "—";
  const status = vmStatusToKind(vm.status);
  const isRunning = vm.status === "Running";
  const isStopped = vm.status === "Stopped";
  const isFrozen = vm.status === "Frozen";

  const runAction = (action: string) =>
    stateMutation.mutate(
      { name: vm.name, action, cluster, project },
      {
        onSuccess: () => toast.success(`${vm.name}: ${action} ${t("vm.actionSubmitted")}`),
        onError: () => toast.error(`${vm.name}: ${action} ${t("vm.actionFailed")}`),
      },
    );

  return (
    <aside
      role="complementary"
      aria-label={t("vm.peekPanelAria", { defaultValue: "VM 详情速览：{{name}}", name: vm.name })}
      className={cn(
        "fixed right-0 top-0 z-30 h-screen w-[min(92vw,24rem)]",
        "flex flex-col bg-surface-elevated border-l border-border",
        "shadow-floating",
        "animate-in slide-in-from-right-2 fade-in duration-150",
      )}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <StatusPill status={status}>{vm.status}</StatusPill>
            <span className="font-mono font-strong text-foreground text-body truncate">
              {vm.name}
            </span>
          </div>
          <p className="text-caption text-text-tertiary mt-1 truncate">
            {cluster} / {project}
          </p>
        </div>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={onClose}
          className="inline-flex size-7 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-2 hover:text-foreground transition-colors"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
        <DefList>
          <DefRow label={t("vm.ip")} value={<span className="font-mono">{ip}</span>} />
          <DefRow label={t("vm.node")} value={<span className="font-mono">{vm.location || "—"}</span>} />
          <DefRow
            label={t("vm.config")}
            value={
              <span className="font-mono tabular-nums">
                {vm.config?.["limits.cpu"] ?? "—"}C · {vm.config?.["limits.memory"] ?? "—"}
              </span>
            }
          />
          <DefRow label={t("vm.type")} value={vm.type || "—"} />
        </DefList>

        {/* 主操作 */}
        <div className="flex flex-wrap gap-2">
          {isStopped ? (
            <Button
              size="sm"
              variant="primary"
              disabled={stateMutation.isPending}
              onClick={() => runAction("start")}
            >
              <Play size={12} aria-hidden="true" />
              {t("vm.start")}
            </Button>
          ) : null}
          {isRunning ? (
            <>
              <Link
                to="/console"
                search={{ vm: vm.name, cluster, project, from: "admin" } as any}
                className="inline-flex items-center gap-1.5 rounded-md h-8 px-3 text-sm font-emphasis bg-primary text-primary-foreground hover:bg-accent-hover transition-colors"
              >
                <TerminalIcon size={12} aria-hidden="true" />
                {t("vm.console")}
              </Link>
              <Button
                size="sm"
                variant="ghost"
                disabled={stateMutation.isPending}
                onClick={() => runAction("stop")}
              >
                <Square size={12} aria-hidden="true" />
                {t("vm.stop")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={stateMutation.isPending}
                onClick={() => runAction("restart")}
              >
                <RefreshCw size={12} aria-hidden="true" />
                {t("vm.restart")}
              </Button>
            </>
          ) : null}
          {isFrozen ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={stateMutation.isPending}
              onClick={() => runAction("unfreeze")}
            >
              <Pause size={12} aria-hidden="true" />
              {t("vm.unfreeze", { defaultValue: "解冻" })}
            </Button>
          ) : null}
          {onOpenSnapshots ? (
            <Button size="sm" variant="ghost" onClick={onOpenSnapshots}>
              <Camera size={12} aria-hidden="true" />
              {t("vm.snapshots")}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Footer：跳完整详情 */}
      <footer className="px-5 py-4 border-t border-border bg-surface-1">
        <Link
          to="/admin/vm-detail"
          search={{ name: vm.name, cluster, project } as any}
          className="inline-flex w-full items-center justify-between gap-2 rounded-md px-3 h-9 text-sm font-emphasis border border-border bg-surface-1 text-foreground hover:bg-surface-2 transition-colors"
        >
          <span className="inline-flex items-center gap-2">
            <ExternalLink size={12} aria-hidden="true" />
            {t("vm.openFullDetail", { defaultValue: "查看完整详情" })}
          </span>
          <ArrowUpRight size={14} aria-hidden="true" className="text-text-tertiary" />
        </Link>
      </footer>
    </aside>
  );
}

function DefList({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">{children}</dl>;
}

function DefRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-text-tertiary text-caption uppercase tracking-wide font-emphasis">{label}</dt>
      <dd className="text-foreground min-w-0 break-words">{value}</dd>
    </>
  );
}
