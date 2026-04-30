import type {ComponentProps} from "react";
import { Switch as BaseSwitch } from "@base-ui-components/react/switch";
import { cn } from "@/shared/lib/utils";

interface SwitchProps extends ComponentProps<typeof BaseSwitch.Root> {}

export function Switch({ className, ...props }: SwitchProps) {
  return (
    <BaseSwitch.Root
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full",
        "border border-transparent transition-colors",
        "bg-surface-3 data-[checked]:bg-primary",
        "focus-visible:outline-none",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          "block size-4 rounded-full bg-text-primary shadow-sm",
          "transition-transform duration-150",
          "translate-x-0.5 data-[checked]:translate-x-[18px]",
        )}
      />
    </BaseSwitch.Root>
  );
}
