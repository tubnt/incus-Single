import type {ColumnDef, RowSelectionState, SortingState} from "@tanstack/react-table";
import type {IncusInstance} from "@/features/vms/api";
import type {VMSheetKind} from "@/features/vms/components/vm-action-sheets";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Play, RefreshCw, Square, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  extractIP,
  useBatchVMMutation,
  useClusterVMsQuery,
} from "@/features/vms/api";
import { MigrateBatchSheet } from "@/features/vms/components/migrate-batch-sheet";
import { VMActionSheets } from "@/features/vms/components/vm-action-sheets";
import { VMPeekPanel } from "@/features/vms/components/vm-peek-panel";
import { VMRowActions } from "@/features/vms/components/vm-row-actions";
import { Badge } from "@/shared/components/ui/badge";
import { BatchToolbar } from "@/shared/components/ui/batch-toolbar";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { DataTable } from "@/shared/components/ui/data-table";
import { ErrorState } from "@/shared/components/ui/empty-state";
import { StatusPill, vmStatusToKind } from "@/shared/components/ui/status";
import { formatError } from "@/shared/lib/http";
import { formatVmStatus } from "@/shared/lib/status-i18n";
import { cn, formatTime } from "@/shared/lib/utils";

interface ClusterVMsTableProps {
  clusterName: string;
  displayName: string;
  /**
   * PLAN-037 / OPS-040：当前 location 过滤值（来自 admin/vms?node= URL）。
   * 空字符串 → 不过滤。父组件负责 URL 同步；本组件只负责把过滤值消费 + 暴露
   * 当前可见 node 列表给 Select。
   */
  nodeFilter?: string;
  onNodeFilterChange?: (node: string) => void;
}

