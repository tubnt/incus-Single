import type {HTMLAttributes, ReactNode} from "react";
import { AlertDialog as BaseAlertDialog } from "@base-ui-components/react/alert-dialog";
import { cn } from "@/shared/lib/utils";

/** AlertDialog —— 不可关闭（点遮罩不行），只能通过按钮决断。 */
export const AlertDialog = BaseAlertDialog.Root;
export const AlertDialogTrigger = BaseAlertDialog.Trigger;
export const AlertDialogClose = BaseAlertDialog.Close;

interface AlertDialogContentProps extends HTMLAttributes<HTMLDivElement> {
  sheetWidth?: string;
  children?: ReactNode;
}

export function AlertDialogContent({
  className,
  sheetWidth = "min(90vw, 28rem)",
  children,
  ...props
}: AlertDialogContentProps) {
  return (
    <BaseAlertDialog.Portal>
      <BaseAlertDialog.Backdrop
        className={cn(
          "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm",
          "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
          "transition-opacity duration-150",
        )}
      />
      <BaseAlertDialog.Popup
        style={{ width: sheetWidth }}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
          "rounded-xl border border-border bg-surface-elevated",
          "p-6 shadow-[var(--shadow-dialog)] outline-none",
          "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
          "data-[starting-style]:scale-95 data-[ending-style]:scale-95",
          "transition-all duration-150",
          className,
        )}
        {...props}
      >
        {children}
      </BaseAlertDialog.Popup>
    </BaseAlertDialog.Portal>
  );
}

export function AlertDialogHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 mb-4", className)} {...props} />;
}

export function AlertDialogFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mt-6 flex flex-row justify-end gap-2", className)} {...props} />
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <BaseAlertDialog.Title
      className={cn("text-h3 font-[590] tracking-[-0.24px] text-foreground", className)}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <BaseAlertDialog.Description
      className={cn(
        "text-small text-muted-foreground leading-relaxed whitespace-pre-wrap",
        className,
      )}
      {...props}
    />
  );
}
