import type {ClusterNode} from "@/features/nodes/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useJobQuery } from "@/features/jobs/api";
import { JobProgress } from "@/features/jobs/components/job-progress";
import { useJobStream } from "@/features/jobs/use-job-stream";
import {

  clusterEnvScriptURL,
  nodeKeys,
  useAdminNodeDetailQuery,
  useAdminNodesQuery,
  useNodeEvacuateMutation,
  useNodeMaintenanceMutation,
  useNodeRestoreMutation,
  useRemoveNodeMutation
} from "@/features/nodes/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Button, buttonVariants } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { StatusPill } from "@/shared/components/ui/status";
import { queryClient } from "@/shared/lib/query-client";

export const Route = createFileRoute("/admin/nodes")({
  component: NodesPage,
});

function NodesPage() {
  const { t } = useTranslation();
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<string>("");

  const { data, isLoading } = useAdminNodesQuery();

  const nodes = data?.nodes ?? [];

  return (
    <PageShell>
      <PageHeader
        title={t("admin.nodes.title", "集群节点")}
        actions={
          <div className="flex gap-2">
            <Link
              to="/admin/node-join"
              className={buttonVariants({ variant: "primary", size: "sm" })}
            >
              {t("admin.nodes.joinWizard", "+ 加入节点")}
            </Link>
            {/* OPS-024 C2：下载 cluster-env.sh（路由 step-up gated，浏览器
                直链触发新 OIDC round-trip 是预期；下载后 ops 在 cluster
                bootstrap 节点放到 cluster/configs/ 覆盖原 file） */}
            {nodes.length > 0
              ? (
                  <a
                    href={clusterEnvScriptURL(nodes[0]!.cluster)}
                    download
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    {t("admin.nodes.downloadEnvScript", "下载 cluster-env.sh")}
                  </a>
                )
              : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                queryClient.invalidateQueries({ queryKey: nodeKeys.all })
              }
            >
              {t("common.refresh", "刷新")}
            </Button>
          </div>
        }
      />
      <PageContent>
        {isLoading ? (
          <div className="text-muted-foreground">
            {t("common.loading", "加载中...")}
          </div>
        ) : nodes.length === 0 ? (
          <EmptyState
            title={t("admin.nodes.empty", "未发现集群节点。请先添加集群连接。")}
          />
        ) : (
          <div className="space-y-3">
            {nodes.map((node) => (
              <NodeCard
                key={`${node.cluster}-${node.server_name}`}
                node={node}
                isSelected={
                  selectedNode === node.server_name &&
                  selectedCluster === node.cluster
                }
                onSelect={() => {
                  if (
                    selectedNode === node.server_name &&
                    selectedCluster === node.cluster
                  ) {
                    setSelectedNode(null);
                  } else {
                    setSelectedNode(node.server_name);
                    setSelectedCluster(node.cluster);
                  }
                }}
              />
            ))}
          </div>
        )}
      </PageContent>
    </PageShell>
  );
}

