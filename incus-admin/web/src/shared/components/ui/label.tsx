import type {LabelHTMLAttributes} from "react";
import { forwardRef } from "react";
import { cn } from "@/shared/lib/utils";

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, children, required, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-sm font-emphasis leading-none text-foreground",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      {required ? <span className="ml-0.5 text-status-error">*</span> : null}
    </label>
  ),
);
Label.displayName = "Label";
