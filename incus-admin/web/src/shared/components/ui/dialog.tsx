import type {HTMLAttributes, ReactNode} from "react";
import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/**
 * Dialog —— 包装 base-ui Dialog primitive。
 * 视觉遵循 DESIGN.md §Component Stylings + multi-layer dialog shadow。
 */

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

interface DialogContentProps extends HTMLAttributes<HTMLDivElement> {
  showCloseButton?: boolean;
  /** 默认 24rem 宽（适合 confirm dialog）；用 sheetWidth 改 */
  sheetWidth?: string;
  children?: ReactNode;
}

export function DialogContent({
  className,
  children,
  showCloseButton = true,
  sheetWidth = "min(90vw, 28rem)",
  ...props
}: DialogContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop
        className={cn(
          "fixed inset-0 z-50 bg-black/85 backdrop-blur-sm",
          "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
          "transition-opacity duration-150",
        )}
      />
      <BaseDialog.Popup
        style={{ width: sheetWidth }}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
          "rounded-xl border border-border bg-surface-elevated",
          "p-6 shadow-dialog outline-none",
          "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
          "data-[starting-style]:scale-95 data-[ending-style]:scale-95",
          "transition-all duration-150",
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

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 mb-4", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mt-6 flex flex-row justify-end gap-2", className)} {...props} />
  );
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <BaseDialog.Title
      className={cn("text-h3 font-strong text-foreground", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <BaseDialog.Description
      className={cn(
        "text-small text-muted-foreground whitespace-pre-wrap",
        className,
      )}
      {...props}
    />
  );
}
