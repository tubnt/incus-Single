import type {NavGroup, NavItem} from "./sidebar-data";
import { Accordion } from "@base-ui-components/react/accordion";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity, ArrowLeft, ArrowRight, BarChart3, ChevronDown, ChevronLeft,
  CreditCard, Disc3, FileText, Globe, HardDrive, Key, KeyRound,
  LayoutDashboard, MapPin, Menu, MessageSquare, Network, Package, Plus, Server, ServerCog, Settings, Share2, Shield,
  ShieldCheck, ShoppingCart, Terminal, Ticket, Users, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";
import { adminSidebar, userSidebar } from "./sidebar-data";

/**
 * AppSidebar —— Linear 风。
 * - 顶部 logo
 * - admin: 视角切换按钮
 * - 主导航：active 态左侧 2px indicator + 加深文字色（不再用全背景填充）
 * - admin 多组用 Accordion 折叠
 */

const iconMap: Record<string, React.ElementType> = {
  LayoutDashboard, Server, Key, CreditCard, MessageSquare, KeyRound,
  Network, ServerCog, Activity, Globe, Users, Package, ShoppingCart,
  Ticket, FileText, Plus, Menu, Shield, HardDrive, BarChart3, MapPin,
  Terminal, Settings, Disc3, ShieldCheck, Share2,
};

const OPEN_GROUPS_LS_KEY = "incus.sidebar.admin.openGroups";

interface AppSidebarProps {
  isAdmin: boolean;
  collapsed: boolean;
  mobileOpen?: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}

export function AppSidebar({
  isAdmin,
  collapsed,
  mobileOpen,
  onToggle,
  onNavigate,
}: AppSidebarProps) {
  const { t } = useTranslation();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const perspective: "admin" | "user" = currentPath.startsWith("/admin") ? "admin" : "user";
  const showLabels = !collapsed || Boolean(mobileOpen);

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen flex flex-col transition-all duration-200",
        "bg-surface-panel border-r border-border",
        // 移动端：抽屉
        mobileOpen ? "translate-x-0 w-60" : "-translate-x-full w-60",
        // 桌面：rail/expanded 两态
        collapsed ? "md:w-16 md:translate-x-0" : "md:w-60 md:translate-x-0",
      )}
    >
      {/* Logo + 折叠按钮 */}
      <div className="flex h-14 items-center justify-between px-3 border-b border-border">
        {showLabels ? (
          <Link to="/" className="font-strong text-base text-foreground tracking-tight">
            IncusAdmin
          </Link>
        ) : null}
        <button
          type="button"
          onClick={onToggle}
          aria-label={t("topbar.collapseSidebar", { defaultValue: "Collapse sidebar" })}
          className="inline-flex size-7 items-center justify-center rounded-md hover:bg-surface-2 text-text-tertiary"
        >
          {mobileOpen ? <X size={16} className="md:hidden" aria-hidden="true" /> : null}
          {!mobileOpen
            ? collapsed
              ? <Menu size={16} aria-hidden="true" />
              : <ChevronLeft size={16} aria-hidden="true" />
            : null}
        </button>
      </div>

      {isAdmin ? (
        <PerspectiveSwitch
          perspective={perspective}
          showLabels={showLabels}
          onNavigate={onNavigate}
        />
      ) : null}

      <nav className="flex-1 overflow-y-auto py-2">
        {perspective === "user"
          ? <UserNav items={userSidebar} currentPath={currentPath} showLabels={showLabels} onNavigate={onNavigate} />
          : <AdminNav groups={adminSidebar} currentPath={currentPath} showLabels={showLabels} onNavigate={onNavigate} />}
      </nav>
    </aside>
  );
}

function PerspectiveSwitch({
  perspective,
  showLabels,
  onNavigate,
}: {
  perspective: "admin" | "user";
  showLabels: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const toAdmin = perspective === "user";
  const targetPath = toAdmin ? "/admin/monitoring" : "/";
  const label = toAdmin ? t("sidebar.switchToAdmin") : t("sidebar.backToUser");
  const Icon = toAdmin ? ArrowRight : ArrowLeft;

  return (
    <Link
      to={targetPath}
      onClick={onNavigate}
      title={!showLabels ? label : undefined}
      className={cn(
        "flex items-center gap-2 mx-2 my-2 rounded-md px-3 py-2 text-sm",
        "border border-border bg-surface-2 text-foreground",
        "hover:bg-surface-3 transition-colors",
        !showLabels && "justify-center px-0",
      )}
    >
      {!toAdmin && showLabels ? <Icon size={14} aria-hidden="true" /> : null}
      {showLabels ? <span className="truncate">{label}</span> : <Icon size={16} aria-hidden="true" />}
      {toAdmin && showLabels ? <Icon size={14} className="ml-auto" aria-hidden="true" /> : null}
    </Link>
  );
}

interface NavLinkRowProps {
  item: NavItem;
  active: boolean;
  showLabels: boolean;
  onNavigate?: () => void;
  /** 子菜单项缩进 */
  inset?: boolean;
}

function NavLinkRow({ item, active, showLabels, onNavigate, inset }: NavLinkRowProps) {
  const { t } = useTranslation();
  const Icon = iconMap[item.icon] ?? LayoutDashboard;

  return (
    <Link
      to={item.to as any}
      onClick={onNavigate}
      title={!showLabels ? t(item.key) : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 mx-2 rounded-md text-sm font-emphasis transition-colors",
        inset ? "pl-6 pr-3 py-1" : "px-3 py-1",
        active
          ? "text-foreground bg-surface-2"
          : "text-text-secondary hover:text-foreground hover:bg-surface-1",
        !showLabels && "justify-center px-0",
      )}
      aria-current={active ? "page" : undefined}
    >
      {/* Linear 风左侧 2px indicator */}
      {active ? (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent"
        />
      ) : null}
      <Icon size={inset ? 14 : 16} aria-hidden="true" />
      {showLabels ? (
        <span className="truncate">{t(item.key)}</span>
      ) : null}
    </Link>
  );
}

