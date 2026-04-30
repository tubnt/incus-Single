import type { User } from "@/shared/lib/auth";
import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity, BarChart3, Circle, Clock, CreditCard, Disc3, FileText, Globe,
  HardDrive, Key, KeyRound, LayoutDashboard, MapPin, MessageSquare, Network,
  Package, Plus, Server, ServerCog, Settings, Share2, Shield, ShieldCheck,
  ShoppingCart, Terminal, Ticket, Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import {
  adminSidebar,
  userSidebar,
} from "@/shared/components/layout/sidebar-data";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/shared/components/ui/command";
import { isAdmin } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/utils";
import { pushRecent, readRecent, useCommandStore } from "./command-store";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User;
}

/** lucide 图标白名单：只列项目实际用到的，避免 tree-shaking 失败把整个 lucide 打进来。 */
const ICON_MAP: Record<string, React.ElementType> = {
  Activity, BarChart3, Clock, CreditCard, Disc3, FileText, Globe,
  HardDrive, Key, KeyRound, LayoutDashboard, MapPin, MessageSquare, Network,
  Package, Plus, Server, ServerCog, Settings, Share2, Shield, ShieldCheck,
  ShoppingCart, Terminal, Ticket, Users,
};

function ResolveIcon({ name }: { name?: string }) {
  if (!name) return <Circle aria-hidden="true" />;
  const Icon = ICON_MAP[name];
  return Icon ? <Icon aria-hidden="true" /> : <Circle aria-hidden="true" />;
}

/**
 * CommandPalette —— 全局 Cmd+K / Ctrl+K。
 * 三段：Recent / Pages / Actions。
 *
 * C2: `/console` 路由禁用全局热键 scope；header 的 Cmd+K 触发器仍可用。
 */
export function CommandPalette({ open, onOpenChange, user }: CommandPaletteProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const router = useRouterState();
  const actions = useCommandStore((s) => s.actions);

  const isConsole = router.location.pathname.startsWith("/console");

  // 全局快捷键 ⌘K / Ctrl+K（console 路由内禁用，避免和 xterm 冲突）
  useHotkeys(
    "mod+k",
    (e) => {
      e.preventDefault();
      onOpenChange(true);
    },
    { enabled: !isConsole, enableOnFormTags: true, enableOnContentEditable: true },
    [onOpenChange, isConsole],
  );

  const [search, setSearch] = useState("");

  // 打开时清空搜索，给焦点一个干净起点
  useEffect(() => {
    if (open) setSearch("");
  }, [open]);

  // Pages 数据：admin 看全部 sidebar 项；user 仅看用户视角
  const pages = useMemo(() => {
    const items: Array<{ key: string; to: string; icon: string; group: string }> = [];
    for (const it of userSidebar) {
      items.push({ key: it.key, to: it.to, icon: it.icon, group: t("commandPalette.userSection", { defaultValue: "用户" }) });
    }
    if (isAdmin(user)) {
      for (const grp of adminSidebar) {
        for (const it of grp.items) {
          items.push({ key: it.key, to: it.to, icon: it.icon, group: t(grp.titleKey) });
        }
      }
    }
    return items;
  }, [user, t]);

  const recent = useMemo(() => readRecent(), [open]);

  // 当前路由相关的动作（从 zustand store 读取）
  const contextActions = actions;

  const go = (path: string, title: string) => {
    pushRecent({ path, title });
    onOpenChange(false);
    // 用 navigate 而非 window.location.href（B1 SPA 跳转）
    navigate({ to: path as any });
  };

  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            "transition-opacity duration-150",
          )}
        />
        <BaseDialog.Popup
          className={cn(
            "fixed left-1/2 top-[20%] z-50 -translate-x-1/2",
            "w-[min(92vw,40rem)] rounded-xl border border-border bg-surface-elevated",
            "shadow-[var(--shadow-dialog)] outline-none overflow-hidden",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            "data-[starting-style]:scale-95 data-[ending-style]:scale-95",
            "transition-all duration-150",
          )}
        >
          <Command shouldFilter loop>
            <CommandInput
              autoFocus
              value={search}
              onValueChange={setSearch}
              placeholder={t("commandPalette.placeholder", {
                defaultValue: "搜索页面、操作、最近访问...（前缀：> 操作 / / 页面）",
              })}
            />
            <CommandList>
              <CommandEmpty>
                {t("commandPalette.empty", { defaultValue: "未找到匹配项" })}
              </CommandEmpty>

              {/* Recent */}
              {recent.length > 0 && !search ? (
                <CommandGroup heading={t("commandPalette.recent", { defaultValue: "最近访问" })}>
                  {recent.map((r) => (
                    <CommandItem
                      key={`recent:${r.path}`}
                      value={`recent ${r.path} ${r.title}`}
                      onSelect={() => go(r.path, r.title)}
                    >
                      <Clock aria-hidden="true" />
                      <span className="flex-1">{r.title}</span>
                      <span className="text-text-tertiary text-label">{r.path}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}

              {/* Context Actions */}
              {contextActions.length > 0 ? (
                <>
                  {recent.length > 0 && !search ? <CommandSeparator /> : null}
                  <CommandGroup
                    heading={t("commandPalette.actions", { defaultValue: "当前页操作" })}
                  >
                    {contextActions.map((a) => (
                      <CommandItem
                        key={`action:${a.id}`}
                        value={`${a.id} ${a.title} ${(a.keywords ?? []).join(" ")}`}
                        onSelect={() => {
                          a.perform();
                          onOpenChange(false);
                        }}
                        className={a.destructive ? "text-status-error data-[selected=true]:bg-status-error/10" : ""}
                      >
                        <ResolveIcon name={a.icon} />
                        <span className="flex-1">{a.title}</span>
                        {a.subtitle ? (
                          <span className="text-text-tertiary text-label">{a.subtitle}</span>
                        ) : null}
                        {a.shortcut ? <CommandShortcut>{a.shortcut}</CommandShortcut> : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              ) : null}

              {/* Pages */}
              <CommandSeparator />
              <CommandGroup heading={t("commandPalette.pages", { defaultValue: "页面" })}>
                {pages.map((p) => (
                  <CommandItem
                    key={`page:${p.to}`}
                    value={`page ${p.to} ${t(p.key)} ${p.group}`}
                    onSelect={() => go(p.to, t(p.key))}
                  >
                    <ResolveIcon name={p.icon} />
                    <span className="flex-1">{t(p.key)}</span>
                    <span className="text-text-tertiary text-label">{p.group}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
