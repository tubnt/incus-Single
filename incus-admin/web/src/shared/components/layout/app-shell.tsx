import type {ReactNode} from "react";
import type { User } from "@/shared/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { startAdminEventStream } from "@/shared/lib/admin-event-stream";
import { isAdmin } from "@/shared/lib/auth";
import { consumePendingIntent } from "@/shared/lib/pending-intent";
import { cn } from "@/shared/lib/utils";
import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";

/** 用 client width <768px 检测移动端 */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === "undefined" ? false : window.innerWidth < 768,
  );
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

/**
 * A1: AppShell 挂载时检查 sessionStorage 中的 step-up intent。
 *
 * step-up 重认证后页面是新加载的（OIDC 走全页 redirect），React state 全部
 * 丢失。这里只能"通知式"地告诉用户"刚才在 X 操作被中断了，请重新发起一次"。
 * 跨组件树自动 replay mutation 需要复杂 hook 协调（每个 mutation 都得注册
 * listener 才能被其唤醒），收益不抵复杂度，所以这里仅消费 + 通知。
 */
function usePendingIntentNotice() {
  const { t } = useTranslation();

  useEffect(() => {
    const intent = consumePendingIntent();
    if (!intent) return;
    toast.warning(
      t("pendingIntent.interrupted", {
        defaultValue: "你刚才的「{{description}}」操作因二次认证被中断，请重新发起。",
        description: intent.description,
      }),
      { duration: 8000 },
    );
  }, [t]);
}

interface AppShellProps {
  user: User;
  children: ReactNode;
  /** 触发命令面板（M1.D 接好后从外部传入） */
  onOpenCommand?: () => void;
}

/**
 * AppShell —— 标准布局壳：sidebar + header + main content。
 * `/console` 等需要全屏 workspace 模式的路由不应使用 AppShell（C1）。
 */
export function AppShell({ user, children, onOpenCommand }: AppShellProps) {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    // 屏幕从 mobile 切到 desktop 时关闭移动菜单（媒体查询同步）
    if (!isMobile) {
      // eslint-disable-next-line react/set-state-in-effect
      setMobileOpen(false);
    }
  }, [isMobile]);

  usePendingIntentNotice();

  // D2: admin 端全局 ws 订阅 -> 事件驱动 query invalidate（VM 状态等）
  useEffect(() => {
    if (!isAdmin(user)) return;
    return startAdminEventStream(qc);
  }, [qc, user]);

  const toggleSidebar = () => {
    if (isMobile) setMobileOpen((v) => !v);
    else setDesktopCollapsed((v) => !v);
  };

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        isAdmin={isAdmin(user)}
        collapsed={desktopCollapsed}
        mobileOpen={mobileOpen}
        onToggle={toggleSidebar}
        onNavigate={() => setMobileOpen(false)}
      />
      {mobileOpen ? (
        <button
          type="button"
          aria-label="关闭侧边栏"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      ) : null}
      <AppHeader
        email={user.email}
        balance={user.balance}
        actingAs={user.acting_as}
        sidebarCollapsed={desktopCollapsed}
        onMenuClick={toggleSidebar}
        onOpenCommand={onOpenCommand}
      />
      <main
        className={cn(
          "pt-14 transition-all min-h-screen",
          isMobile ? "pl-0" : desktopCollapsed ? "pl-16" : "pl-60",
        )}
      >
        <div className="mx-auto max-w-7xl px-4 md:px-6 py-4 md:py-6">{children}</div>
      </main>
    </div>
  );
}

/** WorkspaceShell —— 全屏模式（C1 console / 未来 wizard 等占据全视口的页面） */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {children}
    </div>
  );
}