function NodeCard({
  node,
  isSelected,
  onSelect,
}: {
  node: ClusterNode;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const statusKind =
    node.status === "Online"
      ? "success"
      : node.status === "Evacuated"
        ? "warning"
        : "error";

  return (
    <Card className="overflow-x-auto">
      <button
        type="button"
        onClick={onSelect}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-2 transition-colors text-left"
      >
        <div className="flex items-center gap-4">
          <div>
            <div className="font-strong">{node.server_name}</div>
            <div className="text-xs text-muted-foreground">
              {node.cluster} &middot; {node.url}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {node.roles && node.roles.length > 0 && (
            <div className="flex gap-1">
              {node.roles.map((role) => (
                <span
                  key={role}
                  className="px-1.5 py-0.5 text-xs bg-surface-2 rounded"
                >
                  {role}
                </span>
              ))}
            </div>
          )}
          <StatusPill status={statusKind}>{node.status}</StatusPill>
          <span className="text-xs text-muted-foreground">
            {isSelected ? "▲" : "▼"}
          </span>
        </div>
      </button>

      {isSelected && (
        <NodeDetail
          nodeName={node.server_name}
          clusterName={node.cluster}
          nodeStatus={node.status}
        />
      )}
    </Card>
  );
}

function NodeDetail({
  nodeName,
  clusterName,
  nodeStatus,
}: {
  nodeName: string;
  clusterName: string;
  nodeStatus: string;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [removeJobId, setRemoveJobId] = useState<number | null>(null);

  const { data, isLoading } = useAdminNodeDetailQuery(clusterName, nodeName);
  const evacuateMutation = useNodeEvacuateMutation(clusterName, nodeName);
  const restoreMutation = useNodeRestoreMutation(clusterName, nodeName);
  const removeMutation = useRemoveNodeMutation(clusterName);
  const maintenanceMutation = useNodeMaintenanceMutation(clusterName, nodeName);

  // PLAN-026 remove SSE 监听
  const removeStream = useJobStream(removeJobId);
  const removeJobQuery = useJobQuery(removeStream.terminal != null ? removeJobId : null);
  useEffect(() => {
    if (removeStream.terminal === "succeeded" && removeJobQuery.data?.job?.status === "succeeded") {
      toast.success(t("admin.nodes.remove.done", { defaultValue: "节点 {{name}} 已移除", name: nodeName }));
      setRemoveJobId(null);
    }
    if (removeStream.terminal === "failed" || removeStream.terminal === "partial") {
      const lastFailed = removeStream.steps.slice().reverse().find((s) => s.status === "failed");
      toast.error(lastFailed?.detail ?? t("admin.nodes.remove.failed", "移除失败"));
    }
  }, [removeStream.terminal, removeStream.steps, removeJobQuery.data, nodeName, t]);

  const instances = data?.instances ?? [];
  const nodeInfo = data?.node as Record<string, unknown> | undefined;

  return (
    <div className="border-t border-border bg-surface-2/40 p-4">
      {isLoading ? (
        <div className="text-sm text-muted-foreground">
          {t("common.loading", "加载中...")}
        </div>
      ) : (
        <div className="space-y-4">
          {/* 节点信息 */}
          {nodeInfo && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <InfoItem
                label={t("admin.nodes.arch", "架构")}
                value={String(nodeInfo.architecture ?? "-")}
              />
              <InfoItem
                label={t("admin.nodes.status", "状态")}
                value={String(nodeInfo.status ?? "-")}
              />
              <InfoItem
                label={t("admin.nodes.message", "消息")}
                value={String(nodeInfo.message ?? "-")}
              />
              <InfoItem
                label={t("admin.nodes.roles", "角色")}
                value={
                  Array.isArray(nodeInfo.roles)
                    ? (nodeInfo.roles as string[]).join(", ") || "-"
                    : "-"
                }
              />
            </div>
          )}

          {/* 维护模式操作 */}
          <div className="flex items-center gap-3">
            {nodeStatus === "Online" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const ok = await confirm({
                    title: t("deleteConfirm.evacuateTitle"),
                    message: t("deleteConfirm.evacuateMessage", { node: nodeName }),
                    destructive: true,
                  });
                  if (ok) evacuateMutation.mutate();
                }}
                disabled={evacuateMutation.isPending}
              >
                {evacuateMutation.isPending
                  ? t("admin.evacuating")
                  : t("admin.enterMaintenance")}
              </Button>
            ) : nodeStatus === "Evacuated" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => restoreMutation.mutate()}
                disabled={restoreMutation.isPending}
              >
                {restoreMutation.isPending
                  ? t("admin.nodes.restoring", "恢复中...")
                  : t("admin.nodes.restore", "恢复节点")}
              </Button>
            ) : null}

            {(evacuateMutation.isError || restoreMutation.isError) && (
              <span className="text-xs text-status-error">
                {(
                  (evacuateMutation.error ?? restoreMutation.error) as Error
                )?.message ?? "操作失败"}
              </span>
            )}

            {/* OPS-024 D2 软维护切换：scheduler.instance = manual / all */}
            {(() => {
              const sched = (() => {
                if (!nodeInfo) return "all";
                const cfg = nodeInfo.config as Record<string, string> | undefined;
                return (cfg?.["scheduler.instance"] ?? "all").toLowerCase();
              })();
              const isMaint = sched === "manual";
              return (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={maintenanceMutation.isPending}
                  onClick={async () => {
                    const ok = await confirm({
                      title: isMaint
                        ? t("admin.nodes.maintenance.exitTitle", "退出维护模式")
                        : t("admin.nodes.maintenance.enterTitle", "进入维护模式"),
                      message: isMaint
                        ? t("admin.nodes.maintenance.exitMessage", {
                            defaultValue: "恢复 {{name}} 的常规调度（新建 VM 可放置到本节点）。",
                            name: nodeName,
                          })
                        : t("admin.nodes.maintenance.enterMessage", {
                            defaultValue: "把 {{name}} 设为维护模式：新建 VM 不再放置到此节点，但已有 VM 保留。要 evacuate 现有 VM 请用上方按钮。",
                            name: nodeName,
                          }),
                    });
                    if (!ok) return;
                    maintenanceMutation.mutate(!isMaint, {
                      onError: (err) => toast.error((err as Error).message),
                    });
                  }}
                >
                  {maintenanceMutation.isPending
                    ? t("common.processing", "处理中...")
                    : isMaint
                      ? t("admin.nodes.maintenance.exit", "退出维护")
                      : t("admin.nodes.maintenance.enter", "维护模式")}
                </Button>
              );
            })()}

            {/* PLAN-026 移除节点：destructive，先 evacuate VM 再 leave Incus / Ceph */}
            {removeJobId == null && (
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  const ok = await confirm({
                    title: t("admin.nodes.remove.title", "移除节点"),
                    message: t("admin.nodes.remove.message", {
                      defaultValue: "确认从集群移除 {{name}}？将先 evacuate 所有 VM、移除 Ceph OSD 后再退出。该操作不可回滚。",
                      name: nodeName,
                    }),
                    destructive: true,
                    typeToConfirm: nodeName,
                    typeToConfirmLabel: t("admin.nodes.remove.typeNodeName", {
                      defaultValue: "请输入节点名 {{name}} 以确认",
                      name: nodeName,
                    }),
                  });
                  if (!ok) return;
                  removeMutation.mutate(
                    { nodeName },
                    {
                      onSuccess: (res) => {
                        if (res.job_id) {
                          setRemoveJobId(res.job_id);
                          toast.info(
                            t("admin.nodes.remove.enqueued", {
                              defaultValue: "已入队 job #{{id}}",
                              id: res.job_id,
                            }),
                          );
                        }
                      },
                      onError: (err) => toast.error((err as Error).message),
                    },
                  );
                }}
                disabled={removeMutation.isPending}
              >
                {removeMutation.isPending
                  ? t("common.processing", "处理中...")
                  : t("admin.nodes.remove.button", "移除节点")}
              </Button>
            )}
          </div>

          {/* 移除进度 */}
          {removeJobId != null && (
            <div className="space-y-2">
              <h4 className="text-sm font-strong">
                {t("admin.nodes.remove.progressTitle", "移除节点进度")}
              </h4>
              <JobProgress steps={removeStream.steps} />
            </div>
          )}

          {/* 实例列表 */}
          <div>
            <h4 className="text-sm font-strong mb-2">
              {t("admin.nodes.instances", "节点实例")} ({instances.length})
            </h4>
            {instances.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                {t("admin.nodes.noInstances", "该节点暂无实例")}
              </div>
            ) : (
              <div className="border border-border rounded overflow-hidden">
                <table className="w-full text-xs [&_tbody>tr]:transition-colors [&_tbody>tr]:hover:bg-surface-1">
                  <thead className="bg-surface-1 border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-1.5 text-label font-emphasis text-text-tertiary">
                        {t("admin.nodes.instanceName", "实例名")}
                      </th>
                      <th className="text-left px-3 py-1.5 text-label font-emphasis text-text-tertiary">
                        {t("admin.nodes.instanceType", "类型")}
                      </th>
                      <th className="text-left px-3 py-1.5 text-label font-emphasis text-text-tertiary">
                        {t("admin.nodes.instanceStatus", "状态")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {instances.map((inst) => (
                      <tr
                        key={inst.name}
                        className="border-t border-border"
                      >
                        <td className="px-3 py-1.5 font-mono">
                          {inst.name}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {inst.type}
                        </td>
                        <td className="px-3 py-1.5">
                          <StatusPill
                            status={inst.status === "Running" ? "success" : "disabled"}
                          >
                            {inst.status}
                          </StatusPill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-emphasis">{value}</div>
    </div>
  );
}
