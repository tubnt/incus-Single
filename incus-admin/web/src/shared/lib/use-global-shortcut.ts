// useGlobalShortcut —— Session-2 F-61 / PLAN-051 §2-K：vms.tsx 与
// command-palette.tsx 各写一份 keydown 守卫（INPUT/dialog/cmdk/contenteditable
// 排除）。多份重复手写 keydown 是项目历史 bug 温床
// （memory: feedback_ui_destructive querySelectorAll 误删 vm 事故同源）。
//
// 抽出统一 helper 让所有快捷键都走"应不应该响应"判断。
//
// 用法：
//
//   useGlobalShortcut("j", () => navigateNext(), { ignoreInModifier: true });
//   useGlobalShortcut("Enter", () => openDetail(), { enabled: !!hl });
//
// 默认行为：
//   - 表单元素（INPUT / TEXTAREA / SELECT）内不触发
//   - contentEditable 内不触发
//   - 弹窗 / 对话框内不触发（[role='dialog'] / cmdk）
//   - 修饰键（Cmd/Ctrl/Alt/Meta）按下时不触发（除非 allowModifier=true）

import { useEffect } from "react";

interface ShortcutOpts {
  /** 是否启用本快捷键。默认 true。false 时不挂 listener。 */
  enabled?: boolean;
  /** 修饰键按下时是否仍触发。默认 false（Cmd+J 等浏览器快捷键不会撞）。 */
  allowModifier?: boolean;
  /** 在表单/对话框内是否仍触发。默认 false。 */
  fireInForms?: boolean;
}

export function useGlobalShortcut(
  key: string,
  handler: (e: KeyboardEvent) => void,
  opts: ShortcutOpts = {},
  deps: unknown[] = [],
) {
  const { enabled = true, allowModifier = false, fireInForms = false } = opts;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!allowModifier && (e.metaKey || e.ctrlKey || e.altKey)) return;
      if (e.key !== key) return;
      if (!fireInForms) {
        const target = e.target as HTMLElement | null;
        if (target) {
          const tag = target.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
          if (target.isContentEditable) return;
          if (target.closest("[role='dialog'], [cmdk-input]")) return;
        }
      }
      handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // 调用方通过 deps 数组显式声明依赖；handler 闭包由调用方负责保证最新值。
    // eslint-disable-next-line react/exhaustive-deps
  }, [enabled, key, allowModifier, fireInForms, ...deps]);
}
