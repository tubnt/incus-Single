import type {ReactNode} from "react";
import { Check } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/**
 * Stepper —— C3 多步流程指示。
 * 用于 NodeJoinWizard、（如有需要的）多步表单。
 *
 * 用法：
 *   <Stepper current="ssh-test" steps={[
 *     { value: "prepare",  label: "准备" },
 *     { value: "ssh-test", label: "SSH 测试" },
 *     { value: "join",     label: "加入" },
 *     { value: "verify",   label: "验证" },
 *   ]} onChange={setStep} />
 */
export interface StepperItem {
  value: string;
  label: ReactNode;
  description?: ReactNode;
}

interface StepperProps {
  steps: StepperItem[];
  current: string;
  onChange?: (value: string) => void;
  /** 已完成的 step value 数组（含 current 之前的，便于显示 √） */
  completed?: string[];
  className?: string;
}

export function Stepper({
  steps,
  current,
  onChange,
  completed,
  className,
}: StepperProps) {
  const currentIdx = steps.findIndex((s) => s.value === current);
  const computedCompleted =
    completed ?? steps.slice(0, Math.max(0, currentIdx)).map((s) => s.value);

  return (
    <ol
      className={cn("flex items-center gap-2", className)}
      aria-label="进度"
    >
      {steps.map((step, idx) => {
        const isActive = step.value === current;
        const isDone = computedCompleted.includes(step.value);
        const interactive = !!onChange && (isDone || isActive);
        return (
          <li key={step.value} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              disabled={!interactive}
              onClick={() => interactive && onChange?.(step.value)}
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "group inline-flex items-center gap-2 rounded-md px-2 py-1.5",
                "text-sm transition-colors",
                interactive ? "cursor-pointer hover:bg-surface-2" : "cursor-default",
                isActive ? "text-foreground font-[510]" : "text-text-tertiary",
              )}
            >
              <span
                className={cn(
                  "inline-flex size-6 items-center justify-center rounded-full",
                  "text-label font-[510] shrink-0",
                  isDone && "bg-status-success text-text-primary",
                  isActive && !isDone && "bg-primary text-primary-foreground",
                  !isActive && !isDone && "border border-border bg-surface-1 text-text-tertiary",
                )}
              >
                {isDone ? <Check size={12} aria-hidden="true" /> : idx + 1}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </button>
            {idx < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="hidden flex-1 h-px bg-border sm:inline-block"
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
