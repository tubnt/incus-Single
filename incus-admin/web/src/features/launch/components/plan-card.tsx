import type { Product } from "@/features/products/api";
import { CheckCircle2, Cpu, HardDrive, MemoryStick } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn, formatCurrency } from "@/shared/lib/utils";

/** 套餐卡片 —— `/launch` 第 ① 段；选中态用 primary border + accent check 角标。 */
export function PlanCard({
  product,
  active,
  onSelect,
}: {
  product: Product;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      data-testid={`plan-${product.slug}`}
      className={cn(
        "relative flex flex-col gap-2 p-3 rounded-lg border-2 text-left transition-colors",
        active
          ? "border-primary bg-primary/15 shadow-sm"
          : "border-border bg-surface-1 hover:bg-surface-2",
      )}
    >
      {active ? (
        <CheckCircle2
          size={14}
          aria-hidden="true"
          className="absolute top-2 right-2 text-accent"
        />
      ) : null}
      <div className="font-strong text-body text-foreground">{product.name}</div>
      <div className="flex flex-col gap-0.5 font-mono tabular-nums text-caption text-text-secondary">
        <SpecLine icon={<Cpu size={12} aria-hidden="true" />} value={`${product.cpu} vCPU`} />
        <SpecLine
          icon={<MemoryStick size={12} aria-hidden="true" />}
          value={`${(product.memory_mb / 1024).toFixed(0)} GB`}
        />
        <SpecLine
          icon={<HardDrive size={12} aria-hidden="true" />}
          value={`${product.disk_gb} GB SSD`}
        />
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-body-emphasis font-strong text-foreground tabular-nums">
          {formatCurrency(product.price_monthly, product.currency)}
        </span>
        <span className="text-caption text-text-tertiary">
          {t("billing.perMonth", { defaultValue: "/ 月" })}
        </span>
      </div>
    </button>
  );
}

function SpecLine({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-text-tertiary">{icon}</span>
      <span>{value}</span>
    </div>
  );
}

/** 加载中的占位骨架 —— 复用 PlanCard 网格布局。 */
export function PlanSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          // skeleton 占位无业务 id
          key={i /* eslint-disable-line react/no-array-index-key */}
          aria-hidden="true"
          className="h-32 rounded-lg border border-border bg-surface-1 animate-pulse"
        />
      ))}
    </div>
  );
}

/** 后端无 active 套餐时的提示 box。 */
export function EmptyPlanHint() {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-border bg-surface-1 p-4 text-caption text-text-tertiary">
      {t("launch.noPlans", {
        defaultValue: "目前没有可购买的套餐，请联系管理员。",
      })}
    </div>
  );
}
