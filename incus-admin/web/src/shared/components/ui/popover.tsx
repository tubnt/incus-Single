import type {ComponentProps} from "react";
import { Popover as BasePopover } from "@base-ui-components/react/popover";
import { cn } from "@/shared/lib/utils";

export const Popover = BasePopover.Root;
export const PopoverTrigger = BasePopover.Trigger;

interface PopoverContentProps extends ComponentProps<typeof BasePopover.Popup> {
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  align?: "start" | "center" | "end";
}

export function PopoverContent({
  className,
  side = "bottom",
  sideOffset = 6,
  align = "start",
  ...props
}: PopoverContentProps) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner side={side} sideOffset={sideOffset} align={align}>
        <BasePopover.Popup
          className={cn(
            "z-50 min-w-[10rem] rounded-lg border border-border bg-surface-elevated",
            "p-1 shadow-dialog outline-none",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            "data-[starting-style]:scale-95 data-[ending-style]:scale-95",
            "transition-all duration-100",
            className,
          )}
          {...props}
        />
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}
