import { useQuery } from "@tanstack/react-query";
import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Toaster } from "sonner";
import { CommandPalette } from "@/shared/components/command-palette/command-palette";
import { useGoToNavigation } from "@/shared/components/command-palette/use-go-to-navigation";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { AppShell, WorkspaceShell } from "@/shared/components/layout/app-shell";
import { buttonVariants } from "@/shared/components/ui/button";
import { fetchCurrentUser, isAdmin } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/utils";

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});

/** 全屏 workspace 模式的路由前缀（C1）。命中后不嵌入 AppShell。 */
const WORKSPACE_PATHS = ["/console"];

function isWorkspacePath(pathname: string): boolean {
  return WORKSPACE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <div className="text-display font-[510] text-text-tertiary">404</div>
      <p className="text-muted-foreground">页面不存在</p>
      <a href="/" className={cn(buttonVariants({ variant: "primary" }))}>回到首页</a>
    </div>
  );
}

function RootLayout() {
  const { t } = useTranslation();
  const router = useRouterState();
  const isWorkspace = isWorkspacePath(router.location.pathname);
  const [commandOpen, setCommandOpen] = useState(false);

  const { data: user, isLoading, isError } = useQuery({
    queryKey: ["currentUser"],
    queryFn: fetchCurrentUser,
    retry: false,
  });

  // Linear 风 g 序列导航：g h / g v / g M ...
  useGoToNavigation({ isAdmin: !!user && isAdmin(user) });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  if (isError || !user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <h1 className="text-h1 font-[510]">IncusAdmin</h1>
        <p className="text-muted-foreground">请登录以继续</p>
        <a
          href="/oauth2/start?rd=/"
          className={cn(buttonVariants({ variant: "primary", size: "lg" }))}
        >
          {t("common.signIn")}
        </a>
      </div>
    );
  }

  return (
    <>
      <Toaster
        position="top-right"
        richColors
        closeButton
        theme="system"
        toastOptions={{
          classNames: {
            toast: "border border-border bg-surface-elevated text-foreground shadow-[var(--shadow-dialog)]",
          },
        }}
      />
      {isWorkspace ? (
        <WorkspaceShell>
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </WorkspaceShell>
      ) : (
        <AppShell user={user} onOpenCommand={() => setCommandOpen(true)}>
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </AppShell>
      )}
      {/* 命令面板：workspace mode 也注册（C2 在 /console 内部禁用全局热键，按钮触发仍可） */}
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} user={user} />
    </>
  );
}
