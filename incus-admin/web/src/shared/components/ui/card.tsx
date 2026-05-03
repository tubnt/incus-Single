import type { HTMLAttributes, Ref } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * Card —— DESIGN.md §4 "Cards & Containers"。
 * 透明白叠加 + 半透明边框 + 8px 半径（标准）/ 12px（featured）。
 */
type DivProps = HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> };

export function Card({ className, ref, ...props }: DivProps) {
  return (
    <div
      ref={ref}
      className={cn(
        // DESIGN.md §4 Cards & Containers + §6 Depth Ring (L3):
        //   bg = surface-3 (rgba 0.05) 半透明叠加（never solid — Linear 模型）
        //   border = standard 0.08 半透明白
        //   shadow = ring L3 (0,0,0,0.2 inset 1px) 增强边界，避免卡片边界
        //   在近黑底上"塌陷"
        "rounded-lg border border-border bg-surface-3 text-card-foreground",
        "shadow-ring",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ref, ...props }: DivProps) {
  return <div ref={ref} className={cn("flex flex-col gap-1.5 p-4", className)} {...props} />;
}

export function CardTitle({ className, ref, ...props }: DivProps) {
  return (
    <div
      ref={ref}
      // OPS-035: 内页卡片标题对齐 Stripe/GitHub/Vercel 14-16px 段；
      // 大字号需要时调用方传 text-h2/text-h3 className 覆盖。
      className={cn("text-base font-emphasis text-foreground", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ref, ...props }: DivProps) {
  return (
    <div
      ref={ref}
      className={cn("text-caption text-text-tertiary", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ref, ...props }: DivProps) {
  return <div ref={ref} className={cn("p-4 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ref, ...props }: DivProps) {
  return (
    <div
      ref={ref}
      className={cn("flex items-center gap-2 p-4 pt-0", className)}
      {...props}
    />
  );
}
