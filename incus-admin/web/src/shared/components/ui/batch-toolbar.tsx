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
 * BatchToolbar —— 多选浮层操作栏（Linear 风 floating action bar，PLAN-024.A）。
 * 调用方控制选中状态（rowSelection），把动作按钮作为 children。
 *
 * 视觉：fixed 视口底部居中、半透明 + backdrop-blur、圆角 xl、shadow-floating。
 * 进入：从底部 8px slide-up + fade（Linear 同款）。
 *
 * 与 DataTable 的 toolbar slot 配合：
 *   <DataTable toolbar={
 *     <BatchToolbar count={selectedIds.length} onClear={clear}>
 *       <Button onClick={runDelete}>删除选中</Button>
 *     </BatchToolbar>
 *   } />
 *
 * DataTable 仍把 toolbar 渲染在表上方占位高度为 0（return null 不占行高）；
 * 浮层走 fixed positioning，故不影响表格 layout。
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
        // 浮层位置：fixed 居中底部
        "fixed left-1/2 -translate-x-1/2 bottom-6 z-30",
        "flex flex-wrap items-center gap-2",
        // Linear 浮层视觉：xl 圆角 + 半透明 elevated + 模糊背景 + 浮层阴影
        "rounded-xl border border-border bg-surface-elevated/95 backdrop-blur-md",
        "shadow-[var(--shadow-floating)] px-3 py-2",
        // 进入动画
        "animate-in fade-in slide-in-from-bottom-2 duration-150",
        // 在小屏上略缩窄两侧 padding，并让按钮组允许换行
        "max-w-[calc(100vw-2rem)]",
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
      <div className="ml-2 flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}
