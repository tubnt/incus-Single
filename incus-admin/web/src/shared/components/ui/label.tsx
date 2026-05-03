import type { LabelHTMLAttributes, Ref } from "react";
import { cn } from "@/shared/lib/utils";

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  ref?: Ref<HTMLLabelElement>;
}

export function Label({ className, children, required, ref, ...props }: LabelProps) {
  return (
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
  );
}
