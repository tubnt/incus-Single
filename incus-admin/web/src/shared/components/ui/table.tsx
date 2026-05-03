import type {
  HTMLAttributes,
  Ref,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { cn } from "@/shared/lib/utils";

/**
 * Table primitives —— 仅样式层。配合 `<DataTable>`（高阶组件）使用。
 * 业务页面应优先用 `<DataTable>`，少数静态展示场景才直接用这些 primitive。
 */

type TableProps = HTMLAttributes<HTMLTableElement> & { ref?: Ref<HTMLTableElement> };
type SectionProps = HTMLAttributes<HTMLTableSectionElement> & { ref?: Ref<HTMLTableSectionElement> };
type RowProps = HTMLAttributes<HTMLTableRowElement> & { ref?: Ref<HTMLTableRowElement> };
type HeadCellProps = ThHTMLAttributes<HTMLTableCellElement> & { ref?: Ref<HTMLTableCellElement> };
type CellProps = TdHTMLAttributes<HTMLTableCellElement> & { ref?: Ref<HTMLTableCellElement> };
type CaptionProps = HTMLAttributes<HTMLTableCaptionElement> & { ref?: Ref<HTMLTableCaptionElement> };

export function Table({ className, ref, ...props }: TableProps) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table
        ref={ref}
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({ className, ref, ...props }: SectionProps) {
  return (
    <thead
      ref={ref}
      className={cn(
        "bg-surface-1 text-text-tertiary",
        "[&_tr]:border-b [&_tr]:border-border",
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ref, ...props }: SectionProps) {
  return <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableFooter({ className, ref, ...props }: SectionProps) {
  return (
    <tfoot
      ref={ref}
      className={cn("border-t border-border bg-surface-1 font-emphasis", className)}
      {...props}
    />
  );
}

export function TableRow({ className, ref, ...props }: RowProps) {
  return (
    <tr
      ref={ref}
      className={cn(
        "border-b border-border transition-colors hover:bg-surface-1",
        "data-[state=selected]:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ref, ...props }: HeadCellProps) {
  return (
    <th
      ref={ref}
      className={cn(
        // OPS-035: dense table — 列头 14px / 行高 32 与 GitHub Primer 对齐
        "h-8 px-3 text-left align-middle text-sm font-emphasis text-text-tertiary",
        "[&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ref, ...props }: CellProps) {
  return (
    <td
      ref={ref}
      className={cn(
        // OPS-035: dense row 行高 ≈ 36px（py-1.5 * 2 + 24 line-height）
        "px-3 py-1.5 align-middle text-foreground",
        "[&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

export function TableCaption({ className, ref, ...props }: CaptionProps) {
  return (
    <caption
      ref={ref}
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}
