import type { User } from "@/shared/lib/auth";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { fetchCurrentUser, isAdmin } from "@/shared/lib/auth";
import { queryClient } from "@/shared/lib/query-client";

export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    try {
      const cached = queryClient.getQueryData<User>(["currentUser"]);
      const user = cached ?? await queryClient.fetchQuery({
        queryKey: ["currentUser"],
        queryFn: fetchCurrentUser,
      });
      if (!user || !isAdmin(user)) {
        throw redirect({ to: "/" });
      }
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
      throw redirect({ to: "/" });
    }
  },
  component: () => <Outlet />,
  notFoundComponent: () => (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="text-6xl font-bold text-muted-foreground">404</div>
      <p className="text-muted-foreground">Admin page not found</p>
      <a
        href="/admin/clusters"
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
      >
        Back to Clusters
      </a>
    </div>
  ),
});
