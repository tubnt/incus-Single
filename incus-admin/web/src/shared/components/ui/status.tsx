import type {ReactNode} from "react";
import { cn } from "@/shared/lib/utils";

/**
 * 状态系统 —— 全站统一替代各页自定义 StatusBadge。
 * 5 种语义状态 + DESIGN.md 调色板：
 *   running/active/success → 实心绿点
 *   pending/in-progress    → 蓝点（旋转）
 *   error/failed           → 实心红点
 *   gone/disabled          → 空心灰点
 *   frozen/paused          → 半透明紫点
 */
export type StatusKind =
  | "running"
  | "active"
  | "success"
  | "pending"
  | "error"
  | "failed"
  | "gone"
  | "stale"
  | "disabled"
  | "frozen"
  | "paused"
  | "warning";

const statusToColor: Record<StatusKind, string> = {
  running: "bg-status-success",
  active: "bg-status-success",
  success: "bg-status-success",
  pending: "bg-status-pending",
  error: "bg-status-error",
  failed: "bg-status-error",
  gone: "bg-transparent border border-text-tertiary",
  stale: "bg-transparent border border-text-tertiary",
  disabled: "bg-transparent border border-text-tertiary",
  frozen: "bg-status-pending/50",
  paused: "bg-status-pending/50",
  warning: "bg-status-warning",
};

/** 8px 圆点 + label，inline 用（VM 状态行内、节点列表等）。 */
export function StatusDot({
  status,
  label,
  className,
  pulse,
}: {
  status: StatusKind;
  label?: ReactNode;
  className?: string;
  pulse?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "inline-block size-2 rounded-full shrink-0",
          statusToColor[status],
          pulse && status === "pending" && "animate-pulse",
        )}
      />
      {label ? <span className="text-sm text-foreground">{label}</span> : null}
    </span>
  );
}

/** Pill 形 badge，独立显示用。 */
export function StatusPill({
  status,
  children,
  className,
}: {
  status: StatusKind;
  children: ReactNode;
  className?: string;
}) {
  const tone: Record<StatusKind, string> = {
    running: "text-status-success border-status-success/40",
    active: "text-status-success border-status-success/40",
    success: "text-status-success border-status-success/40",
    pending: "text-status-pending border-status-pending/40",
    error: "text-status-error border-status-error/40",
    failed: "text-status-error border-status-error/40",
    gone: "text-text-tertiary border-border",
    stale: "text-text-tertiary border-border",
    disabled: "text-text-tertiary border-border",
    frozen: "text-status-pending border-status-pending/30",
    paused: "text-status-pending border-status-pending/30",
    warning: "text-status-warning border-status-warning/40",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border",
        "px-2.5 py-0.5 text-label font-emphasis tracking-tight whitespace-nowrap",
        tone[status],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("inline-block size-1.5 rounded-full", statusToColor[status])}
      />
      {children}
    </span>
  );
}

/** 兼容老代码：把 VM 字符串状态映射为 StatusKind。 */
export function vmStatusToKind(s: string | undefined): StatusKind {
  switch ((s ?? "").toLowerCase()) {
    case "running":
      return "running";
    case "stopped":
      return "disabled";
    case "frozen":
    case "paused":
      return "frozen";
    case "error":
    case "failed":
      return "error";
    case "rescue":
      return "warning";
    case "gone":
      return "gone";
    case "starting":
    case "stopping":
    case "restarting":
    case "pending":
    case "creating":
      return "pending";
    default:
      return "disabled";
  }
}
