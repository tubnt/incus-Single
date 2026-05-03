import type {ReactNode} from "react";
import { cn } from "@/shared/lib/utils";

/**
 * MobileBottomBar —— G5 移动端底部固定操作栏。
 * <md 显示，长表单 / 详情页主操作放这里，避免滚到底再去找按钮。
 */
export function MobileBottomBar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 md:hidden",
        "flex items-center gap-2 border-t border-border bg-surface-elevated",
        "px-4 py-3 shadow-bottom-bar",
        // safe-area for iOS
        "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        className,
      )}
    >
      {children}
    </div>
  );
}
