import type {ReactNode} from "react";
import type { BreadcrumbItemData } from "@/shared/components/ui/breadcrumb";
import { Breadcrumb } from "@/shared/components/ui/breadcrumb";
import { cn } from "@/shared/lib/utils";

/**
 * 页面骨架四件套：PageShell / PageHeader / PageToolbar / PageContent。
 * 所有路由文件统一用这套，禁止再在 routes/*.tsx 里直接堆 <h1> + table。
 */

export function PageShell({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-4", className)} {...props}>
      {children}
    </div>
  );
}

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: BreadcrumbItemData[];
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumb items={breadcrumbs} /> : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-h2 font-emphasis text-foreground">
            {title}
          </h1>
          {description ? (
            // 副标题更轻：caption (13px) text-tertiary —— 主副对比更明确，
            // 避免和大标题 (32px 510) 抢视觉重量
            <p className="mt-1 text-caption text-text-tertiary max-w-2xl">{description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {meta}
          {actions}
        </div>
      </div>
    </header>
  );
}

export function PageToolbar({
  className,
  children,
}: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageContent({
  className,
  children,
}: { className?: string; children: ReactNode }) {
  return <section className={cn("flex flex-col gap-3", className)}>{children}</section>;
}
