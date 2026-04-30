import type {HTMLAttributes, ReactNode} from "react";
import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/**
 * Sheet —— 侧边滑入抽屉（基于 base-ui Dialog）。
 * 主要用于 Create/Edit 表单、Snapshots/Metrics 行内面板替代。
 */
export const Sheet = BaseDialog.Root;
export const SheetTrigger = BaseDialog.Trigger;
export const SheetClose = BaseDialog.Close;

interface SheetContentProps extends HTMLAttributes<HTMLDivElement> {
  side?: "right" | "left" | "top" | "bottom";
  /** 默认 28rem 宽（右抽屉） */
  size?: string;
  showCloseButton?: boolean;
  children?: ReactNode;
}

export function SheetContent({
  className,
  side = "right",
  size,
  showCloseButton = true,
  children,
  ...props
}: SheetContentProps) {
  const positionClass = {
    right: "right-0 top-0 h-full",
    left: "left-0 top-0 h-full",
    top: "left-0 top-0 w-full",
    bottom: "left-0 bottom-0 w-full",
  }[side];

  const enterClass = {
    right: "data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full",
    left: "data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full",
    top: "data-[starting-style]:-translate-y-full data-[ending-style]:-translate-y-full",
    bottom: "data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full",
  }[side];

  const sizeStyle =
    size != null
      ? side === "left" || side === "right"
        ? { width: size }
        : { height: size }
      : side === "left" || side === "right"
        ? { width: "min(90vw, 28rem)" }
        : { height: "min(80vh, 28rem)" };

  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop
        className={cn(
          "fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]",
          "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
          "transition-opacity duration-200",
        )}
      />
      <BaseDialog.Popup
        style={sizeStyle}
        className={cn(
          "fixed z-50 flex flex-col bg-surface-elevated outline-none",
          "border-border shadow-dialog",
          positionClass,
          side === "right" && "border-l",
          side === "left" && "border-r",
          side === "top" && "border-b",
          side === "bottom" && "border-t",
          enterClass,
          "transition-transform duration-200 ease-out",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <BaseDialog.Close
            aria-label="关闭"
            className={cn(
              "absolute right-3 top-3 inline-flex size-7 items-center justify-center",
              "rounded-md text-text-tertiary hover:bg-surface-2 hover:text-foreground",
              "transition-colors",
            )}
          >
            <X size={16} />
          </BaseDialog.Close>
        ) : null}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 px-6 py-5 border-b border-border",
        className,
      )}
      {...props}
    />
  );
}

export function SheetBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-y-auto px-6 py-5", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-row justify-end gap-2 px-6 py-4 border-t border-border bg-surface-1",
        className,
      )}
      {...props}
    />
  );
}

export function SheetTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <BaseDialog.Title
      className={cn("text-h3 font-strong text-foreground", className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <BaseDialog.Description
      className={cn("text-small text-muted-foreground", className)}
      {...props}
    />
  );
}
