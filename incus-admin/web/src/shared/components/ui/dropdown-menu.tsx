import type {ComponentProps} from "react";
import { Menu } from "@base-ui-components/react/menu";
import { Check } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/**
 * DropdownMenu —— 行操作 overflow 菜单（DESIGN.md / Carbon 推荐模式）。
 * 1 主操作 inline + 其余动作 → DropdownMenu。
 */
export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

interface DropdownMenuContentProps extends ComponentProps<typeof Menu.Popup> {
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  align?: "start" | "center" | "end";
}

export function DropdownMenuContent({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "end",
  ...props
}: DropdownMenuContentProps) {
  return (
    <Menu.Portal>
      <Menu.Positioner side={side} sideOffset={sideOffset} align={align}>
        <Menu.Popup
          className={cn(
            "z-50 min-w-[10rem] rounded-lg border border-border bg-surface-elevated",
            "p-1 shadow-[var(--shadow-dialog)] outline-none",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            "data-[starting-style]:scale-95 data-[ending-style]:scale-95",
            "transition-all duration-100",
            className,
          )}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  );
}

interface DropdownMenuItemProps extends ComponentProps<typeof Menu.Item> {
  destructive?: boolean;
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: DropdownMenuItemProps) {
  return (
    <Menu.Item
      className={cn(
        "flex w-full cursor-default select-none items-center gap-2 rounded-md",
        "px-2 py-1.5 text-sm outline-none transition-colors",
        "data-[highlighted]:bg-surface-2 data-[highlighted]:text-foreground",
        "data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        destructive
          ? "text-status-error data-[highlighted]:bg-status-error/10"
          : "text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof Menu.Separator>) {
  return (
    <Menu.Separator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof Menu.GroupLabel>) {
  return (
    <Menu.GroupLabel
      className={cn(
        "px-2 py-1.5 text-label font-[510] text-text-tertiary",
        className,
      )}
      {...props}
    />
  );
}

interface DropdownMenuCheckboxItemProps extends ComponentProps<typeof Menu.CheckboxItem> {}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: DropdownMenuCheckboxItemProps) {
  return (
    <Menu.CheckboxItem
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-2 rounded-md",
        "py-1.5 pl-7 pr-2 text-sm text-foreground outline-none transition-colors",
        "data-[highlighted]:bg-surface-2",
        "data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 inline-flex size-4 items-center justify-center">
        <Menu.CheckboxItemIndicator render={<Check size={14} aria-hidden="true" />} />
      </span>
      {children}
    </Menu.CheckboxItem>
  );
}
