import type {ComponentProps} from "react";
import { ScrollArea as BaseScrollArea } from "@base-ui-components/react/scroll-area";
import { cn } from "@/shared/lib/utils";

export function ScrollArea({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseScrollArea.Root>) {
  return (
    <BaseScrollArea.Root
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <BaseScrollArea.Viewport className="size-full">
        {children}
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar
        orientation="vertical"
        className="m-0.5 flex w-1.5 touch-none select-none rounded-full bg-transparent transition-colors hover:bg-surface-1"
      >
        <BaseScrollArea.Thumb className="relative flex-1 rounded-full bg-border-secondary" />
      </BaseScrollArea.Scrollbar>
      <BaseScrollArea.Scrollbar
        orientation="horizontal"
        className="m-0.5 flex h-1.5 touch-none select-none flex-col rounded-full bg-transparent transition-colors hover:bg-surface-1"
      >
        <BaseScrollArea.Thumb className="relative flex-1 rounded-full bg-border-secondary" />
      </BaseScrollArea.Scrollbar>
    </BaseScrollArea.Root>
  );
}
