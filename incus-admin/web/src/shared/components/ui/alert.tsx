import type {VariantProps} from "class-variance-authority";
import type {HTMLAttributes} from "react";
import { cva } from "class-variance-authority";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "@/shared/lib/utils";

const alertVariants = cva(
  cn(
    "relative w-full rounded-lg border p-4",
    "flex items-start gap-3",
    "[&>svg]:size-4 [&>svg]:mt-0.5 [&>svg]:shrink-0",
  ),
  {
    variants: {
      variant: {
        info: "bg-surface-1 border-border text-foreground [&>svg]:text-text-tertiary",
        success: "bg-status-success/8 border-status-success/30 text-foreground [&>svg]:text-status-success",
        warning: "bg-status-warning/8 border-status-warning/30 text-foreground [&>svg]:text-status-warning",
        error: "bg-status-error/8 border-status-error/30 text-foreground [&>svg]:text-status-error",
      },
    },
    defaultVariants: { variant: "info" },
  },
);

const iconMap = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
};

interface AlertProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  hideIcon?: boolean;
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "info", hideIcon, children, ...props }, ref) => {
    const Icon = iconMap[variant ?? "info"];
    return (
      <div
        ref={ref}
        role="alert"
        className={cn(alertVariants({ variant, className }))}
        {...props}
      >
        {!hideIcon ? <Icon aria-hidden="true" /> : null}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    );
  },
);
Alert.displayName = "Alert";

export function AlertTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h5
      className={cn(
        "mb-1 text-sm font-[590] leading-none tracking-tight text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function AlertDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <div className={cn("text-sm text-muted-foreground leading-relaxed", className)} {...props} />
  );
}
