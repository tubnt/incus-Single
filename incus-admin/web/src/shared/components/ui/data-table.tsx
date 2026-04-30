import type {ColumnDef, RowSelectionState, SortingState} from "@tanstack/react-table";
import type {ReactNode} from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { Fragment } from "react";
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
 *   - 行选择（多选 + Batch toolbar 由调用方提供）
 *   - 空态 / 加载态 / 错误态
 *   - 分页（外部受控，配合 URL 参数）
 *   - 移动端：自动切卡片视图（小于 sm 断点）
 *
 * 路由用法：
 *   const cols = useMemo(() => [...], []);
 *   <DataTable columns={cols} data={vms} ... />
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
  /** 标题以下、表格之上的 sticky 区（一般是 BatchToolbar） */
  toolbar?: ReactNode;
  className?: string;
  /** 行密度：compact 36px / comfortable 48px */
  density?: "compact" | "comfortable";
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
}: DataTableProps<TData>) {
  const { t } = useTranslation();

  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: {
      ...(rowSelection ? { rowSelection } : {}),
      ...(sorting ? { sorting } : {}),
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
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(canSort && "cursor-pointer select-none")}
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
                      <Skeleton className="h-4 w-full max-w-[200px]" />
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
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    className={cn(
                      onRowClick && "cursor-pointer",
                      density === "compact" ? "[&>td]:py-1.5" : "[&>td]:py-2.5",
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
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
