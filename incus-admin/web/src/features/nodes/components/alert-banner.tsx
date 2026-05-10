import type { SystemAlert } from "@/features/nodes/api";
import { formatError } from "@/shared/lib/http";
import { AlertTriangle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useDismissAlertMutation,
  useSystemAlertsQuery,
} from "@/features/nodes/api";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

/**
 * AlertBanner — admin/nodes 顶部 banner，展示 watchdog 写入的不均衡告警。
 *
 * PLAN-039 / OPS-044：
 *   - 60s 轮询拉 active alerts
 *   - 点 "查看建议" 跳到 RebalancePanel（用户已在同页，仅滚动 + 展开提示）
 *   - 点 "忽略" 调 dismiss endpoint（step-up gated）
 *
 * 视觉值：bg-status-{warning,error}/8 边框 /30，与 RebalancePanel 同色系。
 */
export function AlertBanner() {
  const { t } = useTranslation();
  const { data } = useSystemAlertsQuery();
  const dismiss = useDismissAlertMutation();
  const alerts = data?.alerts ?? [];
  if (alerts.length === 0) return null;
  return (
    <div className="space-y-2">
      {alerts.map((a) => (
        <AlertCard
          key={a.id}
          alert={a}
          onDismiss={() =>
            dismiss.mutate(a.id, {
              onSuccess: () =>
                toast.success(
                  t("admin.alerts.dismissed", {
                    defaultValue: "告警 #{{id}} 已忽略",
                    id: a.id,
                  }),
                ),
              onError: (e) => toast.error(formatError(e)),
            })
          }
        />
      ))}
    </div>
  );
}

function AlertCard({
  alert,
  onDismiss,
}: {
  alert: SystemAlert;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const sev = alert.severity;
  const colorClass
    = sev === "error"
      ? "bg-status-error/8 border-status-error/30 text-status-error"
      : sev === "warning"
        ? "bg-status-warning/8 border-status-warning/30 text-status-warning"
        : "bg-surface-1 border-border text-text-secondary";
  const stats = alert.payload?.stats;

  return (
    <div className={cn("rounded-md border p-3 flex items-start gap-3", colorClass)} role="status">
      <AlertTriangle size={16} aria-hidden="true" className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="text-caption font-emphasis">
          {t("admin.alerts.imbalanceTitle", {
            defaultValue: "集群 {{cluster}} 持续不均衡",
            cluster: alert.cluster,
          })}
        </div>
        {stats && (
          <div className="text-caption text-text-secondary tabular-nums">
            {t("admin.alerts.imbalanceStats", {
              defaultValue: "mem stddev {{stddev}}% · 持续 {{ticks}} 次",
              stddev: Math.round(stats.stddev * 100),
              ticks: alert.payload.persistent_ticks ?? 0,
            })}
            {stats.hot_node && stats.cold_node && (
              <span className="ml-2 text-text-tertiary">
                · {t("admin.alerts.hotCold", {
                  defaultValue: "热点 {{hot}} ↔ 冷点 {{cold}}",
                  hot: stats.hot_node,
                  cold: stats.cold_node,
                })}
              </span>
            )}
          </div>
        )}
        <div className="text-caption text-text-tertiary">
          {t("admin.alerts.howTo", {
            defaultValue: "在下方『不均衡分析』卡片中查看建议并应用迁移。",
          })}
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onDismiss}
        aria-label={t("admin.alerts.dismiss", { defaultValue: "忽略" })}
      >
        <X size={12} aria-hidden="true" />
        {t("admin.alerts.dismiss", { defaultValue: "忽略" })}
      </Button>
    </div>
  );
}
