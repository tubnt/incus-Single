import type {ReactNode} from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";
import { cn } from "@/shared/lib/utils";

interface BatchToolbarProps {
  /** 选中数量；为 0 时整体隐藏 */
  count: number;
  onClear: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * BatchToolbar —— 多选 + sticky 顶部操作栏（DataTable 模式手册第 2 节）。
 * 调用方控制选中状态（rowSelection），把动作按钮作为 children。
 *
 * 与 DataTable 的 toolbar slot 配合使用：
 *   <DataTable toolbar={
 *     <BatchToolbar count={selectedIds.length} onClear={clear}>
 *       <Button onClick={runDelete}>删除选中</Button>
 *     </BatchToolbar>
 *   } />
 */
export function BatchToolbar({
  count,
  onClear,
  children,
  className,
}: BatchToolbarProps) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={t("batchToolbar.selected", {
        defaultValue: "已选 {{count}} 项",
        count,
      })}
      className={cn(
        "sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md",
        "border border-border bg-surface-elevated px-3 py-2",
        "shadow-[var(--shadow-elevated)]",
        className,
      )}
    >
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("batchToolbar.clear", { defaultValue: "取消选择" })}
        onClick={onClear}
      >
        <X size={14} aria-hidden="true" />
      </Button>
      <span className="text-sm font-[510] text-foreground">
        {t("batchToolbar.selected", {
          defaultValue: "已选 {{count}} 项",
          count,
        })}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}
