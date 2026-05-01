import type {ColumnDef, ColumnSizingState, RowSelectionState, SortingState} from "@tanstack/react-table";
import type {ReactNode} from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pagination } from "@/shared/components/ui/pagination";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";

/**
 * DataTable —— 包装 TanStack Table，统一所有列表页的视觉与行为。
 *
 * 特性：
 *   - 列头排序（chevron 提示）
 *   - 列宽 resize + localStorage 持久化（PLAN-024.B；通过 `tableId` 启用）
 *   - 行选择（多选 + Batch toolbar 由调用方提供）
 *   - 空态 / 加载态 / 错误态
 *   - 分页（外部受控，配合 URL 参数）
 *
 * 路由用法：
 *   const cols = useMemo(() => [...], []);
 *   <DataTable tableId="admin.vms" columns={cols} data={vms} ... />
 */

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, any>[];
  data: TData[];
  /** 加载中（Skeleton 行数 = pageSize） */
  isLoading?: boolean;
  /** 错误态（替代表格主体） */
  error?: ReactNode;
  /** 空态（替代表格主体） */
  empty?: ReactNode;
  /** 每行 key（必传，用于 row identity） */
  getRowId: (row: TData) => string;
  /** 多选支持（控制是否渲染 checkbox 列；checkbox 列由调用方在 columns 里添加） */
  enableRowSelection?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  /** 排序受控（默认前端排序）。传空数组禁用 */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  /** 服务端分页 */
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    onChange: (limit: number, offset: number) => void;
  };
  /** 行点击 */
  onRowClick?: (row: TData) => void;
  /** 标题以下、表格之上的浮层 / sticky 区（一般是 BatchToolbar） */
  toolbar?: ReactNode;
  className?: string;
  /** 行密度：compact 36px / comfortable 48px */
  density?: "compact" | "comfortable";
  /**
   * 表格唯一 ID。传入后启用列宽 resize + localStorage 持久化。
   * 例：`admin.vms`、`admin.floating-ips`。
   * 不传则保持原行为（无 resize）。
   */
  tableId?: string;
}

const COL_SIZE_LS_PREFIX = "incus.table.";

function loadColSizing(tableId: string): ColumnSizingState {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(`${COL_SIZE_LS_PREFIX}${tableId}.colSize`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as ColumnSizingState) : {};
  } catch {
    return {};
  }
}

