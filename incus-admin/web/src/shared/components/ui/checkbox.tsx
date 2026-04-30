import type {ComponentProps} from "react";
import { Checkbox as BaseCheckbox } from "@base-ui-components/react/checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface CheckboxProps extends ComponentProps<typeof BaseCheckbox.Root> {}

export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <BaseCheckbox.Root
      className={cn(
        "inline-flex size-4 items-center justify-center rounded-sm",
        "border border-border bg-surface-1 transition-colors",
        "hover:border-[color:var(--accent)]",
        "data-[checked]:bg-primary data-[checked]:border-primary",
        "data-[indeterminate]:bg-primary data-[indeterminate]:border-primary",
        "focus-visible:outline-none",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    >
      <BaseCheckbox.Indicator className="text-primary-foreground">
        {(props as any)?.indeterminate ? <Minus size={12} /> : <Check size={12} />}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}
