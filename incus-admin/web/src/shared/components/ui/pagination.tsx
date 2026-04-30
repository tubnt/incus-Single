import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";

export interface PaginationProps {
  total: number;
  limit: number;
  offset: number;
  onChange: (limit: number, offset: number) => void;
  className?: string;
  pageSizeOptions?: number[];
}

/** Pagination —— 用 DESIGN.md token；保留旧 API 不影响调用方。 */
export function Pagination({
  total,
  limit,
  offset,
  onChange,
  className,
  pageSizeOptions = [20, 50, 100],
}: PaginationProps) {
  const { t } = useTranslation();
  const pageSize = limit > 0 ? limit : 50;
  const currentPage = Math.floor(offset / pageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(total, offset + pageSize);
  const disabledPrev = offset <= 0;
  const disabledNext = offset + pageSize >= total;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 text-caption",
        className,
      )}
    >
      <span className="text-muted-foreground">
        {t("pagination.range", {
          defaultValue: "{{from}}-{{to}} / {{total}}",
          from,
          to,
          total,
        })}
      </span>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-muted-foreground">
          {t("pagination.pageSize", { defaultValue: "每页" })}
          <select
            value={pageSize}
            onChange={(e) => onChange(Number(e.target.value), 0)}
            className={cn(
              "h-7 rounded-md border border-border bg-surface-1 px-1.5",
              "text-foreground focus:outline-none focus:border-[color:var(--accent)]",
            )}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-label={t("pagination.prev", { defaultValue: "上一页" })}
          onClick={() => onChange(pageSize, Math.max(0, offset - pageSize))}
          disabled={disabledPrev}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md",
            "border border-border bg-surface-1 text-foreground",
            "hover:bg-surface-2 transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        <span className="text-muted-foreground tabular-nums">
          {t("pagination.pageOf", {
            defaultValue: "{{page}}/{{total}}",
            page: currentPage,
            total: totalPages,
          })}
        </span>
        <button
          type="button"
          aria-label={t("pagination.next", { defaultValue: "下一页" })}
          onClick={() => onChange(pageSize, offset + pageSize)}
          disabled={disabledNext}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md",
            "border border-border bg-surface-1 text-foreground",
            "hover:bg-surface-2 transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
