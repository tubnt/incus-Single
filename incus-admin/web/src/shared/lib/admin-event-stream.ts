import type {QueryClient} from "@tanstack/react-query";
import { vmKeys } from "@/features/vms/api";

/**
 * D2: admin 端全局 WS 订阅 `/api/admin/events/ws`，按 lifecycle/operation 事件
 *      触发 query invalidate，从而把"VM 状态变化"从 10s 轮询升级到事件驱动。
 *
 *  设计要点：
 *   - debounce 500ms 合并连续事件，避免风暴（一个 evacuate 触发 N 个 lifecycle）
 *   - 仅 admin 启用（非 admin 用户没必要订阅集群级事件）
 *   - 失败自动 5s 重连
 *   - 与 admin/observability.tsx 的 EventStream 并存（那边是展示，这边是 invalidate）
 *   - Incus events 的 location 字段是节点名而非集群名，所以没法做 cluster-scoped
 *     失效，统一 invalidate 整个 vmKeys 命名空间（debounce 保护即可）
 */

interface IncusEvent {
  type: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  location?: string;
  project?: string;
}

const DEBOUNCE_MS = 500;
const RECONNECT_MS = 5000;

export function startAdminEventStream(qc: QueryClient): () => void {
  let ws: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let debounceTimer: number | null = null;
  let unmounted = false;
  let pending = false;

  const flush = () => {
    if (pending) {
      qc.invalidateQueries({ queryKey: vmKeys.all });
      pending = false;
    }
    debounceTimer = null;
  };

  const scheduleFlush = () => {
    pending = true;
    if (debounceTimer != null) return;
    debounceTimer = window.setTimeout(flush, DEBOUNCE_MS);
  };

  const connect = () => {
    if (unmounted) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/admin/events/ws`;
    ws = new WebSocket(wsUrl);

    ws.onclose = () => {
      if (!unmounted) {
        reconnectTimer = window.setTimeout(connect, RECONNECT_MS);
      }
    };
    ws.onerror = () => ws?.close();
    ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as IncusEvent;
        if (event.type === "lifecycle" || event.type === "operation") {
          scheduleFlush();
        }
      } catch {
        // ignore parse errors
      }
    };
  };

  connect();

  return () => {
    unmounted = true;
    if (reconnectTimer != null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (debounceTimer != null) {
      window.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    ws?.close();
    ws = null;
  };
}
