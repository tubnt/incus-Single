import type { MigrateMode } from "@/features/nodes/api";
import type { IncusInstance } from "@/features/vms/api";
import { ArrowRight, Server, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useJobQuery } from "@/features/jobs/api";
import { AIDiagnosePanel } from "@/features/jobs/components/ai-diagnose-panel";
import { JobProgress } from "@/features/jobs/components/job-progress";
import { useJobStream } from "@/features/jobs/use-job-stream";
import {
  useEnableStatefulBatchMutation,
  useMigrateBatchMutation,
} from "@/features/nodes/api";
import { NodePicker } from "@/features/nodes/node-picker";
import { Button } from "@/shared/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { formatError } from "@/shared/lib/http";

/**
 * MigrateBatchSheet — admin/vms 批量迁移右侧抽屉（PLAN-037 / OPS-040）。
 *
 * 三阶段状态机：
 *   1. plan：用户选目标节点（单一目标 / 平摊到多目标 by source）
 *   2. submitted：mutation 进行中
 *   3. job：JobProgress + SSE 跟进度
 *
 * 视觉值全部走 @theme：bg-status-warning/8 banner，border-border，font-mono 节点名。
 */
export function MigrateBatchSheet({
  open,
  onOpenChange,
  clusterName,
  selectedVMs,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clusterName: string;
  selectedVMs: IncusInstance[];
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<string>("");
  const [mode, setMode] = useState<MigrateMode>("auto");
  const [jobID, setJobID] = useState<number | null>(null);
  const migrate = useMigrateBatchMutation(clusterName);
  const enableStatefulBatch = useEnableStatefulBatchMutation();

  // SSE 进度
  const stream = useJobStream(jobID);
  const jobQuery = useJobQuery(stream.terminal != null ? jobID : null);
  const terminal = stream.terminal;

  // 当前选中 VM 的 source nodes 集合（前端预解析，executor 用于 per-source 并发限制）
  const sources = useMemo(() => {
    const s = new Set<string>();
    for (const vm of selectedVMs) {
      if (vm.location) s.add(vm.location);
    }
    return Array.from(s);
  }, [selectedVMs]);

  // PLAN-039 / OPS-043：计算"未启用 stateful"的 VM —— 这些不能 live 迁移
  const nonStateful = useMemo(
    () =>
      selectedVMs.filter((vm) => {
        const v = vm.config?.["migration.stateful"];
        return v !== "true" && v !== "1";
      }),
    [selectedVMs],
  );

  const blocked = target && sources.includes(target);

  const reset = () => {
    setTarget("");
    setJobID(null);
  };
  const close = () => {
    if (terminal != null || jobID == null) {
      reset();
      onOpenChange(false);
    } else {
      // 进行中关闭仅隐藏抽屉，不取消 job
      onOpenChange(false);
    }
  };

  const submit = () => {
    if (!target || blocked) return;
    migrate.mutate(
      {
        mode,
        items: selectedVMs.map((vm) => ({
          vm_name: vm.name,
          project: vm.project ?? "customers",
          source_node: vm.location ?? "",
          target_node: target,
          mode,
        })),
      },
      {
        onSuccess: (res) => setJobID(res.job_id),
        onError: (e) => toast.error(formatError(e)),
      },
    );
  };

  // QA-009 N-11 / PLAN-051 §2-G：跟踪上次启用 stateful 的失败状态。失败时
  // banner 显式提示"上次失败，请重试"，避免用户认为按钮没响应。
  const [statefulLastError, setStatefulLastError] = useState<string>("");

  const enableStateful = () => {
    if (nonStateful.length === 0) return;
    setStatefulLastError("");
    enableStatefulBatch.mutate(
      {
        cluster: clusterName,
        names: nonStateful.map((v) => v.name),
      },
      {
        onSuccess: (res) => {
          if (res.succeeded === res.total) {
            toast.success(
              t("admin.migrate.statefulEnabledAll", {
                defaultValue: "已为 {{n}} 台 VM 启用 stateful（已重启）",
                n: res.succeeded,
              }),
            );
          } else {
            toast.warning(
              t("admin.migrate.statefulEnabledPartial", {
                defaultValue: "{{ok}}/{{total}} 启用成功，{{fail}} 失败",
                ok: res.succeeded,
                total: res.total,
                fail: res.total - res.succeeded,
              }),
            );
            setStatefulLastError(
              t("admin.migrate.statefulPartialHint", {
                defaultValue: "部分失败，请检查日志后重试",
              }),
            );
          }
        },
        onError: (e) => {
          const msg = formatError(e);
          toast.error(msg);
          setStatefulLastError(msg);
        },
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent side="right" size="min(92vw, 36rem)">
        <SheetHeader>
          <SheetTitle>
            {t("admin.migrate.batchTitle", { defaultValue: "批量迁移" })}
            {" · "}
            <span className="font-mono text-text-tertiary">
              {t("admin.migrate.batchCount", {
                defaultValue: "{{n}} 台",
                n: selectedVMs.length,
              })}
            </span>
          </SheetTitle>
          <SheetDescription>
            {t("admin.migrate.batchDesc", {
              defaultValue:
                "冷迁移：每台 VM 会先停机再迁移到目标节点。每台耗时约 30s-2min。",
            })}
            {/* QA-009 N-21 / PLAN-051 §2-G：批量预估总耗时 */}
            {selectedVMs.length > 1 && (
              <span className="block mt-1 text-text-tertiary">
                {t("admin.migrate.batchEta", {
                  defaultValue: "预计总耗时 {{lo}}-{{hi}} 分钟",
                  lo: Math.ceil(selectedVMs.length * 30 / 60),
                  hi: Math.ceil(selectedVMs.length * 120 / 60),
                })}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        <SheetBody>
          {jobID == null && (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-surface-1 p-3 text-caption">
                <div className="text-text-secondary mb-1">
                  {t("admin.migrate.sources", { defaultValue: "来自节点：" })}
                </div>
                <div className="flex flex-wrap gap-1">
                  {sources.map((src) => (
                    <span
                      key={src}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill border border-border text-text-secondary font-mono text-tiny"
                    >
                      <Server size={10} aria-hidden="true" />
                      {src}
                    </span>
                  ))}
                  {sources.length === 0 && (
                    <span className="text-text-tertiary">
                      {t("admin.migrate.unknownSources", { defaultValue: "(未知，将探测)" })}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="migrate-target"
                  className="text-caption font-emphasis text-text-secondary"
                >
                  {t("admin.migrate.target", { defaultValue: "目标节点" })}
                </label>
                <NodePicker
                  clusterName={clusterName}
                  value={target}
                  onChange={setTarget}
                  excludeNodes={sources.length === 1 ? sources : []}
                  placeholder={t("admin.targetNode", { defaultValue: "目标节点" })}
                />
              </div>

              {/* PLAN-039 / OPS-043: mode 三选 */}
              <fieldset className="space-y-2">
                <legend className="text-caption font-emphasis text-text-secondary">
                  {t("admin.migrate.modeLabel", { defaultValue: "迁移模式" })}
                </legend>
                <div className="flex gap-1">
                  {(["auto", "live", "cold"] as MigrateMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={`flex-1 rounded-md border px-2 py-1.5 text-caption transition-colors ${
                        mode === m
                          ? "bg-surface-2 text-foreground border-ring"
                          : "bg-surface-1 border-border text-text-secondary hover:bg-surface-2"
                      }`}
                    >
                      <span className="font-emphasis">
                        {m === "auto" && t("admin.migrate.modeAuto", { defaultValue: "Auto" })}
                        {m === "live" && (
                          <>
                            <Zap size={10} aria-hidden="true" className="inline mr-1" />
                            Live
                          </>
                        )}
                        {m === "cold" && t("admin.migrate.modeCold", { defaultValue: "Cold" })}
                      </span>
                      <div className="text-tiny text-text-tertiary mt-0.5">
                        {m === "auto" && t("admin.migrate.modeAutoHint", { defaultValue: "按 VM 配置自选" })}
                        {m === "live" && t("admin.migrate.modeLiveHint", { defaultValue: "不停机" })}
                        {m === "cold" && t("admin.migrate.modeColdHint", { defaultValue: "停 30s+" })}
                      </div>
                    </button>
                  ))}
                </div>
              </fieldset>

              {/* PLAN-039 / OPS-043: 非 stateful banner（仅 live/auto 模式有意义） */}
              {nonStateful.length > 0 && mode !== "cold" && (
                <div className="rounded-md border border-status-warning/30 bg-status-warning/8 p-2 text-caption">
                  <div className="text-status-warning font-emphasis">
                    {t("admin.migrate.nonStatefulTitle", {
                      defaultValue: "{{n}} 台 VM 未启用 stateful",
                      n: nonStateful.length,
                    })}
                  </div>
                  <div className="text-status-warning mt-1">
                    {mode === "live"
                      ? t("admin.migrate.nonStatefulLive", {
                          defaultValue: "live 模式将对这些 VM 失败；先启用 stateful（每台重启 30s）。",
                        })
                      : t("admin.migrate.nonStatefulAuto", {
                          defaultValue: "auto 模式将对这些 VM 退化为 cold 迁移（停机 30s+）。",
                        })}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={enableStateful}
                    disabled={enableStatefulBatch.isPending}
                  >
                    {enableStatefulBatch.isPending
                      ? t("common.processing", { defaultValue: "处理中..." })
                      : t("admin.migrate.enableStateful", {
                          defaultValue: "为 {{n}} 台启用 stateful（重启）",
                          n: nonStateful.length,
                        })}
                  </Button>
                  {/* QA-009 N-11：失败时显式提示 */}
                  {statefulLastError && !enableStatefulBatch.isPending && (
                    <div className="mt-2 text-tiny text-status-error">
                      {statefulLastError}
                    </div>
                  )}
                </div>
              )}

              {blocked && (
                <div className="rounded-md border border-status-warning/30 bg-status-warning/8 p-2 text-caption text-status-warning">
                  {t("admin.migrate.sourceTargetSame", {
                    defaultValue: "目标节点在来源集合中，将跳过同节点 VM。",
                  })}
                </div>
              )}

              {mode === "cold" && (
                <div className="rounded-md border border-status-warning/30 bg-status-warning/8 p-2 text-caption text-status-warning">
                  {t("admin.migrate.coldNotice", {
                    defaultValue: "迁移期间 VM 会停机；并发上限：每个源节点 ≤ 2，全局 ≤ 4。",
                  })}
                </div>
              )}
              {mode === "live" && (
                <div className="rounded-md border border-status-success/30 bg-status-success/8 p-2 text-caption text-status-success">
                  {t("admin.migrate.liveNotice", {
                    defaultValue: "Live 迁移：VM 不停机；需要 stateful + 共享存储；并发上限同冷迁移。",
                  })}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={close}>
                  {t("common.cancel", { defaultValue: "取消" })}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={submit}
                  disabled={!target || migrate.isPending}
                >
                  <ArrowRight size={12} aria-hidden="true" />
                  {migrate.isPending
                    ? t("common.processing", { defaultValue: "处理中..." })
                    : t("admin.migrate.confirm", {
                        defaultValue: "迁移 {{n}} 台到 {{node}}",
                        n: selectedVMs.length,
                        node: target,
                      })}
                </Button>
              </div>
            </div>
          )}

          {jobID != null && (
            <div className="space-y-2">
              <div className="text-caption text-text-secondary">
                {t("admin.migrate.jobLabel", {
                  defaultValue: "Job #{{id}}",
                  id: jobID,
                })}
                {terminal && (
                  <span className="ml-2 text-text-tertiary">
                    ·
                    {" "}
                    {terminal === "succeeded"
                      ? t("admin.migrate.jobOK", { defaultValue: "已完成" })
                      : terminal === "partial"
                        ? t("admin.migrate.jobPartial", { defaultValue: "部分成功" })
                        : t("admin.migrate.jobFailed", { defaultValue: "失败" })}
                  </span>
                )}
              </div>
              <JobProgress steps={stream.steps} />
              {/* PLAN-038 / OPS-041 Phase C + pma-cr F4：批量迁移失败挂 AI 诊断 */}
              {(terminal === "failed" || terminal === "partial") && jobID && (
                <AIDiagnosePanel jobID={jobID} />
              )}
              {terminal != null && jobQuery.data?.job?.status && (
                <div className="flex justify-end pt-2">
                  <Button variant="primary" size="sm" onClick={close}>
                    {t("common.close", { defaultValue: "关闭" })}
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
