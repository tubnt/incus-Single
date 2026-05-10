import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

interface ConsoleTerminalProps {
  vmName: string;
  project: string;
  cluster: string;
  className?: string;
  /** 监听 dark/light 切换。父组件持续传当前 theme，xterm 重建调色板。 */
  themeKey?: string;
}

/**
 * 读 CSS 变量构造 xterm theme（D3）。
 * 必须在浏览器 paint 后才能拿到生效值，所以放进 effect。
 */
function readXTermTheme() {
  if (typeof window === "undefined") return undefined;
  const cs = window.getComputedStyle(document.documentElement);
  const get = (name: string) => cs.getPropertyValue(name).trim();
  return {
    background: get("--xterm-bg") || "#0f1011",
    foreground: get("--xterm-fg") || "#d0d6e0",
    cursor: get("--xterm-cursor") || "#7170ff",
    selectionBackground: get("--xterm-selection") || "rgba(113,112,255,0.35)",
  };
}

export function ConsoleTerminal({
  vmName,
  project,
  cluster,
  className,
  themeKey,
}: ConsoleTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!termRef.current) return;

    // Session-3 🔵-5 / PLAN-051 §2-J：WS 握手与 xterm 实例化并行。原版必须等
    // terminal.open + fitAddon.fit 完后才 new WebSocket，浪费 ~100-300ms RTT。
    // 改：先发 WS，早期消息进 buffer；terminal 就绪后 flush。
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/console?vm=${encodeURIComponent(vmName)}&project=${encodeURIComponent(project)}&cluster=${encodeURIComponent(cluster)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    const earlyBuffer: Uint8Array[] = [];
    let terminalReady = false;
    ws.onmessage = (event) => {
      const writeOrBuffer = (chunk: Uint8Array) => {
        if (terminalReady && terminalRef.current) {
          terminalRef.current.write(chunk);
        } else {
          earlyBuffer.push(chunk);
        }
      };
      if (event.data instanceof ArrayBuffer) {
        writeOrBuffer(new Uint8Array(event.data));
      } else if (typeof event.data === "string") {
        writeOrBuffer(new TextEncoder().encode(event.data));
      } else if (event.data instanceof Blob) {
        event.data.arrayBuffer().then((buf) => writeOrBuffer(new Uint8Array(buf)));
      }
    };

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "var(--font-mono), 'JetBrains Mono Variable', 'Fira Code', monospace",
      theme: readXTermTheme(),
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(termRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;

    terminal.writeln(`Connecting to ${vmName}...`);
    terminalReady = true;
    for (const chunk of earlyBuffer) terminal.write(chunk);
    earlyBuffer.length = 0;

    ws.onopen = () => {
      terminal.writeln("Connected.\r\n");
    };

    ws.onerror = () => {
      terminal.writeln("\r\n\x1B[31mConnection error.\x1B[0m");
    };

    ws.onclose = () => {
      terminal.writeln("\r\n\x1B[33mDisconnected.\x1B[0m");
    };

    terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        const encoder = new TextEncoder();
        ws.send(encoder.encode(data));
      }
    });

    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      ws.close();
      terminal.dispose();
    };
  }, [vmName, project, cluster]);

  // 主题切换时更新 xterm 调色板，无需重建 terminal/ws。
  useEffect(() => {
    if (!terminalRef.current) return;
    const t = readXTermTheme();
    if (t) terminalRef.current.options.theme = t;
  }, [themeKey]);

  return (
    <div
      ref={termRef}
      className={className ?? "w-full rounded-lg overflow-hidden border border-border"}
      style={className ? undefined : { height: "500px" }}
    />
  );
}
