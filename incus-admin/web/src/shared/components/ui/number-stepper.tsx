import { Minus, Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/**
 * NumberStepper —— 数量类输入的 −/+ stepper + 可选快捷预设 chip。
 *
 * 用例：批量数量、磁盘大小、副本数。比裸 <input type="number"> 更明确，
 * 也避免触屏小键盘弹出。值会被 clamp 到 [min, max] 区间。
 */
interface NumberStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  presets?: number[];
  ariaLabel?: string;
  className?: string;
}

export function NumberStepper({
  value,
  onChange,
  min = 1,
  max = 999,
  step = 1,
  presets,
  ariaLabel,
  className,
}: NumberStepperProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const decDisabled = value <= min;
  const incDisabled = value >= max;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div
        role="group"
        aria-label={ariaLabel}
        className={cn(
          "inline-flex items-center rounded-md border border-border bg-surface-1",
          "h-9 overflow-hidden",
        )}
      >
        <button
          type="button"
          aria-label="decrease"
          disabled={decDisabled}
          onClick={() => onChange(clamp(value - step))}
          className={cn(
            "inline-flex items-center justify-center size-9",
            "text-text-secondary hover:bg-surface-2 transition-colors",
            "disabled:opacity-50 disabled:pointer-events-none",
            "border-r border-border",
          )}
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={ariaLabel}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            onChange(Number.isNaN(n) ? min : clamp(n));
          }}
          className={cn(
            "h-9 w-14 bg-transparent text-center text-sm font-emphasis tabular-nums",
            "text-foreground outline-none no-spinner",
          )}
        />
        <button
          type="button"
          aria-label="increase"
          disabled={incDisabled}
          onClick={() => onChange(clamp(value + step))}
          className={cn(
            "inline-flex items-center justify-center size-9",
            "text-text-secondary hover:bg-surface-2 transition-colors",
            "disabled:opacity-50 disabled:pointer-events-none",
            "border-l border-border",
          )}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>

      {presets && presets.length > 0 ? (
        <div className="inline-flex items-center gap-1">
          {presets.map((p) => {
            const active = p === value;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onChange(clamp(p))}
                aria-pressed={active}
                className={cn(
                  "h-7 min-w-9 rounded-pill px-2.5 text-caption font-emphasis tabular-nums",
                  "border transition-colors",
                  active
                    ? "border-primary bg-primary/15 text-foreground"
                    : "border-border bg-surface-1 text-text-tertiary hover:bg-surface-2",
                )}
              >
                {p}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