function saveColSizing(tableId: string, sizing: ColumnSizingState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${COL_SIZE_LS_PREFIX}${tableId}.colSize`,
      JSON.stringify(sizing),
    );
  } catch {
    // localStorage 满 / 隐私模式 → 静默忽略
  }
}

export function DataTable<TData>({
  columns,
  data,
  isLoading,
  error,
  empty,
  getRowId,
  enableRowSelection,
  rowSelection,
  onRowSelectionChange,
  sorting,
  onSortingChange,
  pagination,
  onRowClick,
  toolbar,
  className,
  density = "comfortable",
  tableId,
}: DataTableProps<TData>) {
  const { t } = useTranslation();

  // 列宽状态（仅 tableId 提供时启用持久化；否则纯 in-memory，组件销毁丢失）。
  // columnResizeMode='onChange' 在每帧 mousemove 都更新 colSizing，因此 LS 写入必须节流，
  // 否则拖拽期间会同步 IO 阻塞主线程（每秒 60+ 次 stringify + setItem）。
  const [colSizing, setColSizing] = useState<ColumnSizingState>(() =>
    tableId ? loadColSizing(tableId) : {},
  );
  const persistTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!tableId) return;
    if (persistTimerRef.current != null) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      saveColSizing(tableId, colSizing);
      persistTimerRef.current = null;
    }, 300);
    return () => {
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
        // 卸载前 flush 一次，避免拖拽中切页丢失最后一次调整
        saveColSizing(tableId, colSizing);
        persistTimerRef.current = null;
      }
    };
  }, [tableId, colSizing]);

  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: {
      ...(rowSelection ? { rowSelection } : {}),
      ...(sorting ? { sorting } : {}),
      columnSizing: colSizing,
    },
    enableRowSelection,
    onRowSelectionChange:
      onRowSelectionChange != null
        ? (updater) =>
            onRowSelectionChange(
              typeof updater === "function" ? updater(rowSelection ?? {}) : updater,
            )
        : undefined,
    onSortingChange:
      onSortingChange != null
        ? (updater) =>
            onSortingChange(
              typeof updater === "function" ? updater(sorting ?? []) : updater,
            )
        : undefined,
    onColumnSizingChange: (updater) =>
      setColSizing((prev) =>
        typeof updater === "function" ? updater(prev) : updater,
      ),
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: !!pagination,
  });

  const colCount = columns.length || 1;
  const pageSize = pagination?.limit ?? 20;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {toolbar}
      <div className="rounded-lg border border-border overflow-hidden bg-surface-1">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  const canResize = header.column.getCanResize();
                  const isResizing = header.column.getIsResizing();
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        "relative",
                        canSort && "cursor-pointer select-none",
                      )}
                      style={{ width: header.getSize() }}
                      onClick={
                        canSort ? header.column.getToggleSortingHandler() : undefined
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort
                          ? sortDir === "asc"
                            ? <ChevronUp size={12} aria-hidden="true" />
                            : sortDir === "desc"
                              ? <ChevronDown size={12} aria-hidden="true" />
                              : <ChevronsUpDown size={12} aria-hidden="true" className="opacity-40" />
                          : null}
                      </span>
                      {/* Resize handle —— hover 显现，活跃时常亮（Linear 风）。
                          stopPropagation 防止触发列头点击排序。 */}
                      {canResize ? (
                        <span
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={t("dataTable.resizeColumn", { defaultValue: "拖动调整列宽" })}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            header.getResizeHandler()(e);
                          }}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                            header.getResizeHandler()(e);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            header.column.resetSize();
                          }}
                          className={cn(
                            "absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none",
                            "after:absolute after:right-[2px] after:top-1/4 after:bottom-1/4",
                            "after:w-[2px] after:rounded after:bg-border",
                            "after:opacity-0 group-hover/row:after:opacity-60 hover:after:opacity-100 hover:after:bg-accent",
                            "after:transition-opacity",
                            isResizing && "after:opacity-100 after:bg-accent",
                          )}
                          data-no-row-click
                        />
                      ) : null}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: Math.min(pageSize, 5) }).map((_, i) => (
                <TableRow key={`skel-${i}`} className="hover:bg-transparent">
                  {Array.from({ length: colCount }).map((_, j) => (
                    <TableCell key={j} className={density === "compact" ? "py-1.5" : "py-2.5"}>
                      <Skeleton className="h-4 w-full max-w-table-skeleton" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : error ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colCount} className="p-6 text-center">
                  {error}
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colCount} className="p-6 text-center">
                  {empty ?? (
                    <span className="text-muted-foreground">
                      {t("common.noData", { defaultValue: "暂无数据" })}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <Fragment key={row.id}>
                  <TableRow
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    onClick={
                      onRowClick
                        ? (e) => {
                            // 整行可点击但不要劫持 button/link/checkbox/menu。Linear 风：
                            // 行级悬浮 → 点击 = 主操作；行内交互元素仍按自身语义。
                            // 注意：base-ui 的 Checkbox 渲染为 <button role="checkbox">；
                            // dropdown trigger 渲染为 <button aria-haspopup>。closest("button")
                            // 已经覆盖了它们，但额外加 role 选择器是为了防御 render prop 替换
                            // 成 div/span 的边角情况。
                            const target = e.target as HTMLElement;
                            if (
                              target.closest(
                                [
                                  "button",
                                  "a",
                                  "input",
                                  "label",
                                  "select",
                                  "[role='menuitem']",
                                  "[role='menu']",
                                  "[role='checkbox']",
                                  "[role='radio']",
                                  "[role='switch']",
                                  "[role='separator']",
                                  "[role='dialog']",
                                  "[data-no-row-click]",
                                ].join(","),
                              )
                            ) {
                              return;
                            }
                            onRowClick(row.original);
                          }
                        : undefined
                    }
                    className={cn(
                      // group/row 让行内 children（如 VMRowActions）能用
                      // group-hover/row 控制可见性 — Linear 风"平静态干净"
                      "group/row relative",
                      onRowClick && "cursor-pointer",
                      density === "compact" ? "[&>td]:py-1.5" : "[&>td]:py-2.5",
                      // Linear 行 hover：左侧 2px accent indicator（仅在第一个 td 上叠加伪元素）
                      "[&>td:first-child]:relative",
                      "[&>td:first-child]:before:absolute [&>td:first-child]:before:left-0",
                      "[&>td:first-child]:before:top-1 [&>td:first-child]:before:bottom-1",
                      "[&>td:first-child]:before:w-[2px] [&>td:first-child]:before:rounded-r",
                      "[&>td:first-child]:before:bg-accent",
                      "[&>td:first-child]:before:opacity-0 group-hover/row:[&>td:first-child]:before:opacity-100",
                      "[&>td:first-child]:before:transition-opacity",
                      "data-[state=selected]:[&>td:first-child]:before:opacity-100",
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        style={{ width: cell.column.getSize() }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {pagination ? (
        <Pagination
          total={pagination.total}
          limit={pagination.limit}
          offset={pagination.offset}
          onChange={pagination.onChange}
          className="px-1"
        />
      ) : null}
    </div>
  );
}
