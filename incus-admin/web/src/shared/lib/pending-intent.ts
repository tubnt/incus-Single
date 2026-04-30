/**
 * Pending Intent —— A1 step-up 重认证 UX 修复（通知式）。
 *
 * 流程：
 *   1) `http.ts` 抛 step-up 401 之前，调用 `savePendingIntent()` 持久化用户意图。
 *   2) 浏览器跳 OIDC，回调后回到 returnPath。
 *   3) `<AppShell>` mount 时调用 `consumePendingIntent()`。若有未过期 intent
 *      且当前 path = returnPath，弹出通知告诉用户"刚才的 X 操作被中断了，请
 *      重新发起"，然后 clear。
 *
 * 设计要点：
 *   - sessionStorage 仅当前 tab 有效，避免跨 tab 串扰
 *   - TTL 5 分钟，过期自动清
 *   - 不存敏感数据（密码、token），只存"想做什么"的描述
 *   - **不做自动 replay**：跨 React 组件树重放 mutation 需要复杂 hook 协调，
 *     且大多数操作（删除/重启）二次 trigger 也无害——保留通知式即可，让用
 *     户在保留输入状态的页面手动再点一次。这与 Auth0 / Logto 文档的 step-up
 *     UX 推荐一致。
 */

const KEY = "incus.pendingIntent.v1";
const TTL_MS = 5 * 60 * 1000;

export interface PendingIntent {
  /** 业务动作描述符，例如 "vm.delete" "vm.batch_delete"——只用于显示 */
  action: string;
  /** 序列化后的参数（仅供调试 / 日志，不会被 replay） */
  args: Record<string, unknown>;
  /** OIDC 跳转前的路径，replay 时只在该路径上才弹通知 */
  returnPath: string;
  /** ISO 时间戳，用于 TTL */
  createdAt: string;
  /** UI 友好描述（例如 "删除 vm-aaa"） */
  description: string;
}

export function savePendingIntent(intent: Omit<PendingIntent, "createdAt">): void {
  try {
    const full: PendingIntent = { ...intent, createdAt: new Date().toISOString() };
    sessionStorage.setItem(KEY, JSON.stringify(full));
  } catch {
    // sessionStorage 不可用 -> 静默失败，用户重新操作即可
  }
}

export function readPendingIntent(): PendingIntent | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingIntent;
    const created = new Date(parsed.createdAt).getTime();
    if (Number.isNaN(created) || Date.now() - created > TTL_MS) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingIntent(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // noop
  }
}

/**
 * consumePendingIntent —— 读取并清除（一次性消费）。
 * 调用方拿到结果后只显示一个非阻塞通知，不再尝试 replay。
 */
export function consumePendingIntent(): PendingIntent | null {
  const intent = readPendingIntent();
  if (intent) clearPendingIntent();
  return intent;
}
