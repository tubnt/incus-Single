import type {CommandAction} from "./command-store";
import { useEffect } from "react";
import { useCommandStore } from "./command-store";

/**
 * 路由级 Hook：声明此页"可执行"的上下文命令。
 *
 * 例：
 *   useCommandActions(() => [
 *     { id: "vm.create", title: "新建 VM", icon: "Plus",
 *       perform: () => navigate({ to: "/admin/create-vm" }) },
 *     { id: "vm.refresh", title: "刷新列表", perform: () => refetch() },
 *   ], [navigate]);
 */
export function useCommandActions(
  factory: () => CommandAction[],
  deps: React.DependencyList = [],
) {
  const register = useCommandStore((s) => s.registerActions);
  useEffect(() => {
    const actions = factory();
    if (actions.length === 0) return;
    return register(actions);
  }, deps);
}
