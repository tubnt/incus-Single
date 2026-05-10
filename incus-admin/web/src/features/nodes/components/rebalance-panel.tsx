import type { ImbalanceSuggestion } from "@/features/nodes/api";
import { formatError } from "@/shared/lib/http";
import { ArrowRight, Scale, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useImbalanceSuggestionsQuery,
  useMigrateBatchMutation,
} from "@/features/nodes/api";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { cn } from "@/shared/lib/utils";

/**
 * RebalancePanel — admin/nodes 底部 / 独立子区，按需展开"当前不均衡建议"。
 *
 * 设计要点（PLAN-037 / OPS-040）：
 *   - 默认折叠（懒加载查询，不轮询；点击 Show 才拉），避免 30s 后台刷新。
 *   - 展开后展示 stats banner（mean / stddev / hot vs cold）+ 建议表格。
 *   - "应用全部" 调 vms:migrate-batch 一次性提交，返回 job_id 后通过 toast 直接
 *     提示"job #N 入队"；进度由 admin/jobs 页查看（避免在本面板内重新挂 SSE）。
 *
 * 视觉值全部走 @theme：bg-surface-1 / text-status-{success,warning,error} /
 * border-border / rounded-md / text-caption / text-tiny。
 */
export function RebalancePanel({ clusterName }: { clusterName: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data, isLoading, refetch } = useImbalanceSuggestionsQuery(clusterName, open);
  const migrate = useMigrateBatchMutation(clusterName);
  const confirm = useConfirm();

  const stats = data?.stats;
  const suggestions = data?.suggestions ?? [];

  const applyAll = async () => {
    if (suggestions.length === 0) return;
    const ok = await confirm({
      title: t("admin.nodes.rebalance.confirmTitle", { defaultValue: "应用所有建议？" }),
      message: t("admin.nodes.rebalance.confirmMessage", {
        defaultValue: "将批量冷迁移 {{count}} 台 VM。每台迁移期间会停机 30s-2min（取决于内存大小）。",
        count: suggestions.length,
      }),
      destructive: true,
    });
    if (!ok) return;
    migrate.mutate(
      {
        items: suggestions.map((s) => ({
          vm_name: s.vm_name,
          project: s.project,
          source_node: s.source_node,
          target_node: s.target_node,
        })),
      },
      {
        onSuccess: (res) => {
          toast.success(
            t("admin.nodes.rebalance.enqueued", {
              defaultValue: "已入队 job #{{id}}（{{count}} 台）",
              id: res.job_id,
              count: suggestions.length,
            }),
          );
          refetch();
        },
        onError: (e) => toast.error(formatError(e)),
      },
    );
  };

  return (
    <Card className="p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Scale size={14} aria-hidden="true" className="text-text-tertiary" />
          <span className="text-caption font-emphasis text-text-secondary">
            {t("admin.nodes.rebalance.title", { defaultValue: "不均衡分析" })}
          </span>
          <span className="text-caption text-text-tertiary">
            {open
              ? t("common.collapse", { defaultValue: "收起" })
              : t("admin.nodes.rebalance.expand", { defaultValue: "展开（按需计算）" })}
          </span>
        </div>
        <span className="text-caption text-text-tertiary">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {isLoading && (
            <div className="text-caption text-text-tertiary">
              {t("common.loading", { defaultValue: "加载中..." })}
            </div>
          )}

          {!isLoading && stats && <StatsBanner stats={stats} />}

          {!isLoading && stats && !stats.imbalanced && (
            <div className="text-caption text-text-tertiary">
              {t("admin.nodes.rebalance.balanced", {
                defaultValue: "集群当前分布均衡，没有迁移建议。",
              })}
            </div>
          )}

          {!isLoading && suggestions.length > 0 && (
            <>
              <SuggestionsList items={suggestions} />
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={applyAll}
                  disabled={migrate.isPending}
                >
                  <Sparkles size={12} aria-hidden="true" />
                  {migrate.isPending
                    ? t("common.processing", { defaultValue: "处理中..." })
                    : t("admin.nodes.rebalance.applyAll", {
                        defaultValue: "应用全部 ({{n}})",
                        n: suggestions.length,
                      })}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function StatsBanner({
  stats,
}: {
  stats: {
    mean_util: number;
    stddev: number;
    max_diff: number;
    hot_node?: string;
    cold_node?: string;
    imbalanced: boolean;
  };
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "p-2 rounded-md border text-caption",
        stats.imbalanced
          ? "bg-status-warning/8 border-status-warning/30 text-status-warning"
          : "bg-surface-1 border-border text-text-secondary",
      )}
      role="status"
    >
      <span className="font-emphasis">
        {t("admin.nodes.rebalance.statsLabel", { defaultValue: "节点 mem 利用率：" })}
      </span>
      <span className="ml-1 tabular-nums">
        {t("admin.nodes.rebalance.stats", {
          defaultValue: "均值 {{mean}}% · 标准差 {{stddev}}% · 最大差 {{diff}}%",
          mean: Math.round(stats.mean_util * 100),
          stddev: Math.round(stats.stddev * 100),
          diff: Math.round(stats.max_diff * 100),
        })}
      </span>
      {stats.hot_node && stats.cold_node && (
        <span className="ml-2 text-text-tertiary">
          ·
          {" "}
          {t("admin.nodes.rebalance.hotCold", {
            defaultValue: "热点 {{hot}} ↔ 冷点 {{cold}}",
            hot: stats.hot_node,
            cold: stats.cold_node,
          })}
        </span>
      )}
    </div>
  );
}

function SuggestionsList({ items }: { items: ImbalanceSuggestion[] }) {
  const { t } = useTranslation();
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <table className="w-full text-caption">
        <thead className="bg-surface-1 border-b border-border">
          <tr>
            <th className="text-left px-3 py-1.5 text-label font-emphasis text-text-tertiary">
              {t("vm.name", { defaultValue: "VM 名称" })}
            </th>
            <th className="text-left px-3 py-1.5 text-label font-emphasis text-text-tertiary">
              {t("admin.nodes.rebalance.move", { defaultValue: "迁移方向" })}
            </th>
            <th className="text-left px-3 py-1.5 text-label font-emphasis text-text-tertiary">
              {t("admin.nodes.rebalance.reason", { defaultValue: "原因" })}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr
              key={`${s.project}/${s.vm_name}`}
              className="border-t border-border hover:bg-surface-1 transition-colors"
            >
              <td className="px-3 py-1.5 font-mono text-foreground">{s.vm_name}</td>
              <td className="px-3 py-1.5 text-text-secondary">
                <span className="font-mono">{s.source_node}</span>
                <ArrowRight
                  size={10}
                  aria-hidden="true"
                  className="inline mx-1 text-text-quaternary"
                />
                <span className="font-mono text-foreground">{s.target_node}</span>
              </td>
              <td className="px-3 py-1.5 text-text-tertiary truncate max-w-sheet-md">
                {s.reason}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
