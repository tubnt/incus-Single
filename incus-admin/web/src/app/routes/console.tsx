import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConsoleTerminal } from "@/features/console/terminal";
import { useTheme } from "@/shared/components/theme-provider";
import { Button, buttonVariants } from "@/shared/components/ui/button";
import { fetchCurrentUser, isAdmin } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/utils";

/**
 * /console — workspace fullscreen mode (C1)。
 * `__root.tsx` 通过 `WORKSPACE_PATHS` 把这条路由从 AppShell 中剥离，本组件接管整屏。
 */
export const Route = createFileRoute("/console")({
  validateSearch: (search: Record<string, unknown>) => ({
    vm: (search.vm as string) || "",
    project: (search.project as string) || "customers",
    cluster: (search.cluster as string) || "",
    from: (search.from as string) || "",
  }),
  component: ConsolePage,
});

function ConsolePage() {
  const { t } = useTranslation();
  const { vm, project, cluster, from } = Route.useSearch();
  const { data: user } = useQuery({ queryKey: ["currentUser"], queryFn: fetchCurrentUser });
  const { resolvedTheme } = useTheme();
  const [fullscreen, setFullscreen] = useState(false);

  // ESC 退出 fullscreen（fullscreen 模式独立于浏览器 fullscreen）
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fullscreen]);

  const backUrl =
    from === "admin"
      ? "/admin/vms"
      : from === "portal"
        ? "/vms"
        : user && isAdmin(user)
          ? "/admin/vms"
          : "/vms";

  if (!vm || !cluster) {
    const missing: string[] = [];
    if (!vm) missing.push("vm");
    if (!cluster) missing.push("cluster");
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6">
        <div className="text-h3 font-strong text-foreground">参数缺失</div>
        <div className="text-text-tertiary text-sm">
          缺少: <span className="font-mono">{missing.join(", ")}</span>
        </div>
        <div className="text-caption text-text-tertiary font-mono">
          /console?vm=NAME&amp;cluster=CLUSTER&amp;project=PROJECT
        </div>
        <Link
          to={backUrl as any}
          className={cn(buttonVariants({ variant: "primary" }))}
        >
          <ArrowLeft size={14} aria-hidden="true" />
          返回 VM 列表
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-surface-marketing">
      {/* 顶部浮动控件条 */}
      <div
        className={cn(
          "flex items-center gap-2 px-4 h-12 border-b border-border bg-surface-panel shrink-0",
          fullscreen && "absolute inset-x-0 top-0 z-40 bg-surface-panel/90 backdrop-blur-sm",
        )}
      >
        <Link
          to={backUrl as any}
          aria-label={t("console.back", { defaultValue: "Back" })}
          className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm font-emphasis text-text-secondary hover:bg-surface-2 hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          <span className="hidden sm:inline">{t("console.back", { defaultValue: "Back" })}</span>
        </Link>
        <div className="flex-1 min-w-0 truncate text-center sm:text-left">
          <span className="font-mono font-emphasis text-foreground">{vm}</span>
          <span className="ml-2 text-caption text-text-tertiary hidden md:inline">
            {cluster} / {project}
          </span>
        </div>
        <Button
          variant="subtle"
          size="icon-sm"
          aria-label={fullscreen ? t("console.exitFullscreen", { defaultValue: "Exit fullscreen" }) : t("console.fullscreen", { defaultValue: "Fullscreen" })}
          onClick={() => setFullscreen((v) => !v)}
        >
          {fullscreen ? (
            <Minimize2 size={14} aria-hidden="true" />
          ) : (
            <Maximize2 size={14} aria-hidden="true" />
          )}
        </Button>
      </div>

      <main className={cn("flex-1 p-3", fullscreen && "p-0")}>
        <ConsoleTerminal
          vmName={vm}
          project={project}
          cluster={cluster}
          themeKey={resolvedTheme}
          className={cn(
            "w-full h-full overflow-hidden",
            !fullscreen && "rounded-lg border border-border bg-xterm-bg",
            fullscreen && "bg-xterm-bg",
          )}
        />
      </main>
    </div>
  );
}
