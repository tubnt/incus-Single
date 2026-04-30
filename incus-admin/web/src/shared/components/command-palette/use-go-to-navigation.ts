import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * Linear 风 g 序列导航：按 g 进入 go-mode，1.5s 内按下第二键跳转。
 *   g h → /            (Home)
 *   g v → /vms         (VMs)
 *   g b → /billing
 *   g k → /ssh-keys    (SSH Keys)
 *   g t → /tickets
 *   g s → /support
 *
 * Admin（大写或 Shift）：
 *   g M → /admin/monitoring
 *   g N → /admin/nodes
 *   g C → /admin/clusters
 *   g U → /admin/users
 *   g F → /admin/floating-ips
 *   g O → /admin/orders
 *
 * 在 input / textarea / contenteditable / console 路由内禁用。
 */
const PRIMARY_MAP: Record<string, { path: string; label: string }> = {
  h: { path: "/", label: "Home" },
  v: { path: "/vms", label: "VMs" },
  b: { path: "/billing", label: "Billing" },
  k: { path: "/ssh-keys", label: "SSH Keys" },
  t: { path: "/tickets", label: "Tickets" },
  s: { path: "/support", label: "Support" },
};

const ADMIN_MAP: Record<string, { path: string; label: string }> = {
  M: { path: "/admin/monitoring", label: "Monitoring" },
  N: { path: "/admin/nodes", label: "Nodes" },
  C: { path: "/admin/clusters", label: "Clusters" },
  U: { path: "/admin/users", label: "Users" },
  F: { path: "/admin/floating-ips", label: "Floating IPs" },
  O: { path: "/admin/orders", label: "Orders" },
  V: { path: "/admin/vms", label: "Admin VMs" },
};

const TIMEOUT_MS = 1500;

export function useGoToNavigation(opts: { isAdmin: boolean }) {
  const { isAdmin } = opts;
  const navigate = useNavigate();
  const router = useRouterState();
  const goModeRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const isConsole = router.location.pathname.startsWith("/console");
    if (isConsole) return;

    const exitGoMode = () => {
      goModeRef.current = false;
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target.isContentEditable) return;
        // CommandPalette / Dialog 内禁用
        if (target.closest("[role='dialog'], [cmdk-input]")) return;
      }

      if (!goModeRef.current) {
        if (e.key === "g" && !e.shiftKey) {
          goModeRef.current = true;
          timerRef.current = window.setTimeout(exitGoMode, TIMEOUT_MS);
        }
        return;
      }

      // 第二键：尝试匹配
      e.preventDefault();
      const key = e.shiftKey ? e.key.toUpperCase() : e.key.toLowerCase();
      const target2 = PRIMARY_MAP[key] ?? (isAdmin ? ADMIN_MAP[key] : undefined);
      exitGoMode();
      if (target2) {
        navigate({ to: target2.path as any });
      } else {
        toast.dismiss("go-nav-hint");
        toast.message(`未绑定 g ${e.key}`, { id: "go-nav-hint", duration: 1200 });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, [navigate, router.location.pathname, isAdmin]);
}
