import type {VariantProps} from "class-variance-authority";
import type {HTMLAttributes} from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/shared/lib/utils";

/**
 * Badge —— DESIGN.md §4 Badges & Pills。
 * neutral 是默认（pill 形 + 边框），其余按状态语义。
 */
const badgeVariants = cva(
  cn(
    "inline-flex items-center gap-1 rounded-pill border",
    "text-label font-emphasis tracking-tight whitespace-nowrap",
    "px-2.5 py-0.5",
  ),
  {
    variants: {
      variant: {
        neutral: "bg-transparent text-text-secondary border-[color:var(--border-primary)]",
        subtle: "bg-surface-3 text-foreground border-[color:var(--border-subtle)] rounded-micro",
        success: "bg-transparent text-status-success border-status-success/40",
        error: "bg-transparent text-status-error border-status-error/40",
        warning: "bg-transparent text-status-warning border-status-warning/40",
        pending: "bg-transparent text-status-pending border-status-pending/40",
        primary: "bg-primary/15 text-primary border-primary/30",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}
