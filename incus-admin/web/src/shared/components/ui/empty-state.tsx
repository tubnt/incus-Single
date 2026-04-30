import type {LucideIcon} from "lucide-react";
import type {ReactNode} from "react";
import { cn } from "@/shared/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** 列表/卡片空态。结构：图标 + 标题 + 描述 + 单一 CTA。 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        "rounded-lg border border-dashed border-border bg-surface-1 px-6 py-16",
        className,
      )}
    >
      {Icon ? (
        <span className="mb-4 inline-flex size-12 items-center justify-center rounded-full bg-surface-2 text-text-tertiary">
          <Icon size={20} aria-hidden="true" />
        </span>
      ) : null}
      <h3 className="text-h3 font-[590] text-foreground tracking-[-0.24px]">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-md text-small text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

interface ErrorStateProps {
  title: ReactNode;
  description?: ReactNode;
  retry?: () => void;
  retryLabel?: ReactNode;
  className?: string;
}

/** 错误态。红色边框 + 描述 + 重试按钮。 */
export function ErrorState({
  title,
  description,
  retry,
  retryLabel = "重试",
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border border-status-error/30 bg-status-error/8 p-4",
        className,
      )}
    >
      <h3 className="text-sm font-[590] text-status-error">{title}</h3>
      {description ? (
        <p className="mt-1 text-small text-muted-foreground">{description}</p>
      ) : null}
      {retry ? (
        <button
          type="button"
          onClick={retry}
          className={cn(
            "mt-3 inline-flex h-8 items-center rounded-md px-3 text-sm font-[510]",
            "border border-border bg-surface-1 text-foreground",
            "hover:bg-surface-2 transition-colors",
          )}
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