export function ClusterVMsTable({
  clusterName,
  displayName,
  nodeFilter = "",
  onNodeFilterChange,
}: ClusterVMsTableProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { data, isLoading, isError, error } = useClusterVMsQuery(clusterName, 15_000);
  const allVMs = useMemo(() => data?.vms ?? [], [data]);

  const [sheetKind, setSheetKind] = useState<VMSheetKind | null>(null);
  const [sheetVM, setSheetVM] = useState<IncusInstance | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  // PLAN-037 / OPS-040：批量迁移抽屉
  const [migrateOpen, setMigrateOpen] = useState(false);
  /** PLAN-024.C: 行点击的 inline detail peek，不打断列表浏览。 */
  const [peekVM, setPeekVM] = useState<IncusInstance | null>(null);

  // node filter 应用到行数据；列表 + 排序由 DataTable 内部处理
  const vms = useMemo(() => {
    if (!nodeFilter) return allVMs;
    return allVMs.filter((v) => v.location === nodeFilter);
  }, [allVMs, nodeFilter]);

  // 全部节点（不过滤），供 Select 选项使用
  const allNodes = useMemo(() => {
    const set = new Set<string>();
    for (const v of allVMs) {
      if (v.location) set.add(v.location);
    }
    return Array.from(set).sort();
  }, [allVMs]);

  const batchMutation = useBatchVMMutation();

  const isStale = data?.stale;

  const selectedNames = useMemo(
    () => Object.entries(rowSelection).filter(([, v]) => v).map(([k]) => k),
    [rowSelection],
  );
  // Session-2 F-68 / PLAN-051 §2-K：用 Set 避免 N×M 嵌套 includes —— N=200 / M=50
  // 每次勾选 10000 string compare → 1 次 hash 查询。
  const selectedNamesSet = useMemo(() => new Set(selectedNames), [selectedNames]);

  const clearSelection = () => setRowSelection({});

  const runBatch = async (action: "delete" | "start" | "stop" | "restart") => {
    if (selectedNames.length === 0) return;

    if (action === "delete") {
      const ok = await confirm({
        title: t("vm.batchDeleteTitle", { defaultValue: "批量删除 VM？" }),
        message: t("vm.batchDeleteMessage", {
          defaultValue:
            "将永久删除 {{count}} 台 VM 及其磁盘数据。此操作不可撤销。\n请输入 DELETE 以确认。",
          count: selectedNames.length,
        }),
        destructive: true,
        typeToConfirm: "DELETE",
        typeToConfirmLabel: t("confirmDialog.typeDelete", {
          defaultValue: "请输入 DELETE 以确认",
        }),
      });
      if (!ok) return;
    }

    // 跨 project 的 VM 不能塞进同一个 batch（后端按 request.project 套到所有 names）。
    // 按 project 分组分别提交，最后聚合结果。这样选 5 台跨 customers/admin 项目的
    // VM 也能正确处理而不是无脑用第一台的 project 误伤其他。
    const groups = new Map<string, string[]>();
    for (const name of selectedNames) {
      const proj = vms.find((v) => v.name === name)?.project ?? "default";
      const list = groups.get(proj) ?? [];
      list.push(name);
      groups.set(proj, list);
    }

    const summaries: Array<{ ok: number; failed: Array<{ key: string; error: string }> }> = [];
    let pending = groups.size;
    for (const [project, names] of groups) {
      batchMutation.mutate(
        { names, cluster: clusterName, project, action },
        {
          onSuccess: (res) => {
            summaries.push({ ok: res.succeeded.length, failed: res.failed });
            pending -= 1;
            if (pending === 0) {
              const ok = summaries.reduce((a, s) => a + s.ok, 0);
              const failed = summaries.flatMap((s) => s.failed);
              if (failed.length === 0) {
                toast.success(
                  t("vm.batchSuccess", {
                    defaultValue: "批量 {{action}} 成功（{{count}}）",
                    action,
                    count: ok,
                  }),
                );
              } else {
                toast.warning(
                  t("vm.batchPartial", {
                    defaultValue: "部分成功：成功 {{ok}}，失败 {{fail}}",
                    ok,
                    fail: failed.length,
                  }),
                  {
                    description: failed.map((f) => `${f.key}: ${f.error}`).join("\n"),
                    duration: 15000,
                  },
                );
              }
              clearSelection();
            }
          },
          onError: (e) => {
            pending -= 1;
            toast.error(formatError(e));
            if (pending === 0) clearSelection();
          },
        },
      );
    }
  };

  const columns = useMemo<ColumnDef<IncusInstance>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={table.getIsSomePageRowsSelected()}
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(v)}
            aria-label={t("dataTable.selectAll", { defaultValue: "全选" })}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(v)}
            aria-label={t("dataTable.selectRow", { defaultValue: "选择行" })}
          />
        ),
        enableSorting: false,
      },
      {
        accessorKey: "name",
        header: t("vm.name"),
        cell: ({ row }) => (
          <Link
            to="/admin/vm-detail"
            search={{
              name: row.original.name,
              cluster: clusterName,
              project: row.original.project ?? "customers",
            }}
            className="font-mono font-emphasis text-foreground hover:text-accent transition-colors"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "status",
        header: t("vm.status"),
        cell: ({ row }) => (
          <StatusPill status={vmStatusToKind(row.original.status)}>
            {formatVmStatus(t, row.original.status)}
          </StatusPill>
        ),
      },
      {
        accessorKey: "location",
        header: t("vm.node"),
        enableSorting: true,
        cell: ({ row }) => {
          const stateful = row.original.config?.["migration.stateful"];
          const live = stateful === "true" || stateful === "1";
          return (
            <span className="inline-flex items-center gap-1.5">
              <span className="font-mono text-caption text-text-secondary">
                {row.original.location || "—"}
              </span>
              {/* PLAN-039 / OPS-043: live migration 就绪标识。仅运行 / 停止 VM 显示；
                  历史 VM (无 stateful) 默认隐藏 badge，运维一眼能识别哪些待回填。 */}
              {live ? (
                <span
                  className="inline-flex items-center px-1 rounded-pill border border-status-success/30 bg-status-success/8 text-status-success text-tiny font-emphasis"
                  title={t("admin.vmStatefulHint", {
                    defaultValue: "已启用 live migration（migration.stateful=true）",
                  })}
                >
                  live
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: "config",
        header: t("vm.config"),
        cell: ({ row }) => (
          <span className="text-text-tertiary text-caption tabular-nums">
            {row.original.config?.["limits.cpu"] ?? "—"}C ·{" "}
            {row.original.config?.["limits.memory"] ?? "—"}
          </span>
        ),
      },
      {
        id: "ip",
        header: t("vm.ip"),
        cell: ({ row }) => {
          const ip = row.original.ip || extractIP(row.original);
          return <span className="font-mono text-caption">{ip || "—"}</span>;
        },
      },
      {
        id: "actions",
        header: () => <span className="block text-right">{t("common.actions")}</span>,
        cell: ({ row }) => (
          <VMRowActions
            vm={row.original}
            cluster={clusterName}
            onOpenSheet={(kind) => {
              setSheetVM(row.original);
              setSheetKind(kind);
            }}
          />
        ),
      },
    ],
    [clusterName, t],
  );

  // 选中 VM 的 IncusInstance 集合（migrate-batch 需要 location/project 字段）
  const selectedVMs = useMemo(
    () => allVMs.filter((v) => selectedNamesSet.has(v.name)),
    [allVMs, selectedNamesSet],
  );

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-emphasis text-foreground">
          {displayName}
        </h2>
        <span className="text-caption text-text-tertiary">
          ({data?.count ?? 0} VMs)
        </span>
        {isStale ? (
          <Badge variant="warning" className={cn("ml-2")}>
            {t("vm.cachedAt", {
              time: data?.cached_at ? formatTime(data.cached_at) : "",
            })}
          </Badge>
        ) : null}
        {(data?.error || data?.warning) && !isStale ? (
          <Badge variant="error" className="ml-2">
            {data?.error || data?.warning}
          </Badge>
        ) : null}
        {/* PLAN-037 / OPS-040：按节点筛选。空 = 全部 */}
        {allNodes.length > 1 && (
          <select
            className={cn(
              "ml-auto rounded-md border border-border bg-surface-1 px-2 py-1",
              "text-caption text-text-secondary",
            )}
            value={nodeFilter}
            onChange={(e) => onNodeFilterChange?.(e.target.value)}
            aria-label={t("vm.filterByNode", { defaultValue: "按节点筛选" })}
          >
            <option value="">
              {t("vm.allNodes", { defaultValue: "所有节点" })}
            </option>
            {allNodes.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        )}
      </header>

      {isError ? (
        <ErrorState
          title={t("vm.clusterConnectFailed")}
          description={(error as Error)?.message ?? t("vm.unknownError")}
        />
      ) : (
        <DataTable<IncusInstance>
          columns={columns}
          data={vms}
          isLoading={isLoading}
          getRowId={(row) => row.name}
          tableId={`admin.cluster-vms.${clusterName}`}
          enableRowSelection
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          sorting={sorting}
          onSortingChange={setSorting}
          onRowClick={(vm) => setPeekVM(vm)}
          toolbar={
            <BatchToolbar count={selectedNames.length} onClear={clearSelection}>
              <Button
                size="sm"
                variant="ghost"
                disabled={batchMutation.isPending}
                onClick={() => runBatch("start")}
              >
                <Play size={12} aria-hidden="true" />
                {t("vm.start")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={batchMutation.isPending}
                onClick={() => runBatch("stop")}
              >
                <Square size={12} aria-hidden="true" />
                {t("vm.stop")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={batchMutation.isPending}
                onClick={() => runBatch("restart")}
              >
                <RefreshCw size={12} aria-hidden="true" />
                {t("vm.restart")}
              </Button>
              {/* PLAN-037 / OPS-040：批量迁移按钮 */}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setMigrateOpen(true)}
              >
                <ArrowRight size={12} aria-hidden="true" />
                {t("admin.migrate.batchAction", { defaultValue: "迁移到..." })}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={batchMutation.isPending}
                onClick={() => runBatch("delete")}
              >
                <Trash2 size={12} aria-hidden="true" />
                {t("vm.delete")}
              </Button>
            </BatchToolbar>
          }
          empty={
            <span className="text-muted-foreground text-sm">
              {t("vm.noneInCluster")}
            </span>
          }
          density="comfortable"
        />
      )}

      {sheetVM ? (
        <VMActionSheets
          vm={sheetVM}
          cluster={clusterName}
          open={sheetKind}
          onClose={() => {
            setSheetKind(null);
          }}
        />
      ) : null}

      <VMPeekPanel
        vm={peekVM}
        cluster={clusterName}
        onClose={() => setPeekVM(null)}
        onOpenSnapshots={
          peekVM
            ? () => {
                setSheetVM(peekVM);
                setSheetKind("snapshots");
                setPeekVM(null);
              }
            : undefined
        }
      />

      {/* PLAN-037 / OPS-040：批量冷迁移抽屉 */}
      <MigrateBatchSheet
        open={migrateOpen}
        onOpenChange={setMigrateOpen}
        clusterName={clusterName}
        selectedVMs={selectedVMs}
      />
    </section>
  );
}
