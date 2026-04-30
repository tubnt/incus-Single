import type {HTMLAttributes} from "react";
import { forwardRef } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * Card —— DESIGN.md §4 "Cards & Containers"。
 * 透明白叠加 + 半透明边框 + 8px 半径（标准）/ 12px（featured）。
 */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        // DESIGN.md §4 Cards & Containers + §6 Depth Ring (L3):
        //   bg = surface-3 (rgba 0.05) 半透明叠加（never solid — Linear 模型）
        //   border = standard 0.08 半透明白
        //   shadow = ring L3 (0,0,0,0.2 inset 1px) 增强边界，避免卡片边界
        //   在近黑底上"塌陷"
        "rounded-lg border border-border bg-surface-3 text-card-foreground",
        "shadow-[var(--shadow-ring)]",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1.5 p-5", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

export const CardTitle = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "text-h3 font-[590] text-foreground",
        className,
      )}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

export const CardDescription = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("text-small text-muted-foreground", className)}
      {...props}
    />
  ),
);
CardDescription.displayName = "CardDescription";

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center gap-2 p-5 pt-0", className)}
      {...props}
    />
  ),
);
CardFooter.displayName = "CardFooter";
