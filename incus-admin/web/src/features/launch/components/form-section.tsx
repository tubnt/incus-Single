import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * FormSection —— `/launch` 整页线性流的分段头：序号 + 标题 + 提示。
 * 视觉与 admin/create-vm 的同名组件刻意区分（带圆形序号）以体现"步骤"语义。
 */
export function FormSection({
  index,
  title,
  hint,
  children,
}: {
  index: string;
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-full",
            "border border-border bg-surface-1 font-emphasis text-caption text-text-secondary",
          )}
        >
          {index}
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-emphasis text-foreground">{title}</h2>
          {hint ? <p className="text-caption text-text-tertiary">{hint}</p> : null}
        </div>
      </div>
      <div className="pl-9">{children}</div>
    </section>
  );
}