function UserNav({
  items,
  currentPath,
  showLabels,
  onNavigate,
}: {
  items: NavItem[];
  currentPath: string;
  showLabels: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => (
        <NavLinkRow
          key={item.to}
          item={item}
          active={isItemActive(currentPath, item.to)}
          showLabels={showLabels}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

function AdminNav({
  groups,
  currentPath,
  showLabels,
  onNavigate,
}: {
  groups: NavGroup[];
  currentPath: string;
  showLabels: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const activeGroupKey = useMemo(
    () => groups.find((g) => g.items.some((i) => isItemActive(currentPath, i.to)))?.key,
    [groups, currentPath],
  );

  const [openGroups, setOpenGroups] = useState<string[]>(() => {
    if (typeof window === "undefined") return activeGroupKey ? [activeGroupKey] : [];
    try {
      const raw = window.localStorage.getItem(OPEN_GROUPS_LS_KEY);
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      return activeGroupKey && !parsed.includes(activeGroupKey) ? [...parsed, activeGroupKey] : parsed;
    } catch {
      return activeGroupKey ? [activeGroupKey] : [];
    }
  });

  useEffect(() => {
    if (activeGroupKey && !openGroups.includes(activeGroupKey)) {
      setOpenGroups((prev) => [...prev, activeGroupKey]);
    }
  }, [activeGroupKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(OPEN_GROUPS_LS_KEY, JSON.stringify(openGroups));
    } catch {
      // noop
    }
  }, [openGroups]);

  // 折叠侧栏：扁平图标列表
  if (!showLabels) {
    return (
      <div className="flex flex-col gap-0.5">
        {groups.map((group, idx) => (
          <div key={group.key}>
            {idx > 0 ? <div className="mx-3 my-1 border-t border-border" /> : null}
            {group.items.map((item) => (
              <NavLinkRow
                key={item.to}
                item={item}
                active={isItemActive(currentPath, item.to)}
                showLabels={false}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <Accordion.Root
      value={openGroups}
      onValueChange={(v) => setOpenGroups(v.filter((x): x is string => typeof x === "string"))}
      multiple
      className="flex flex-col gap-0.5"
    >
      {groups.map((group) => {
        const GroupIcon = iconMap[group.icon] ?? LayoutDashboard;
        const hasActive = group.items.some((i) => isItemActive(currentPath, i.to));
        return (
          <Accordion.Item key={group.key} value={group.key}>
            <Accordion.Header className="m-0">
              <Accordion.Trigger
                className={cn(
                  "group flex w-[calc(100%-1rem)] items-center gap-3 mx-2 px-3 py-1.5",
                  "rounded-md text-sm transition-colors",
                  hasActive
                    ? "text-foreground"
                    : "text-text-tertiary hover:text-foreground hover:bg-surface-1",
                )}
              >
                <GroupIcon size={16} aria-hidden="true" />
                <span className="flex-1 text-left truncate">{t(group.titleKey)}</span>
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  className="transition-transform duration-150 group-data-[panel-open]:rotate-180"
                />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Panel className="overflow-hidden transition-[height] duration-150 ease-out data-[starting-style]:h-0 data-[ending-style]:h-0 h-[var(--accordion-panel-height)]">
              <div className="mt-0.5 flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <NavLinkRow
                    key={item.to}
                    item={item}
                    active={isItemActive(currentPath, item.to)}
                    showLabels
                    onNavigate={onNavigate}
                    inset
                  />
                ))}
              </div>
            </Accordion.Panel>
          </Accordion.Item>
        );
      })}
    </Accordion.Root>
  );
}

function isItemActive(currentPath: string, to: string): boolean {
  if (to === "/") return currentPath === "/";
  return currentPath === to || currentPath.startsWith(`${to}/`);
}
