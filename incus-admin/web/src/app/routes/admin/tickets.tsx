import type {Ticket} from "@/features/tickets/api";
import type { PageParams } from "@/shared/lib/pagination";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {

  useAdminTicketsQuery,
  useReplyTicketMutation,
  useTicketDetailQuery,
  useUpdateTicketStatusMutation
} from "@/features/tickets/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { Textarea } from "@/shared/components/ui/input";
import { Pagination } from "@/shared/components/ui/pagination";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { StatusPill, type StatusKind } from "@/shared/components/ui/status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/admin/tickets")({
  component: AdminTicketsPage,
});

function ticketStatusToKind(status: string): StatusKind {
  switch (status) {
    case "open":
      return "success";
    case "answered":
      return "pending";
    case "pending":
      return "warning";
    case "closed":
    default:
      return "disabled";
  }
}

function AdminTicketsPage() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<number | null>(null);
  const [page, setPage] = useState<PageParams>({ limit: 50, offset: 0 });

  const { data, isLoading } = useAdminTicketsQuery(page);
  const tickets = data?.tickets ?? [];
  const total = data?.total ?? tickets.length;

  return (
    <PageShell>
      <PageHeader title={t("admin.ticketsTitle", { defaultValue: "工单管理" })} />
      <PageContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : tickets.length === 0 ? (
          <EmptyState
            title={t("admin.ticketsEmpty", { defaultValue: "暂无工单。" })}
          />
        ) : (
          <>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>#</TableHead>
                    <TableHead>{t("admin.user", { defaultValue: "用户" })}</TableHead>
                    <TableHead>{t("ticket.subject", { defaultValue: "主题" })}</TableHead>
                    <TableHead>{t("ticket.status", { defaultValue: "状态" })}</TableHead>
                    <TableHead>{t("ticket.priority", { defaultValue: "优先级" })}</TableHead>
                    <TableHead>{t("ticket.updatedAt", { defaultValue: "更新时间" })}</TableHead>
                    <TableHead className="text-right">{t("common.actions", { defaultValue: "操作" })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets.map((tk) => (
                    <TicketRow
                      key={tk.id}
                      ticket={tk}
                      isOpen={selected === tk.id}
                      onToggle={() => setSelected(selected === tk.id ? null : tk.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </Card>
            <Pagination
              total={total}
              limit={page.limit}
              offset={page.offset}
              onChange={(limit, offset) => setPage({ limit, offset })}
              className="mt-3"
            />
          </>
        )}
      </PageContent>
    </PageShell>
  );
}

function TicketRow({ ticket: tk, isOpen, onToggle }: { ticket: Ticket; isOpen: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <TableRow>
        <TableCell>{tk.id}</TableCell>
        <TableCell className="text-xs">{tk.user_id}</TableCell>
        <TableCell className="font-emphasis">{tk.subject}</TableCell>
        <TableCell>
          <StatusPill status={ticketStatusToKind(tk.status)}>{tk.status}</StatusPill>
        </TableCell>
        <TableCell className="text-xs">{tk.priority}</TableCell>
        <TableCell className="text-muted-foreground text-xs">
          {new Date(tk.updated_at).toLocaleString()}
        </TableCell>
        <TableCell className="text-right">
          <Button variant="primary" size="sm" onClick={onToggle}>
            {isOpen
              ? t("common.collapse", { defaultValue: "收起" })
              : t("common.view", { defaultValue: "查看" })}
          </Button>
        </TableCell>
      </TableRow>
      {isOpen && (
        <TableRow>
          <TableCell colSpan={7} className="p-0">
            <TicketDetail ticketId={tk.id} status={tk.status} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function TicketDetail({ ticketId, status }: { ticketId: number; status: string }) {
  const { t } = useTranslation();
  const [reply, setReply] = useState("");

  const { data } = useTicketDetailQuery(ticketId, "/admin");
  const replyMutation = useReplyTicketMutation(ticketId, "/admin");
  const statusMutation = useUpdateTicketStatusMutation(ticketId);

  const messages = data?.messages ?? [];

  return (
    <div className="p-4 bg-surface-2 border-t border-border">
      <div className="space-y-3 mb-4 max-h-80 overflow-y-auto">
        {messages.length === 0 && (
          <div className="text-xs text-muted-foreground">{t("ticket.noMessages", { defaultValue: "暂无消息" })}</div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "p-3 rounded-lg text-sm",
              m.is_staff ? "bg-primary/10 ml-8" : "bg-surface-1 mr-8",
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-emphasis">
                {m.is_staff
                  ? t("ticket.staff", { defaultValue: "客服" })
                  : `${t("admin.user", { defaultValue: "用户" })} #${m.user_id}`}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(m.created_at).toLocaleString()}
              </span>
            </div>
            <div className="whitespace-pre-wrap">{m.body}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={t("ticket.replyPlaceholder", { defaultValue: "回复..." })}
          rows={2}
          className="flex-1 min-h-[64px]"
        />
        <div className="flex flex-col gap-1">
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              replyMutation.mutate(reply, { onSuccess: () => setReply("") })
            }
            disabled={replyMutation.isPending || !reply.trim()}
          >
            {t("ticket.reply", { defaultValue: "回复" })}
          </Button>
          {status !== "closed" && (
            <Button
              variant="subtle"
              size="sm"
              onClick={() => statusMutation.mutate("closed")}
            >
              {t("ticket.close", { defaultValue: "关闭" })}
            </Button>
          )}
          {status === "closed" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => statusMutation.mutate("open")}
              className="text-status-success"
            >
              {t("ticket.reopen", { defaultValue: "重开" })}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
