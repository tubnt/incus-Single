import type {ComponentProps, ReactNode} from "react";
import { Command as CmdkRoot } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/**
 * Command —— 基于 cmdk 的列表式命令面板 primitive。
 * 仅样式封装；行为/键盘交互完全由 cmdk 提供（Linear/Raycast 同款）。
 */

export const Command = ({
  className,
  ...props
}: ComponentProps<typeof CmdkRoot>) => (
  <CmdkRoot
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-lg bg-surface-elevated text-foreground",
      className,
    )}
    {...props}
  />
);

export function CommandInput({
  className,
  ...props
}: ComponentProps<typeof CmdkRoot.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3" data-cmdk-input-wrapper="">
      <Search size={16} className="shrink-0 text-text-tertiary" aria-hidden="true" />
      <CmdkRoot.Input
        className={cn(
          "flex h-11 w-full bg-transparent py-3 text-sm",
          "text-foreground placeholder:text-text-tertiary",
          "outline-none disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({
  className,
  ...props
}: ComponentProps<typeof CmdkRoot.List>) {
  return (
    <CmdkRoot.List
      className={cn("max-h-palette overflow-y-auto overflow-x-hidden p-1", className)}
      {...props}
    />
  );
}

export function CommandEmpty(props: ComponentProps<typeof CmdkRoot.Empty>) {
  return (
    <CmdkRoot.Empty
      className="py-8 text-center text-sm text-muted-foreground"
      {...props}
    />
  );
}

export function CommandGroup({
  className,
  heading,
  ...props
}: ComponentProps<typeof CmdkRoot.Group> & { heading?: ReactNode }) {
  return (
    <CmdkRoot.Group
      // OPS-038: cmdk 的 heading 类型是 string，但我们包装层接受 ReactNode。
       
      heading={heading as any}
      className={cn(
        "overflow-hidden p-1 text-foreground",
        "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5",
        "[&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:font-emphasis",
        "[&_[cmdk-group-heading]]:text-text-tertiary",
        className,
      )}
      {...props}
    />
  );
}

export function CommandItem({
  className,
  ...props
}: ComponentProps<typeof CmdkRoot.Item>) {
  return (
    <CmdkRoot.Item
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-md",
        "px-2 py-1.5 text-sm outline-none",
        "data-[selected=true]:bg-surface-2 data-[selected=true]:text-foreground",
        "data-[disabled=true]:opacity-50 data-[disabled=true]:pointer-events-none",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-text-tertiary",
        "data-[selected=true]:[&_svg]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CommandSeparator({
  className,
  ...props
}: ComponentProps<typeof CmdkRoot.Separator>) {
  return (
    <CmdkRoot.Separator
      className={cn("-mx-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export function CommandShortcut({
  className,
  ...props
}: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "ml-auto inline-flex items-center gap-0.5 text-label font-mono text-text-tertiary",
        className,
      )}
      {...props}
    />
  );
}
