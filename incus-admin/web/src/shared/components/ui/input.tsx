import type {InputHTMLAttributes, TextareaHTMLAttributes} from "react";
import { forwardRef } from "react";
import { cn } from "@/shared/lib/utils";

/** Input —— DESIGN.md §4 "Text Area"，应用于 text/email/password/number/url 等。 */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-border bg-surface-1",
        "px-3 py-1.5 text-sm text-foreground",
        "placeholder:text-text-tertiary",
        "transition-colors",
        "focus:outline-none focus:border-[color:var(--accent)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "file:border-0 file:bg-transparent file:text-sm file:font-emphasis file:text-foreground",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-border bg-surface-1",
        "px-3 py-2 text-sm text-foreground",
        "placeholder:text-text-tertiary",
        "transition-colors",
        "focus:outline-none focus:border-[color:var(--accent)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
