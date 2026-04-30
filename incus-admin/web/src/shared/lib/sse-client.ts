/**
 * SSE 客户端薄封装。EventSource 自带 Last-Event-ID 重连，但默认不携带 cookie，
 * 也不暴露 onclose 区分"服务端 done"和"网络断开"。这里：
 *   - 用 fetch + ReadableStream 实现，确保浏览器同源 cookie 一起发送（生产
 *     反代鉴权）；EventSource 的"withCredentials"在 same-origin 下其实是
 *     默认带 cookie 的，但 fetch 路径让我们能精细控制 done 信号 + 自定义
 *     header（Last-Event-ID 重连）+ 主动 abort
 *   - 解析 SSE 帧（id / event / data 行）
 *   - 终态事件 `event: done` 后调 onDone 并不再重连
 *
 * PLAN-025 用法见 features/jobs/use-job-stream.ts。
 */

export interface SSEMessage {
  id?: string;
  event: string;
  data: string;
}

export interface SSEOptions {
  /** 重连间隔（毫秒），默认 3000 */
  reconnectMs?: number;
  /** done 事件回调；收到后客户端会 close 不再重连 */
  onDone?: (msg: SSEMessage) => void;
  /** 普通事件回调（含 message / step / 等） */
  onMessage: (msg: SSEMessage) => void;
  /** 网络错误回调；返回 false 阻止自动重连 */
  onError?: (err: Error) => boolean | void;
}

export interface SSESubscription {
  /** 主动断开 */
  close: () => void;
}

/** 启动一个 SSE 订阅，自动重连到 done 或主动 close 为止 */
export function startSSE(url: string, opts: SSEOptions): SSESubscription {
  let aborter: AbortController | null = null;
  let lastEventID: string | null = null;
  let stopped = false;
  const reconnectMs = opts.reconnectMs ?? 3000;

  const close = () => {
    stopped = true;
    aborter?.abort();
  };

  const run = async () => {
    while (!stopped) {
      aborter = new AbortController();
      try {
        const headers: HeadersInit = { Accept: "text/event-stream" };
        if (lastEventID != null) headers["Last-Event-ID"] = lastEventID;

        const resp = await fetch(url, { headers, signal: aborter.signal, credentials: "same-origin" });
        if (!resp.ok || !resp.body) {
          throw new Error(`SSE response ${resp.status}`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let done = false;

        while (!stopped) {
          const { value, done: readerDone } = await reader.read();
          if (readerDone) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE 帧以 \n\n 分隔
          let idx = buffer.indexOf("\n\n");
          while (idx >= 0) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            idx = buffer.indexOf("\n\n");
            const msg = parseFrame(frame);
            if (!msg) continue;
            if (msg.id) lastEventID = msg.id;

            if (msg.event === "done") {
              done = true;
              opts.onDone?.(msg);
            } else {
              opts.onMessage(msg);
            }
          }

          if (done) {
            stopped = true;
            return;
          }
        }
      } catch (err) {
        if (stopped) return;
        const e = err instanceof Error ? err : new Error(String(err));
        if (opts.onError?.(e) === false) return;
      }
      if (stopped) return;
      // 重连前等一会儿，避免上游 504 时 tight-loop
      await new Promise((res) => setTimeout(res, reconnectMs));
    }
  };

  void run();
  return { close };
}

function parseFrame(frame: string): SSEMessage | null {
  let id: string | undefined;
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue; // comment / keepalive
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon);
    let value = line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  return { id, event, data: dataLines.join("\n") };
}
