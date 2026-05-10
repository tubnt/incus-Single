import { useQuery } from "@tanstack/react-query";
import { createRootRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCommandActions } from "@/shared/components/command-palette/use-command-actions";
import { useGoToNavigation } from "@/shared/components/command-palette/use-go-to-navigation";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { AppShell, WorkspaceShell } from "@/shared/components/layout/app-shell";
import { buttonVariants } from "@/shared/components/ui/button";
import { fetchCurrentUser, isAdmin } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/utils";

// Session-3 🔴-3 / PLAN-051 §2-J：CommandPalette 与 Sonner Toaster 都在 root
// layout 常驻 → 进 entry chunk。两者都是用户交互后才需要：⌘K 触发 / 第一次
// toast 触发。lazy + Suspense 让首屏少 ~50KB（cmdk + 27 lucide icons + base-ui
// Dialog）。
const CommandPalette = lazy(() =>
  import("@/shared/components/command-palette/command-palette").then((m) => ({
    default: m.CommandPalette,
  })),
);
const Toaster = lazy(() =>
  import("sonner").then((m) => ({ default: m.Toaster })),
);

// QA-009 N-03 / PLAN-051 §2-I 决策 D-25 = C：root layer 加 errorComponent，
// route loader / action 抛错时显示 fallback 而非白屏。子路由不下沉（覆盖 80%）。
function RouterError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <div className="text-display font-emphasis text-status-error">!</div>
      <p className="text-h2 font-emphasis">页面加载失败</p>
      <pre className="max-w-prose whitespace-pre-wrap text-caption text-text-tertiary">
        {error?.message ?? "未知错误"}
      </pre>
      <button
        type="button"
        onClick={reset}
        className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-emphasis hover:opacity-90"
      >
        重试
      </button>
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RouterError,
});

/** 全屏 workspace 模式的路由前缀（C1）。命中后不嵌入 AppShell。 */
const WORKSPACE_PATHS = ["/console"];

function isWorkspacePath(pathname: string): boolean {
  return WORKSPACE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <div className="text-display font-emphasis text-text-tertiary">404</div>
      <p className="text-muted-foreground">{t("error.notFound", { defaultValue: "页面不存在" })}</p>
      <a href="/" className={cn(buttonVariants({ variant: "primary" }))}>
        {t("error.goHome", { defaultValue: "回到首页" })}
      </a>
    </div>
  );
}

function RootLayout() {
  const { t } = useTranslation();
  const router = useRouterState();
  const navigate = useNavigate();
  const isWorkspace = isWorkspacePath(router.location.pathname);
  const [commandOpen, setCommandOpen] = useState(false);

  const { data: user, isLoading, isError } = useQuery({
    queryKey: ["currentUser"],
    queryFn: fetchCurrentUser,
    retry: false,
  });

  // Linear 风 g 序列导航：g h / g v / g M ...
  useGoToNavigation({ isAdmin: !!user && isAdmin(user) });

  // PLAN-034 P2-B：全局 quick actions（无论当前页都可在 ⌘K / `/` 下访问）。
  // - "新建 VM"：所有用户
  // - "添加节点 / 给用户充值"：仅 admin
  // 单页 useCommandActions 注册的动作仍然 deduped（key 不冲突即并存）。
  const adminUser = !!user && isAdmin(user);
  const globalActions = useMemo(
    () => [
      {
        id: "global.create-vm",
        title: t("vm.createVm", { defaultValue: "新建 VM" }),
        icon: "Plus",
        keywords: ["new", "create", "launch", "vm", "新建"],
        perform: () => navigate({ to: "/launch" }),
      },
      ...(adminUser
        ? [
            {
              id: "global.add-node",
              title: t("admin.nodes.add.cta", { defaultValue: "添加节点（管理员）" }),
              icon: "Server",
              keywords: ["add", "node", "join", "添加节点"],
              perform: () => navigate({ to: "/admin/node-join" }),
            },
            {
              id: "global.users-page",
              title: t("admin.users.title", { defaultValue: "用户管理 / 充值" }),
              icon: "Users",
              keywords: ["topup", "balance", "user", "充值"],
              perform: () => navigate({ to: "/admin/users" }),
            },
            {
              id: "global.orders-page",
              title: t("admin.orders.title", { defaultValue: "订单审批" }),
              icon: "ShoppingCart",
              keywords: ["order", "approve", "审批"],
              perform: () => navigate({ to: "/admin/orders" }),
            },
          ]
        : []),
    ],
    [navigate, t, adminUser],
  );
  useCommandActions(() => globalActions, [globalActions]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  if (isError || !user) {
    // 携带当前路径（含 search）作为 oauth2-proxy 登录后回跳目标，保留 deep link。
    const currentPath =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "/";
    const rd = encodeURIComponent(currentPath || "/");
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <h1 className="text-h1 font-emphasis">IncusAdmin</h1>
        <p className="text-muted-foreground">
          {t("error.signInRequired", { defaultValue: "请登录以继续" })}
        </p>
        <a
          href={`/oauth2/start?rd=${rd}`}
          className={cn(buttonVariants({ variant: "primary", size: "lg" }))}
        >
          {t("common.signIn")}
        </a>
      </div>
    );
  }

  return (
    <>
      <Suspense fallback={null}>
        <Toaster
          position="top-right"
          richColors
          closeButton
          theme="system"
          toastOptions={{
            classNames: {
              toast: "border border-border bg-surface-elevated text-foreground shadow-dialog",
            },
          }}
        />
      </Suspense>
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
      {commandOpen && (
        <Suspense fallback={null}>
          <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} user={user} />
        </Suspense>
      )}
    </>
  );
}
