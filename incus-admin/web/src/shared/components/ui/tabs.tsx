import type {ComponentProps} from "react";
import { Tabs as BaseTabs } from "@base-ui-components/react/tabs";
import { cn } from "@/shared/lib/utils";

export const Tabs = BaseTabs.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      className={cn(
        "relative flex items-center gap-1 border-b border-border",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      className={cn(
        "relative -mb-px inline-flex items-center gap-2 px-3 py-2",
        "text-sm font-emphasis text-muted-foreground",
        "border-b-2 border-transparent transition-colors",
        "hover:text-foreground",
        "data-[selected]:text-foreground data-[selected]:border-[color:var(--accent)]",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof BaseTabs.Panel>) {
  return <BaseTabs.Panel className={cn("py-4", className)} {...props} />;
}
