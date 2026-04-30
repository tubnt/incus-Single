import { create } from "zustand";

/**
 * 命令面板的全局 store。
 * 路由 / 业务组件用 useCommandActions 注册上下文动作；命令面板组件读取并展示。
 *
 * 上下文动作 = 当前路由特有的动作（如在 /admin/vms 上的"新建 VM"、在 vm-detail 上的"启动"）。
 * Pages = 全局可达的路由跳转（来自 sidebar-data）。
 * Recent = localStorage 里最近访问的路由。
 */

export interface CommandAction {
  id: string;
  /** 显示的标题 */
  title: string;
  /** 可选的副标题 / 路径提示 */
  subtitle?: string;
  /** 用于 cmdk 模糊搜索的关键字 */
  keywords?: string[];
  /** lucide-react 图标名（可选） */
  icon?: string;
  /** 执行 */
  perform: () => void;
  /** 危险操作？UI 上做红色提示 */
  destructive?: boolean;
  /** 分组键（默认 "actions"） */
  group?: string;
  /** 快捷键提示文案（仅显示，不绑定） */
  shortcut?: string;
}

interface CommandStore {
  actions: CommandAction[];
  registerActions: (actions: CommandAction[]) => () => void;
}

export const useCommandStore = create<CommandStore>((set) => ({
  actions: [],
  registerActions: (actions) => {
    set((state) => ({
      actions: [
        ...state.actions.filter((a) => !actions.some((b) => b.id === a.id)),
        ...actions,
      ],
    }));
    return () => {
      set((state) => ({
        actions: state.actions.filter((a) => !actions.some((b) => b.id === a.id)),
      }));
    };
  },
}));

const RECENT_KEY = "incus.cmd.recent.v1";
const RECENT_MAX = 5;

export interface RecentEntry {
  path: string;
  title: string;
  visitedAt: string;
}

export function readRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

export function pushRecent(entry: Omit<RecentEntry, "visitedAt">): void {
  try {
    const list = readRecent().filter((e) => e.path !== entry.path);
    list.unshift({ ...entry, visitedAt: new Date().toISOString() });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // noop
  }
}
