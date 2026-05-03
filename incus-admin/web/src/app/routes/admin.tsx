import type { User } from "@/shared/lib/auth";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { fetchCurrentUser, isAdmin } from "@/shared/lib/auth";
import { queryClient } from "@/shared/lib/query-client";

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ location }) => {
    let user: User | null = null;
    try {
      const cached = queryClient.getQueryData<User>(["currentUser"]);
      user = cached ?? await queryClient.fetchQuery({
        queryKey: ["currentUser"],
        queryFn: fetchCurrentUser,
      });
    } catch {
      // fetch 失败（401 / network）—— 不当 admin 拦截
      throw redirect({ to: "/" });
    }
    if (!user || !isAdmin(user)) {
      throw redirect({ to: "/" });
    }
    // /admin 本身没有 index 页面 —— 默认进监控总览，保留所有子路由的 deep-link。
    if (location.pathname === "/admin" || location.pathname === "/admin/") {
      throw redirect({ to: "/admin/monitoring" });
    }
  },
  component: () => <Outlet />,
  notFoundComponent: () => (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="text-display font-emphasis text-muted-foreground">404</div>
      <p className="text-muted-foreground">Admin page not found</p>
      <a
        href="/admin/clusters"
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-emphasis hover:opacity-90"
      >
        Back to Clusters
      </a>
    </div>
  ),
});
