import type {ComponentProps} from "react";
import { Avatar as BaseAvatar } from "@base-ui-components/react/avatar";
import { cn } from "@/shared/lib/utils";

export function Avatar({
  className,
  ...props
}: ComponentProps<typeof BaseAvatar.Root>) {
  return (
    <BaseAvatar.Root
      className={cn(
        "inline-flex size-8 shrink-0 select-none items-center justify-center",
        "overflow-hidden rounded-full bg-surface-2 text-sm font-emphasis text-text-secondary",
        className,
      )}
      {...props}
    />
  );
}

export function AvatarImage({
  className,
  ...props
}: ComponentProps<typeof BaseAvatar.Image>) {
  return (
    <BaseAvatar.Image className={cn("size-full object-cover", className)} {...props} />
  );
}

export function AvatarFallback({
  className,
  ...props
}: ComponentProps<typeof BaseAvatar.Fallback>) {
  return (
    <BaseAvatar.Fallback
      className={cn("size-full inline-flex items-center justify-center", className)}
      {...props}
    />
  );
}
