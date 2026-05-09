import type {AIDiagnosis} from "@/features/nodes/api";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { aiKeys, useAIDiagnoseQuery } from "@/features/nodes/api";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { classifyAIError } from "@/shared/lib/ai-error";
import { cn } from "@/shared/lib/utils";

/**
 * AIDiagnosePanel — PLAN-038 / OPS-041 Phase C Tier 3。
 *
 * 挂在失败 / partial 的 JobProgress 旁；折叠默认（不自动调，避免每次失败都付费）。
 * 运维点 "AI 诊断" 才触发：把 job stderr + 失败 step 送 LLM，拿回结构化建议。
 *
 * pma-cr 修复：
 *   - F2: useQuery + jobID 为 key 缓存 5min；折叠/展开/重渲染不重复付费
 *   - F6: 错误按 disabled/timeout/rate_limit/schema/other 分类，i18n 文案
 *
 * 视觉值全部 @theme：bg-status-error/4 border-status-error/30（DESIGN.md token）。
 */
export function AIDiagnosePanel({
  jobID,
  className,
}: {
  jobID: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ai = useAIDiagnoseQuery(jobID);
  const qc = useQueryClient();

  const errView = ai.isError ? classifyAIError((ai.error as Error)?.message, "jobs.ai") : null;
  const aiDisabled = errView?.category === "disabled";

  const trigger = () => {
    if (!open) setOpen(true);
    if (!ai.data && !ai.isFetching) ai.refetch();
  };

  // pma-cr F2：rerun 显式 invalidate cache，让用户主动付第二次费时是有意为之
  const rerun = () => {
    qc.removeQueries({ queryKey: aiKeys.diagnose(jobID) });
    ai.refetch();
  };

  return (
    <Card className={cn("p-3 border-status-error/30 bg-status-error/4", className)}>
      <button
        type="button"
        onClick={trigger}
        className="flex items-center gap-2 w-full text-left"
        disabled={aiDisabled}
      >
        {open
          ? <ChevronDown size={14} aria-hidden="true" className="text-text-tertiary" />
          : <ChevronRight size={14} aria-hidden="true" className="text-text-tertiary" />}
        <Bot size={14} aria-hidden="true" className="text-status-error" />
        <span className="text-caption font-emphasis text-foreground">
          {t("jobs.ai.diagnoseTitle")}
        </span>
        <span className="ml-auto text-tiny text-text-tertiary">
          {ai.isFetching
            ? t("common.processing")
            : ai.data
              ? t("jobs.ai.expand")
              : aiDisabled
                ? t("jobs.ai.disabled")
                : t("jobs.ai.runAnalysis")}
        </span>
      </button>

      {open && ai.data && (
        <div className="mt-3 space-y-3">
          <DiagnosisRow label={t("jobs.ai.category")} value={ai.data.diagnosis.category} mono />
          <DiagnosisRow label={t("jobs.ai.rootCause")} value={ai.data.diagnosis.root_cause} />

          {ai.data.diagnosis.suggested_fix_steps.length > 0 && (
            <div className="space-y-1">
              <div className="text-tiny font-emphasis text-text-tertiary">
                {t("jobs.ai.fixSteps")}
              </div>
              <ol className="list-decimal pl-4 space-y-1.5 text-caption text-text-secondary">
                {ai.data.diagnosis.suggested_fix_steps.map((s, i) => (
                  <li key={i}>
                    <div>{s.step}</div>
                    {s.command_template && (
                      <code className="block mt-0.5 px-2 py-1 rounded-md bg-surface-2 text-text-secondary font-mono text-tiny">
                        {s.command_template}
                      </code>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {ai.data.diagnosis.requires_manual && (
            <DiagnosisRow label={t("jobs.ai.manual")} value={ai.data.diagnosis.requires_manual} />
          )}

          <div className="text-tiny text-text-tertiary tabular-nums">
            {t("jobs.ai.safeRetry", { v: ai.data.diagnosis.safe_to_auto_retry ? "✓" : "✗" })}
            {" · "}
            <span>provider={ai.data.provider} · model={ai.data.model}</span>
          </div>

          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={rerun} disabled={ai.isFetching}>
              {t("jobs.ai.rerun")}
            </Button>
          </div>
        </div>
      )}

      {/* pma-cr F6：raw error 改 i18n 分类文案 */}
      {errView && !aiDisabled && (
        <div className="mt-2 text-tiny text-status-error">
          {t(errView.i18nKey, { msg: errView.rawMessage })}
        </div>
      )}
    </Card>
  );
}

function DiagnosisRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-tiny font-emphasis text-text-tertiary">{label}</span>
      <span className={cn("text-caption text-text-secondary", mono && "font-mono")}>{value}</span>
    </div>
  );
}

// 仅类型借用避免循环：从同位置 re-export 简单
export type { AIDiagnosis };
