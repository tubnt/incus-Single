import type {HTMLAttributes} from "react";
import { cn } from "@/shared/lib/utils";

/**
 * Skeleton —— Linear 风：surface-2 底 + 缓慢呼吸动画。
 * 必须匹配最终内容形状（不要通用 spinner）。
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("animate-pulse rounded-md bg-surface-2", className)} {...props} />
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="bg-surface-1 px-4 py-3 border-b border-border">
        <Skeleton className="h-4 w-32" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={cn("flex gap-4 px-4 py-3", i > 0 && "border-t border-border")}
        >
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4 space-y-3">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-surface-1 p-4 space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-24" />
        </div>
      ))}
    </div>
  );
}
