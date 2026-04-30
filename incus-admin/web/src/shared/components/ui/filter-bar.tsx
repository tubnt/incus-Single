import type {ReactNode} from "react";
import { cn } from "@/shared/lib/utils";

/**
 * FilterBar —— 共享筛选栏（audit-logs / orders / 其它列表页）。
 * 把行内 input 散落改成统一容器：左滑横向筛选 + 右侧主操作。
 */
interface FilterBarProps {
  className?: string;
  children: ReactNode;
  /** 右侧主操作（如导出 CSV、新建按钮） */
  trailing?: ReactNode;
}

export function FilterBar({ className, children, trailing }: FilterBarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-1 p-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-end gap-3">{children}</div>
      {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}

interface FilterFieldProps {
  label: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

export function FilterField({ label, htmlFor, className, children }: FilterFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label
        htmlFor={htmlFor}
        className="text-label text-muted-foreground select-none"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
