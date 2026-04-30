import type { ShadowActingAs } from "@/shared/lib/auth";
import {
  Globe,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  Sun,
  UserX,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/shared/components/theme-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";

interface AppHeaderProps {
  email?: string;
  balance?: number;
  /** Shadow Login 模式：用户名 + 顶部红条 + 退出按钮 */
  actingAs?: ShadowActingAs;
  sidebarCollapsed: boolean;
  onMenuClick?: () => void;
  /** 触发命令面板。M1.D 接好后 AppShell 提供 */
  onOpenCommand?: () => void;
}

export function AppHeader({
  email,
  balance,
  actingAs,
  sidebarCollapsed,
  onMenuClick,
  onOpenCommand,
}: AppHeaderProps) {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();

  const toggleLang = () => {
    i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh");
  };

  const shadowMode = !!actingAs;

  return (
    <header
      className={cn(
        "fixed top-0 right-0 z-30 h-14 flex items-center gap-2 px-3 transition-all",
        "left-0",
        sidebarCollapsed ? "md:left-16" : "md:left-60",
        "border-b",
        shadowMode
          ? "bg-warning-strong text-warning-strong-foreground border-warning-strong/40"
          : "bg-surface-panel border-border",
      )}
    >
      {/* 移动端菜单按钮 */}
      <button
        onClick={onMenuClick}
        aria-label={t("topbar.openMenu", { defaultValue: "打开菜单" })}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-md md:hidden",
          shadowMode
            ? "hover:bg-white/10"
            : "hover:bg-surface-2 text-text-tertiary",
        )}
      >
        <Menu size={18} aria-hidden="true" />
      </button>

      {shadowMode ? (
        <div className="flex flex-1 items-center gap-2 min-w-0">
          <UserX size={16} className="shrink-0" aria-hidden="true" />
          <span className="text-sm font-[510] truncate">
            {t("shadow.bannerPrefix", { defaultValue: "正以用户身份操作" })}: {actingAs.target_email}
          </span>
          <span className="hidden md:inline text-caption opacity-80 truncate">
            ({t("shadow.actor", { defaultValue: "操作人" })}: {actingAs.actor_email})
          </span>
          {/* 退出 Shadow 走后端 redirect，必须用 form */}
          <form method="POST" action="/shadow/exit" className="ml-auto">
            <button
              type="submit"
              className="px-3 py-1 text-caption bg-white/20 hover:bg-white/30 rounded-md font-[510]"
            >
              {t("shadow.exit", { defaultValue: "退出 Shadow" })}
            </button>
          </form>
        </div>
      ) : (
        <>
          {/* Cmd+K 触发器：左移到 logo 右侧（M1.D 完成后 onOpenCommand 注入） */}
          <button
            type="button"
            onClick={onOpenCommand}
            className={cn(
              "hidden sm:inline-flex items-center gap-2 rounded-md",
              "h-8 min-w-[14rem] px-2.5",
              "bg-surface-1 border border-border text-text-tertiary",
              "hover:bg-surface-2 hover:text-foreground transition-colors",
              "text-sm",
            )}
            aria-label={t("topbar.search", { defaultValue: "搜索 / 命令面板" })}
          >
            <Search size={14} aria-hidden="true" />
            <span className="flex-1 text-left">
              {t("topbar.search", { defaultValue: "搜索 / 跳转 / 操作..." })}
            </span>
            <kbd className="inline-flex items-center gap-0.5 rounded-sm border border-border px-1 py-0.5 text-[10px] font-mono">
              ⌘K
            </kbd>
          </button>

          <div className="flex-1" />

          {/* 余额（仅用户视角有意义） */}
          {balance !== undefined ? (
            <span className="hidden sm:inline-flex items-center text-caption font-mono text-muted-foreground">
              ${balance.toFixed(2)}
            </span>
          ) : null}

          {/* 语言切换 */}
          <button
            type="button"
            onClick={toggleLang}
            aria-label={t("topbar.language", { defaultValue: "Language" })}
            className="inline-flex size-8 items-center justify-center rounded-md hover:bg-surface-2 text-text-tertiary transition-colors"
            title={t("topbar.language", { defaultValue: "Language" })}
          >
            <Globe size={16} aria-hidden="true" />
          </button>

          {/* 主题（G2 改 DropdownMenu） */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="inline-flex size-8 items-center justify-center rounded-md hover:bg-surface-2 text-text-tertiary transition-colors"
                  aria-label={t("topbar.theme.label", { defaultValue: "主题" })}
                  title={t(`topbar.theme.${theme}`, { defaultValue: theme })}
                >
                  {theme === "dark" ? (
                    <Moon size={16} aria-hidden="true" />
                  ) : theme === "light" ? (
                    <Sun size={16} aria-hidden="true" />
                  ) : (
                    <Monitor size={16} aria-hidden="true" />
                  )}
                </button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                {t("topbar.theme.label", { defaultValue: "主题" })}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                <Moon size={14} aria-hidden="true" />
                {t("topbar.theme.dark", { defaultValue: "深色" })}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("light")}>
                <Sun size={14} aria-hidden="true" />
                {t("topbar.theme.light", { defaultValue: "浅色" })}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}>
                <Monitor size={14} aria-hidden="true" />
                {t("topbar.theme.system", { defaultValue: "跟随系统" })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 用户菜单 */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={t("topbar.user", { defaultValue: "用户菜单" })}
                  className="inline-flex h-8 max-w-[180px] items-center gap-2 rounded-md px-2 hover:bg-surface-2 text-foreground transition-colors"
                >
                  <span className="hidden sm:inline text-sm truncate">{email}</span>
                </button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-[14rem]">
              <DropdownMenuLabel>{email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                render={
                  <a
                    href="/oauth2/sign_out?rd=/"
                    aria-label={t("topbar.logout", { defaultValue: "退出登录" })}
                  >
                    <LogOut size={14} aria-hidden="true" />
                    {t("topbar.logout", { defaultValue: "退出登录" })}
                  </a>
                }
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </header>
  );
}

export type { AppHeaderProps };
