import type {ReactNode} from "react";
import { Tooltip as BaseTooltip } from "@base-ui-components/react/tooltip";
import { cn } from "@/shared/lib/utils";

export const TooltipProvider = BaseTooltip.Provider;
export const TooltipRoot = BaseTooltip.Root;
export const TooltipTrigger = BaseTooltip.Trigger;

interface TooltipContentProps {
  children: ReactNode;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
}

export function TooltipContent({
  children,
  className,
  side = "top",
  sideOffset = 6,
}: TooltipContentProps) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner side={side} sideOffset={sideOffset}>
        <BaseTooltip.Popup
          className={cn(
            "z-50 rounded-md border border-border bg-surface-elevated",
            "px-2 py-1 text-label text-foreground shadow-dialog",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            "transition-opacity duration-100",
            className,
          )}
        >
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  );
}

/** 简短包装：传 content 字符串即可。 */
export function Tooltip({
  content,
  children,
  side,
  delay = 200,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delay?: number;
}) {
  return (
    <TooltipProvider delay={delay}>
      <TooltipRoot>
        <TooltipTrigger render={<span>{children as any}</span>} />
        <TooltipContent side={side}>{content}</TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}
