import type {VariantProps} from "class-variance-authority";
import type {ButtonHTMLAttributes} from "react";
import { cva } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * Button —— Linear 风按钮（DESIGN.md §4 Buttons）。
 * 5 种 variant + 4 种 size。primitive 内部用语义 token，不允许调用方传 hex。
 */
const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md",
    "text-sm font-[510] transition-colors",
    "focus-visible:outline-none disabled:opacity-50 disabled:pointer-events-none",
    // svg 图标默认尺寸
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ),
  {
    variants: {
      variant: {
        // 主品牌（CTA），DESIGN.md Brand Indigo
        primary: "bg-primary text-primary-foreground hover:bg-[color:var(--accent-hover)]",
        // ghost：默认按钮（DESIGN.md "Ghost Button"）
        ghost:
          "bg-surface-1 text-foreground border border-border hover:bg-surface-2",
        // subtle：toolbar 类
        subtle:
          "bg-surface-2 text-text-secondary hover:bg-surface-3",
        // outline：仅边框，无填充
        outline:
          "bg-transparent text-foreground border border-border hover:bg-surface-1",
        // destructive：红色，警告动作
        destructive:
          "bg-warning-strong text-warning-strong-foreground hover:opacity-90",
        // link：纯文字链接
        link: "bg-transparent text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3",
        lg: "h-10 px-4 text-[15px]",
        icon: "size-8",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
