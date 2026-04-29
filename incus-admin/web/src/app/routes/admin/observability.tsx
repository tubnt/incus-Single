import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/observability")({
  component: ObservabilityPage,
});

interface Dashboard {
  id: string;
  label: string;
  url: string;
  desc: string;
  // embeddable=false 表示浏览器 Mixed-Content 会拦截 iframe（HTTP over HTTPS 页面）
  // 或目标服务拒绝被 iframe（X-Frame-Options）。此时只允许"新窗口打开"。
  embeddable: boolean;
}

const DASHBOARDS: Dashboard[] = [
  { id: "grafana", label: "Grafana", url: "http://10.0.20.1:3000", desc: "Metrics dashboards (CPU, RAM, Disk, Network) — HTTP only, new tab", embeddable: false },
  { id: "prometheus", label: "Prometheus", url: "http://10.0.20.1:9090", desc: "Metrics query and exploration — HTTP only, new tab", embeddable: false },
  { id: "alertmanager", label: "Alertmanager", url: "http://10.0.20.1:9093", desc: "Alert routing and silencing — HTTP only, new tab", embeddable: false },
  { id: "ceph", label: "Ceph Dashboard", url: "https://10.0.20.1:8443", desc: "Ceph storage management (requires VPN)", embeddable: true },
];

function ObservabilityPage() {
  const { t } = useTranslation();
  const [active, setActive] = useState<string | null>(null);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t("admin.observability.title")}</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {DASHBOARDS.map((d) => (
          <div key={d.id} className="border border-border rounded-lg bg-card p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">{d.label}</h3>
              <div className="flex gap-2">
                {d.embeddable && (
                  <button onClick={() => setActive(active === d.id ? null : d.id)}
                    className="px-3 py-1 text-xs bg-primary/20 text-primary rounded hover:bg-primary/30">
                    {active === d.id ? t("admin.observability.close") : t("admin.observability.embed")}
                  </button>
                )}
                <a href={d.url} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-1 text-xs bg-muted/50 text-muted-foreground rounded hover:bg-muted">
                  {t("admin.observability.open")}
                </a>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{d.desc}</p>
          </div>
        ))}
      </div>

      {active && (() => {
        const current = DASHBOARDS.find((d) => d.id === active);
        if (!current || !current.embeddable) return null;
        return (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-muted/30 flex items-center justify-between">
              <span className="text-sm font-medium">{current.label}</span>
              <button onClick={() => setActive(null)} className="text-xs text-muted-foreground hover:text-foreground">
                Close ×
              </button>
            </div>
            <iframe
              src={current.url}
              className="w-full h-[700px]"
              title={active}
            />
          </div>
        );
      })()}

      <EventStream />

      <div className="mt-6 border border-border rounded-lg bg-card p-4">
        <h3 className="font-semibold mb-2">{t("admin.observability.accessNoteTitle")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("admin.observability.accessNoteBody")}
        </p>
      </div>
    </div>
  );
}

interface IncusEvent {
  type: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  location?: string;
  project?: string;
}

function EventStream() {
  const { t } = useTranslation();
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<IncusEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);
  const maxEvents = 100;

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    unmountedRef.current = false;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/admin/events/ws`;

    function connect() {
      if (unmountedRef.current) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        if (reconnectTimerRef.current !== null) {
          window.clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!unmountedRef.current) {
          reconnectTimerRef.current = window.setTimeout(connect, 5000);
        }
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        if (pausedRef.current) return;
        try {
          const event = JSON.parse(e.data) as IncusEvent;
          setEvents((prev) => [event, ...prev].slice(0, maxEvents));
        } catch {
          // ignore parse errors
        }
      };
    }

    connect();
    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
    };
  }, []);

  const typeColors: Record<string, string> = {
    lifecycle: "text-primary",
    operation: "text-muted-foreground",
    logging: "text-warning",
  };

  return (
    <div className="mt-6 border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-sm">{t("admin.observability.eventStream")}</h3>
          <span className={`inline-flex items-center gap-1 text-xs ${connected ? "text-success" : "text-destructive"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-success" : "bg-destructive"}`} />
            {connected ? t("admin.observability.connected") : t("admin.observability.disconnected")}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setPaused(!paused)}
            className="px-2 py-1 text-xs border border-border rounded hover:bg-muted"
          >
            {paused ? t("admin.observability.resume") : t("admin.observability.pause")}
          </button>
          <button
            onClick={() => setEvents([])}
            className="px-2 py-1 text-xs border border-border rounded hover:bg-muted"
          >
            {t("admin.observability.clear")}
          </button>
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto bg-black/90 p-2">
        {events.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-4">
            {connected ? t("admin.observability.waitingEvents") : t("admin.observability.connecting")}
          </div>
        ) : (
          events.map((ev, i) => (
            <div key={i} className="flex gap-2 text-xs font-mono py-0.5 hover:bg-white/5">
              <span className="text-muted-foreground shrink-0">
                {new Date(ev.timestamp).toLocaleTimeString()}
              </span>
              <span className={`shrink-0 ${typeColors[ev.type] ?? "text-foreground"}`}>
                [{ev.type}]
              </span>
              <span className="text-green-400 truncate">
                {ev.metadata?.action
                  ? String(ev.metadata.action)
                  : ev.metadata?.description
                    ? String(ev.metadata.description)
                    : JSON.stringify(ev.metadata).slice(0, 120)}
              </span>
              {ev.location && (
                <span className="text-muted-foreground shrink-0">@{ev.location}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
