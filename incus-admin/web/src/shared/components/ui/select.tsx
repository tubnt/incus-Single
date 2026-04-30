import type {ComponentProps, ReactNode} from "react";
import { Select as BaseSelect } from "@base-ui-components/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export const Select = BaseSelect.Root;
export const SelectValue = BaseSelect.Value;

interface SelectTriggerProps extends ComponentProps<typeof BaseSelect.Trigger> {
  className?: string;
  children?: ReactNode;
}

export function SelectTrigger({ className, children, ...props }: SelectTriggerProps) {
  return (
    <BaseSelect.Trigger
      className={cn(
        "inline-flex h-9 w-full items-center justify-between gap-2 rounded-md",
        "border border-border bg-surface-1 px-3 py-1.5 text-sm text-foreground",
        "transition-colors",
        "hover:bg-surface-2",
        "focus:outline-none focus:border-[color:var(--accent)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    >
      {children}
      <BaseSelect.Icon>
        <ChevronDown size={14} className="text-text-tertiary" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
}

interface SelectContentProps extends ComponentProps<typeof BaseSelect.Popup> {
  align?: "start" | "center" | "end";
  sideOffset?: number;
}

export function SelectContent({
  className,
  align = "start",
  sideOffset = 4,
  ...props
}: SelectContentProps) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner align={align} sideOffset={sideOffset}>
        <BaseSelect.Popup
          className={cn(
            "z-50 max-h-[--available-height] min-w-[var(--anchor-width)]",
            "rounded-lg border border-border bg-surface-elevated p-1",
            "shadow-dialog outline-none",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            "data-[starting-style]:scale-95 data-[ending-style]:scale-95",
            "transition-all duration-100",
            className,
          )}
          {...props}
        />
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
}

interface SelectItemProps extends ComponentProps<typeof BaseSelect.Item> {}

export function SelectItem({ className, children, ...props }: SelectItemProps) {
  return (
    <BaseSelect.Item
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-2",
        "rounded-md py-1.5 pl-8 pr-2 text-sm text-foreground outline-none",
        "data-[highlighted]:bg-surface-2",
        "data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 inline-flex size-4 items-center justify-center">
        <BaseSelect.ItemIndicator>
          <Check size={14} className="text-accent" aria-hidden="true" />
        </BaseSelect.ItemIndicator>
      </span>
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
    </BaseSelect.Item>
  );
}

export function SelectGroupLabel({
  className,
  ...props
}: ComponentProps<typeof BaseSelect.GroupLabel>) {
  return (
    <BaseSelect.GroupLabel
      className={cn("px-2 py-1.5 text-label font-emphasis text-text-tertiary", className)}
      {...props}
    />
  );
}

export const SelectGroup = BaseSelect.Group;
export const SelectSeparator = ({
  className,
  ...props
}: ComponentProps<typeof BaseSelect.Separator>) => (
  <BaseSelect.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
);
