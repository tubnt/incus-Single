import type {ReactNode} from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { cn } from "@/shared/lib/utils";

export interface BreadcrumbItemData {
  label: ReactNode;
  to?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItemData[];
  className?: string;
}

/**
 * Breadcrumb —— PageHeader 上方面包屑。
 * 最后一项是当前页（无链接），前面的支持点击跳转。
 */
export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "flex items-center gap-1 text-caption text-text-tertiary",
        className,
      )}
    >
      {items.map((item, idx) => {
        const last = idx === items.length - 1;
        return (
          <Fragment key={idx}>
            {item.to && !last ? (
              <Link
                to={item.to as any}
                className="hover:text-foreground transition-colors"
              >
                {item.label}
              </Link>
            ) : (
              <span className={cn(last && "text-foreground font-[510]")}>
                {item.label}
              </span>
            )}
            {!last && (
              <ChevronRight size={12} aria-hidden="true" className="text-text-quaternary" />
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
