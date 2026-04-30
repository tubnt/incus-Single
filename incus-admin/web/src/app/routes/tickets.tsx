import type {Ticket} from "@/features/tickets/api";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, MessageSquare, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useCloseTicketMutation,
  useCreateTicketMutation,
  useMyTicketsQuery,
  useReplyTicketMutation,
  useTicketDetailQuery,
} from "@/features/tickets/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Button } from "@/shared/components/ui/button";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { Input, Textarea } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
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

export const Route = createFileRoute("/tickets")({
  component: TicketsPage,
  validateSearch: (search: Record<string, unknown>): { subject?: string } => ({
    subject: typeof search.subject === "string" ? search.subject : undefined,
  }),
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

function TicketsPage() {
  const { t } = useTranslation();
  const search = useSearch({ from: "/tickets" });
  const prefill = resolvePrefill(search.subject, t);
  const [createOpen, setCreateOpen] = useState(Boolean(prefill));
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (prefill) setCreateOpen(true);
  }, [prefill]);

  const { data, isLoading } = useMyTicketsQuery();
  const tickets = data?.tickets ?? [];

  return (
    <PageShell>
      <PageHeader
        title={t("ticket.title", { defaultValue: "工单" })}
        description={t("ticket.description", {
          defaultValue: "提交问题或请求，与管理员沟通。",
        })}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} aria-hidden="true" />
            {t("ticket.submit", { defaultValue: "提交工单" })}
          </Button>
        }
      />
      <PageContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : tickets.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title={t("ticket.emptyTitle", { defaultValue: "暂无工单" })}
            description={t("ticket.empty", {
              defaultValue: "如需帮助请提交工单。",
            })}
            action={
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus size={14} aria-hidden="true" />
                {t("ticket.submit", { defaultValue: "提交工单" })}
              </Button>
            }
          />
        ) : (
          <div className="rounded-lg border border-border bg-surface-1 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-8" />
                  <TableHead>#</TableHead>
                  <TableHead>{t("ticket.subject", { defaultValue: "主题" })}</TableHead>
                  <TableHead>{t("ticket.status", { defaultValue: "状态" })}</TableHead>
                  <TableHead>{t("ticket.priority", { defaultValue: "优先级" })}</TableHead>
                  <TableHead>{t("ticket.updatedAt", { defaultValue: "更新时间" })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((tk) => (
                  <TicketRow
                    key={tk.id}
                    ticket={tk}
                    isOpen={selected === tk.id}
                    onToggle={() =>
                      setSelected(selected === tk.id ? null : tk.id)
                    }
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </PageContent>
      <CreateTicketSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        prefill={prefill}
      />
    </PageShell>
  );
}

interface Prefill {
  subject: string;
  body: string;
}

function resolvePrefill(
  key: string | undefined,
  t: (k: string, o?: Record<string, unknown>) => string,
): Prefill | null {
  if (key === "topup") {
    return {
      subject: t("ticket.topupPrefillSubject", { defaultValue: "充值申请" }),
      body: t("ticket.topupPrefillBody", {
        defaultValue: "请管理员协助为我的账户充值。\n\n金额（USD）：\n充值方式：\n",
      }),
    };
  }
  return null;
}

function CreateTicketSheet({
  open,
  onClose,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  prefill: Prefill | null;
}) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState(prefill?.subject ?? "");
  const [body, setBody] = useState(prefill?.body ?? "");
  const [priority, setPriority] = useState("normal");
  const mutation = useCreateTicketMutation();

  useEffect(() => {
    if (open && prefill) {
      setSubject(prefill.subject);
      setBody(prefill.body);
    }
  }, [open, prefill]);

  const submit = () => {
    mutation.mutate(
      { subject, body, priority },
      {
        onSuccess: () => {
          setSubject("");
          setBody("");
          setPriority("normal");
          onClose();
        },
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" size="min(96vw, 32rem)">
        <SheetHeader>
          <SheetTitle>{t("ticket.createTitle", { defaultValue: "提交新工单" })}</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ticket-subject" required>
              {t("ticket.subject", { defaultValue: "主题" })}
            </Label>
            <Input
              id="ticket-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ticket-body">
              {t("ticket.bodyPlaceholder", { defaultValue: "详细描述你的问题..." })}
            </Label>
            <Textarea
              id="ticket-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("ticket.priority", { defaultValue: "优先级" })}</Label>
            <Select value={priority} onValueChange={(v) => setPriority(String(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">
                  {t("ticket.priorityLow", { defaultValue: "低" })}
                </SelectItem>
                <SelectItem value="normal">
                  {t("ticket.priorityNormal", { defaultValue: "普通" })}
                </SelectItem>
                <SelectItem value="high">
                  {t("ticket.priorityHigh", { defaultValue: "高" })}
                </SelectItem>
                <SelectItem value="urgent">
                  {t("ticket.priorityUrgent", { defaultValue: "紧急" })}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mutation.isError ? (
            <div className="text-status-error text-sm">
              {(mutation.error as Error).message}
            </div>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={mutation.isPending || !subject.trim()}
            onClick={submit}
          >
            {mutation.isPending
              ? t("ticket.submitting", { defaultValue: "提交中..." })
              : t("ticket.submit", { defaultValue: "提交工单" })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const cls: Record<string, string> = {
    low: "text-text-tertiary",
    normal: "text-foreground",
    high: "text-status-warning",
    urgent: "text-status-error font-strong",
  };
  return <span className={cn("text-caption", cls[priority] ?? "")}>{priority}</span>;
}

function TicketRow({
  ticket: tk,
  isOpen,
  onToggle,
}: {
  ticket: Ticket;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow
        className="cursor-pointer"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <TableCell className="text-text-tertiary select-none w-8">
          {isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        </TableCell>
        <TableCell>{tk.id}</TableCell>
        <TableCell className="font-emphasis text-foreground">{tk.subject}</TableCell>
        <TableCell>
          <StatusPill status={ticketStatusToKind(tk.status)}>{tk.status}</StatusPill>
        </TableCell>
        <TableCell>
          <PriorityBadge priority={tk.priority} />
        </TableCell>
        <TableCell className="text-caption text-text-tertiary">
          {new Date(tk.updated_at).toLocaleString()}
        </TableCell>
      </TableRow>
      {isOpen ? (
        <TableRow>
          <TableCell colSpan={6} className="p-0">
            <TicketDetail ticketId={tk.id} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function TicketDetail({ ticketId }: { ticketId: number }) {
  const { t } = useTranslation();
  const [reply, setReply] = useState("");
  const confirm = useConfirm();

  const { data } = useTicketDetailQuery(ticketId, "/portal");
  const replyMutation = useReplyTicketMutation(ticketId, "/portal");
  const closeMutation = useCloseTicketMutation();
  const messages = data?.messages ?? [];
  const ticketStatus = data?.ticket?.status;
  const canClose = ticketStatus && ticketStatus !== "closed";

  const submitReply = () => {
    if (!reply.trim()) return;
    replyMutation.mutate(reply, { onSuccess: () => setReply("") });
  };

  const submitClose = async () => {
    const ok = await confirm({
      title: t("ticket.closeConfirmTitle", { defaultValue: "关闭工单" }),
      message: t("ticket.closeConfirmMessage", {
        defaultValue: "关闭后将无法继续回复，但管理员仍可重新打开。确认关闭？",
      }),
      destructive: true,
    });
    if (!ok) return;
    closeMutation.mutate(ticketId, {
      onSuccess: () =>
        toast.success(t("ticket.closed", { defaultValue: "工单已关闭" })),
      onError: (e) =>
        toast.error(
          (e as Error).message || t("ticket.closeFailed", { defaultValue: "关闭失败" }),
        ),
    });
  };

  return (
    <div className="p-4 bg-surface-2 border-t border-border">
      <div className="space-y-3 mb-4 max-h-60 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="text-caption text-text-tertiary">
            {t("ticket.noMessages", { defaultValue: "暂无消息" })}
          </div>
        ) : null}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "p-3 rounded-lg text-sm",
              m.is_staff ? "bg-primary/10 ml-8" : "bg-surface-1 mr-8",
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-caption font-emphasis">
                {m.is_staff
                  ? t("ticket.staff", { defaultValue: "客服" })
                  : t("ticket.me", { defaultValue: "我" })}
              </span>
              <span className="text-caption text-text-tertiary">
                {new Date(m.created_at).toLocaleString()}
              </span>
            </div>
            <div className="whitespace-pre-wrap">{m.body}</div>
          </div>
        ))}
      </div>
      {canClose ? (
        <div className="flex flex-wrap gap-2">
          <Input
            type="text"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={t("ticket.replyPlaceholder", { defaultValue: "回复..." })}
            className="flex-1 min-w-[200px]"
            onKeyDown={(e) => {
              if (e.key === "Enter") submitReply();
            }}
          />
          <Button
            variant="primary"
            disabled={replyMutation.isPending || !reply.trim()}
            onClick={submitReply}
          >
            {t("ticket.send", { defaultValue: "发送" })}
          </Button>
          <Button
            variant="outline"
            disabled={closeMutation.isPending}
            onClick={submitClose}
          >
            {closeMutation.isPending ? "..." : t("ticket.close", { defaultValue: "关闭" })}
          </Button>
        </div>
      ) : (
        <div className="text-caption text-text-tertiary">
          {t("ticket.alreadyClosed", { defaultValue: "工单已关闭，无法继续回复" })}
        </div>
      )}
    </div>
  );
}
