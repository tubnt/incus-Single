import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuditLogsQuery } from "@/features/audit-logs/api";
import { stripCidrSuffix, targetLabel } from "@/features/audit-logs/helpers";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Card } from "@/shared/components/ui/card";
import { DownloadButton } from "@/shared/components/ui/download-button";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { FilterBar, FilterField } from "@/shared/components/ui/filter-bar";
import { Input } from "@/shared/components/ui/input";
import { Pagination } from "@/shared/components/ui/pagination";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { StatusPill } from "@/shared/components/ui/status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

export const Route = createFileRoute("/admin/audit-logs")({
  component: AuditLogsPage,
});

function AuditLogsPage() {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(50);
  // CSV export form state — these only affect the download URL, not the
  // paginated list above.
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exportAction, setExportAction] = useState("");

  const { data, isLoading } = useAuditLogsQuery(offset, limit);

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;

  const exportParams = new URLSearchParams();
  if (exportFrom) exportParams.set("from", exportFrom);
  if (exportTo) exportParams.set("to", exportTo);
  if (exportAction) exportParams.set("action", exportAction);
  const exportQuery = exportParams.toString();
  const exportHref = `/api/admin/audit-logs/export${exportQuery ? `?${exportQuery}` : ""}`;

  return (
    <PageShell>
      <PageHeader
        title={t("admin.auditLogsTitle")}
        meta={
          <span className="text-xs text-muted-foreground">
            {t("admin.totalRows", { count: total })}
          </span>
        }
      />
      <PageContent>
        <FilterBar
          trailing={
            <>
              <DownloadButton href={exportHref}>
                {t("admin.auditExportCsv", { defaultValue: "导出 CSV" })}
              </DownloadButton>
              <span className="text-xs text-muted-foreground">
                {t("admin.auditExportHint", { defaultValue: "默认 30 天，最多 10 万行" })}
              </span>
            </>
          }
        >
          <FilterField
            htmlFor="audit-from"
            label={t("admin.auditFromDate", { defaultValue: "起始日期" })}
          >
            <Input
              id="audit-from"
              type="date"
              value={exportFrom}
              onChange={(e) => setExportFrom(e.target.value)}
              className="h-8 w-40"
            />
          </FilterField>
          <FilterField
            htmlFor="audit-to"
            label={t("admin.auditToDate", { defaultValue: "截止日期" })}
          >
            <Input
              id="audit-to"
              type="date"
              value={exportTo}
              onChange={(e) => setExportTo(e.target.value)}
              className="h-8 w-40"
            />
          </FilterField>
          <FilterField
            htmlFor="audit-action"
            label={t("admin.auditActionPrefix", { defaultValue: "动作前缀" })}
          >
            <Input
              id="audit-action"
              type="text"
              value={exportAction}
              onChange={(e) => setExportAction(e.target.value)}
              placeholder={t("admin.auditActionPlaceholder", { defaultValue: "如 vm. / node. / http." })}
              className="h-8 w-40"
            />
          </FilterField>
        </FilterBar>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : logs.length === 0 ? (
          <EmptyState title={t("common.noData")} />
        ) : (
          <>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("admin.auditTime")}</TableHead>
                    <TableHead>{t("admin.auditUser")}</TableHead>
                    <TableHead>{t("admin.auditAction")}</TableHead>
                    <TableHead>{t("admin.auditTarget")}</TableHead>
                    <TableHead>{t("admin.auditIp")}</TableHead>
                    <TableHead>{t("admin.auditDetails")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs">{log.user_id ?? "—"}</TableCell>
                      <TableCell>
                        <StatusPill status="pending">{log.action}</StatusPill>
                      </TableCell>
                      <TableCell className="text-xs">{targetLabel(log)}</TableCell>
                      <TableCell className="text-xs font-mono">
                        {stripCidrSuffix(log.ip_address)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                        {log.details}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            <Pagination
              total={total}
              limit={limit}
              offset={offset}
              onChange={(nextLimit, nextOffset) => {
                setLimit(nextLimit);
                setOffset(nextOffset);
              }}
              className="mt-3"
            />
          </>
        )}
      </PageContent>
    </PageShell>
  );
}
