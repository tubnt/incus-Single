import type { User } from "@/shared/lib/auth";
import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity, BarChart3, Circle, Clock, CreditCard, Disc3, FileText, Globe,
  HardDrive, Key, KeyRound, LayoutDashboard, MapPin, MessageSquare, Network,
  Package, Plus, Server, ServerCog, Settings, Share2, Shield, ShieldCheck,
  ShoppingCart, Terminal, Ticket, Users,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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

  // PLAN-034 P2-B：`/` 是 Linear / GitHub / Vim 风搜索快捷键，作为 ⌘K 的字母键替代。
  // react-hotkeys-hook v5 不能直接绑定字面 "/"——切回原生 keydown 监听，与
  // useGoToNavigation 同一模式（在 input/dialog 内不触发；带修饰键不触发）。
  const openOnSlash = useCallback(() => onOpenChange(true), [onOpenChange]);
  useEffect(() => {
    if (isConsole) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target.isContentEditable) return;
        // 避开命令面板自身 / 其它 dialog
        if (target.closest("[role='dialog'], [cmdk-input]")) return;
      }
      e.preventDefault();
      openOnSlash();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isConsole, openOnSlash]);

  const [search, setSearch] = useState("");

  // 打开时清空搜索，给焦点一个干净起点
  useEffect(() => {
    if (open) {
      // open 是 prop 驱动；首次打开重置内部 search state
      // eslint-disable-next-line react/set-state-in-effect
      setSearch("");
    }
  }, [open]);

  // Pages 数据按 section 分组（每个 section 单独 CommandGroup heading），
  // 搜索为空时即可浏览完整 navigation tree。
  const pageGroups = useMemo(() => {
    const groups: Array<{ key: string; heading: string; items: Array<{ key: string; to: string; icon: string }> }> = [];
    groups.push({
      key: "user",
      heading: t("commandPalette.userSection", { defaultValue: "用户" }),
      items: userSidebar.map((it) => ({ key: it.key, to: it.to, icon: it.icon })),
    });
    if (isAdmin(user)) {
      for (const grp of adminSidebar) {
        groups.push({
          key: grp.key,
          heading: t(grp.titleKey),
          items: grp.items.map((it) => ({ key: it.key, to: it.to, icon: it.icon })),
        });
      }
    }
    return groups;
  }, [user, t]);

  // recent 列表只在面板打开时重新计算（每次 open 切换 true 重读 localStorage）。
  // open 是该 memo 唯一依赖；ESLint exhaustive-deps 误判 readRecent 为外部依赖，
  // 这里是显式 token 故意只关注 open，禁用 lint：
  // eslint-disable-next-line react/exhaustive-deps
  const recent = useMemo(() => readRecent(), [open]);

  // 当前路由相关的动作（从 zustand store 读取）
  const contextActions = actions;

  const go = (path: string, title: string) => {
    pushRecent({ path, title });
    onOpenChange(false);
    // 用 navigate 而非 window.location.href（B1 SPA 跳转）
    // OPS-038: path 是 sidebar-data 中的 runtime string，无法静态化为 union literal
     
    navigate({ to: path as any });
  };

  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-black/85 backdrop-blur-sm",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            "transition-opacity duration-150",
          )}
        />
        <BaseDialog.Popup
          // OPS-037: Tailwind v4 不把 min()/calc() 形式的 --size-* token 渲染为
          // width utility，需要 inline style 引用 var 才能生效。
          style={{ width: "var(--size-sheet-lg)" }}
          className={cn(
            "fixed left-1/2 top-[20%] z-50 -translate-x-1/2",
            "rounded-xl border border-border bg-surface-elevated",
            "shadow-dialog outline-none overflow-hidden",
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

              {/* Pages —— 按 section 分组展示，浏览完整 navigation tree */}
              {pageGroups.map((g, idx) => (
                <Fragment key={`pg:${g.key}`}>
                  {idx === 0 ? <CommandSeparator /> : null}
                  <CommandGroup heading={g.heading}>
                    {g.items.map((p) => (
                      <CommandItem
                        key={`page:${p.to}`}
                        value={`page ${p.to} ${t(p.key)} ${g.heading}`}
                        onSelect={() => go(p.to, t(p.key))}
                      >
                        <ResolveIcon name={p.icon} />
                        <span className="flex-1">{t(p.key)}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </Fragment>
              ))}
            </CommandList>
          </Command>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
