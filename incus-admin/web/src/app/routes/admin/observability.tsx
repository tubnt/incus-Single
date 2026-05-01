import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Pause, Play, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { StatusDot } from "@/shared/components/ui/status";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/admin/observability")({
  component: ObservabilityPage,
});

interface Dashboard {
  id: string;
  label: string;
  url: string;
  desc: string;
  embeddable: boolean;
}

const DASHBOARDS: Dashboard[] = [
  { id: "grafana", label: "Grafana", url: "http://10.0.20.1:3000", desc: "指标面板（CPU/RAM/Disk/Network）—— HTTP，仅新窗口", embeddable: false },
  { id: "prometheus", label: "Prometheus", url: "http://10.0.20.1:9090", desc: "指标查询与探索 —— HTTP，仅新窗口", embeddable: false },
  { id: "alertmanager", label: "Alertmanager", url: "http://10.0.20.1:9093", desc: "告警路由与抑制 —— HTTP，仅新窗口", embeddable: false },
  { id: "ceph", label: "Ceph Dashboard", url: "https://10.0.20.1:8443", desc: "Ceph 存储管理（需 VPN）", embeddable: true },
];

function ObservabilityPage() {
  const { t } = useTranslation();
  const [active, setActive] = useState<string | null>(null);
  const current = active ? DASHBOARDS.find((d) => d.id === active) : null;

  return (
    <PageShell>
      <PageHeader
        title={t("admin.observability.title")}
        description={t("admin.observability.description", {
          defaultValue: "外部可观测性面板（Grafana / Prometheus / Alertmanager / Ceph）+ 实时事件流。",
        })}
      />
      <PageContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {DASHBOARDS.map((d) => (
            <Card key={d.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-strong">{d.label}</h3>
                  <div className="flex gap-2">
                    {d.embeddable ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setActive(active === d.id ? null : d.id)}
                      >
                        {active === d.id
                          ? t("admin.observability.close")
                          : t("admin.observability.embed")}
                      </Button>
                    ) : null}
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 h-7 rounded-md px-2.5 text-xs font-emphasis bg-surface-2 text-text-tertiary hover:bg-surface-3 transition-colors"
                    >
                      <ExternalLink size={12} aria-hidden="true" />
                      {t("admin.observability.open")}
                    </a>
                  </div>
                </div>
                <p className="text-caption text-muted-foreground">{d.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {current && current.embeddable ? (
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border flex-row items-center justify-between">
              <CardTitle className="text-h3">{current.label}</CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setActive(null)}>
                {t("admin.observability.close")}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <iframe src={current.url} className="w-full h-iframe-tall" title={active!} />
            </CardContent>
          </Card>
        ) : null}

        <EventStream />

        <Alert variant="info">
          <AlertDescription>
            <span className="font-strong">
              {t("admin.observability.accessNoteTitle")}
            </span>
            <br />
            {t("admin.observability.accessNoteBody")}
          </AlertDescription>
        </Alert>
      </PageContent>
    </PageShell>
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
    lifecycle: "text-accent",
    operation: "text-text-tertiary",
    logging: "text-status-warning",
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <CardTitle className="text-h3">
            {t("admin.observability.eventStream")}
          </CardTitle>
          <StatusDot
            status={connected ? "success" : "error"}
            label={
              connected
                ? t("admin.observability.connected")
                : t("admin.observability.disconnected")
            }
          />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPaused(!paused)}
          >
            {paused
              ? <><Play size={12} aria-hidden="true" /> {t("admin.observability.resume")}</>
              : <><Pause size={12} aria-hidden="true" /> {t("admin.observability.pause")}</>}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEvents([])}>
            <Trash2 size={12} aria-hidden="true" />
            {t("admin.observability.clear")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-2 max-h-80 overflow-y-auto bg-surface-marketing">
        {events.length === 0 ? (
          <div className="text-center text-caption text-text-tertiary py-4">
            {connected
              ? t("admin.observability.waitingEvents")
              : t("admin.observability.connecting")}
          </div>
        ) : (
          events.map((ev, i) => (
            <div
              key={`${ev.timestamp}-${i}`}
              className="flex gap-2 text-caption font-mono py-0.5 hover:bg-white/[0.04]"
            >
              <span className="text-text-tertiary shrink-0">
                {new Date(ev.timestamp).toLocaleTimeString()}
              </span>
              <span className={cn("shrink-0", typeColors[ev.type] ?? "text-foreground")}>
                [{ev.type}]
              </span>
              <span className="text-status-success-soft truncate">
                {ev.metadata?.action
                  ? String(ev.metadata.action)
                  : ev.metadata?.description
                    ? String(ev.metadata.description)
                    : JSON.stringify(ev.metadata).slice(0, 120)}
              </span>
              {ev.location ? (
                <span className="text-text-tertiary shrink-0">@{ev.location}</span>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
