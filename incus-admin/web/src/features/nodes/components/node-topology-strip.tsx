import type { NodeTopologyEntry } from "@/features/nodes/api";
import { Server, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNodeTopologyQuery } from "@/features/nodes/api";
import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";

/**
 * NodeTopologyStrip — admin/nodes 顶部"集群分布概览"条带（PLAN-037 / OPS-040）。
 *
 * 把每个节点压缩成一个 chip：节点名 + VM 数 + mem 利用率条 + 维护态徽章。
 * 点击 chip 跳转到 admin/vms?cluster=X&node=Y（B2 已绑定 URL filter）。
 *
 * 视觉值全部走 @theme token：
 *   - chip 背景：bg-surface-1 / hover bg-surface-2（DESIGN.md §6 luminance step）
 *   - 边框：border-border（rgba(255,255,255,0.08)）
 *   - mem util bar：bg-status-success / warning / error，按阈值切换
 *   - 维护态徽章：bg-status-warning/8 text-status-warning（参考 node-join.tsx 既有用法）
 *   - 字体：text-caption（13px）和 text-tiny（10px），符合 DESIGN.md §3 Caption / Tiny
 */
export function NodeTopologyStrip({
  clusterName,
  onNodeClick,
}: {
  clusterName: string;
  onNodeClick?: (nodeName: string) => void;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useNodeTopologyQuery(clusterName);
  const nodes = data?.nodes ?? [];

  if (isLoading || nodes.length === 0) {
    return null;
  }

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server size={14} aria-hidden="true" className="text-text-tertiary" />
          <span className="text-caption font-emphasis text-text-secondary">
            {t("admin.nodes.topology.title", { defaultValue: "集群分布" })}
          </span>
          <span className="text-caption text-text-tertiary">
            ·
            {" "}
            {t("admin.nodes.topology.summary", {
              defaultValue: "{{nodes}} 节点 · {{vms}} 台 VM",
              nodes: nodes.length,
              vms: nodes.reduce((s, n) => s + n.vm_count, 0),
            })}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {nodes.map((n) => (
          <NodeChip key={n.server_name} node={n} onClick={() => onNodeClick?.(n.server_name)} />
        ))}
      </div>
    </Card>
  );
}

function NodeChip({
  node,
  onClick,
}: {
  node: NodeTopologyEntry;
  onClick?: () => void;
}) {
  const { t } = useTranslation();
  const util = node.mem_total > 0 ? (node.mem_used / node.mem_total) : 0;
  const utilPct = Math.round(util * 100);

  // mem util 阈值（与 RebalancePanel 同口径）：
  //   < 60% success / 60-85% warning / > 85% error
  const utilKind = util < 0.60 ? "success" : util < 0.85 ? "warning" : "error";

  const offline = node.status !== "Online" && node.status !== "Evacuated";
  const interactive = !!onClick;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={cn(
        "group/chip flex flex-col gap-1 px-3 py-2 rounded-md border border-border bg-surface-1",
        "min-w-input-narrow text-left",
        interactive ? "hover:bg-surface-2 transition-colors cursor-pointer" : "cursor-default",
        offline && "opacity-70",
      )}
      aria-label={t("admin.nodes.topology.chipAria", {
        defaultValue: "{{node}}：{{vms}} VM，内存使用 {{util}}%",
        node: node.server_name,
        vms: node.vm_count,
        util: utilPct,
      })}
    >
      <div className="flex items-center gap-2">
        <span className="text-caption font-mono font-emphasis text-foreground truncate">
          {node.server_name}
        </span>
        {node.maintenance && (
          <MaintBadge label={t("admin.nodes.topology.maint", { defaultValue: "维护" })} />
        )}
        {node.evacuated && (
          <MaintBadge label={t("admin.nodes.topology.evacuated", { defaultValue: "已疏散" })} />
        )}
      </div>
      <div className="flex items-center gap-2 text-tiny text-text-tertiary tabular-nums">
        <span>
          {t("admin.nodes.topology.vmCount", { defaultValue: "{{n}} VM", n: node.vm_count })}
        </span>
        <span aria-hidden>·</span>
        <span>
          {t("admin.nodes.topology.runningCount", {
            defaultValue: "{{n}} 运行",
            n: node.vm_running,
          })}
        </span>
      </div>
      <UtilBar pct={utilPct} kind={utilKind} />
      <div className="flex items-center gap-2 text-tiny text-text-quaternary tabular-nums">
        <span>
          {t("admin.nodes.topology.memUtil", {
            defaultValue: "内存 {{pct}}%",
            pct: utilPct,
          })}
        </span>
        {/* PLAN-039 / OPS-042 多维度信息：load + score。仅在数据非零时展示，
            避免新部署 / Incus API 短暂失败时显示误导性 0。 */}
        {node.cpu_total > 0 && (
          <>
            <span aria-hidden>·</span>
            <span title={t("admin.nodes.topology.loadHint", {
              defaultValue: "5min 平均负载 / CPU 核心数 = {{load}}/{{cpu}}",
              load: node.load_5min.toFixed(2),
              cpu: node.cpu_total,
            })}
            >
              {t("admin.nodes.topology.load", {
                defaultValue: "load {{v}}",
                v: node.load_5min.toFixed(2),
              })}
            </span>
          </>
        )}
        {node.score > 0 && (
          <>
            <span aria-hidden>·</span>
            <span
              title={t("admin.nodes.topology.scoreHint", {
                defaultValue: "调度得分（mem 0.5 + cpu 0.4 + disk 0.1）",
              })}
              className="font-emphasis text-text-tertiary"
            >
              {t("admin.nodes.topology.score", {
                defaultValue: "score {{v}}",
                v: node.score.toFixed(2),
              })}
            </span>
          </>
        )}
      </div>
    </button>
  );
}

function UtilBar({ pct, kind }: { pct: number; kind: "success" | "warning" | "error" }) {
  const colorClass
    = kind === "success" ? "bg-status-success"
      : kind === "warning" ? "bg-status-warning"
        : "bg-status-error";
  const safe = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-1 w-full rounded-pill bg-surface-2 overflow-hidden">
      <div
        className={cn("h-full rounded-pill transition-all", colorClass)}
        style={{ width: `${safe}%` }}
        aria-hidden
      />
    </div>
  );
}

function MaintBadge({ label }: { label: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-1.5 rounded-pill border",
      "bg-status-warning/8 border-status-warning/30 text-status-warning",
      "text-tiny font-emphasis",
    )}
    >
      <Wrench size={10} aria-hidden="true" />
      {label}
    </span>
  );
}
