import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  type Ticket,
  useCloseTicketMutation,
  useCreateTicketMutation,
  useMyTicketsQuery,
  useReplyTicketMutation,
  useTicketDetailQuery,
} from "@/features/tickets/api";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";

// TanStack Router 严格路由需要声明 search schema；此处支持可选 ?subject=topup 预填新建工单。
export const Route = createFileRoute("/tickets")({
  component: TicketsPage,
  validateSearch: (search: Record<string, unknown>): { subject?: string } => ({
    subject: typeof search.subject === "string" ? search.subject : undefined,
  }),
});

function TicketsPage() {
  const { t } = useTranslation();
  const search = useSearch({ from: "/tickets" });
  const prefill = resolvePrefill(search.subject, t);
  const [showCreate, setShowCreate] = useState(Boolean(prefill));
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (prefill) setShowCreate(true);
  }, [prefill]);

  const { data, isLoading } = useMyTicketsQuery();
  const tickets = data?.tickets ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("ticket.title", { defaultValue: "工单" })}</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
        >
          {showCreate ? t("common.cancel", { defaultValue: "取消" }) : `+ ${t("ticket.submit", { defaultValue: "提交工单" })}`}
        </button>
      </div>

      {showCreate && <CreateTicketForm prefill={prefill} onDone={() => setShowCreate(false)} />}

      {isLoading ? (
        <div className="text-muted-foreground">{t("common.loading")}</div>
      ) : tickets.length === 0 ? (
        <div className="border border-border rounded-lg p-8 text-center text-muted-foreground">
          {t("ticket.empty", { defaultValue: "暂无工单。如需帮助请提交工单。" })}
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-4 py-2 w-8"></th>
                <th className="text-left px-4 py-2 font-medium">#</th>
                <th className="text-left px-4 py-2 font-medium">{t("ticket.subject", { defaultValue: "主题" })}</th>
                <th className="text-left px-4 py-2 font-medium">{t("ticket.status", { defaultValue: "状态" })}</th>
                <th className="text-left px-4 py-2 font-medium">{t("ticket.priority", { defaultValue: "优先级" })}</th>
                <th className="text-left px-4 py-2 font-medium">{t("ticket.updatedAt", { defaultValue: "更新时间" })}</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((tk) => (
                <TicketRow key={tk.id} ticket={tk} isOpen={selected === tk.id}
                  onToggle={() => setSelected(selected === tk.id ? null : tk.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface Prefill {
  subject: string;
  body: string;
}

function resolvePrefill(key: string | undefined, t: (k: string, o?: Record<string, unknown>) => string): Prefill | null {
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

function CreateTicketForm({ prefill, onDone }: { prefill: Prefill | null; onDone: () => void }) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState(prefill?.subject ?? "");
  const [body, setBody] = useState(prefill?.body ?? "");
  const [priority, setPriority] = useState("normal");

  const mutation = useCreateTicketMutation();

  return (
    <div className="border border-border rounded-lg bg-card p-4 mb-6">
      <h3 className="font-semibold mb-3">{t("ticket.createTitle", { defaultValue: "提交新工单" })}</h3>
      <input
        type="text"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder={t("ticket.subject", { defaultValue: "主题" })}
        className="w-full px-3 py-2 mb-3 rounded border border-border bg-card text-sm"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("ticket.bodyPlaceholder", { defaultValue: "详细描述你的问题..." })}
        rows={5}
        className="w-full px-3 py-2 mb-3 rounded border border-border bg-card text-sm"
      />
      <div className="flex items-center gap-3 mb-3">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="px-3 py-2 rounded border border-border bg-card text-sm"
        >
          <option value="low">{t("ticket.priorityLow", { defaultValue: "低" })}</option>
          <option value="normal">{t("ticket.priorityNormal", { defaultValue: "普通" })}</option>
          <option value="high">{t("ticket.priorityHigh", { defaultValue: "高" })}</option>
          <option value="urgent">{t("ticket.priorityUrgent", { defaultValue: "紧急" })}</option>
        </select>
      </div>
      {mutation.isError && (
        <div className="text-destructive text-sm mb-2">{(mutation.error as Error).message}</div>
      )}
      <button
        onClick={() => mutation.mutate({ subject, body, priority }, { onSuccess: onDone })}
        disabled={mutation.isPending || !subject.trim()}
        className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50"
      >
        {mutation.isPending ? t("ticket.submitting", { defaultValue: "提交中..." }) : t("ticket.submit", { defaultValue: "提交工单" })}
      </button>
    </div>
  );
}

function TicketStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: "bg-success/20 text-success",
    answered: "bg-primary/20 text-primary",
    closed: "bg-muted text-muted-foreground",
    pending: "bg-warning/20 text-warning",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    low: "text-muted-foreground",
    normal: "text-foreground",
    high: "text-warning",
    urgent: "text-destructive font-semibold",
  };
  return <span className={`text-xs ${colors[priority] ?? ""}`}>{priority}</span>;
}

function TicketRow({ ticket: tk, isOpen, onToggle }: { ticket: Ticket; isOpen: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        className="border-t border-border hover:bg-muted/20 cursor-pointer"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <td className="px-4 py-2 text-muted-foreground select-none w-8">{isOpen ? "▼" : "▶"}</td>
        <td className="px-4 py-2">{tk.id}</td>
        <td className="px-4 py-2 font-medium text-primary hover:underline">{tk.subject}</td>
        <td className="px-4 py-2"><TicketStatusBadge status={tk.status} /></td>
        <td className="px-4 py-2"><PriorityBadge priority={tk.priority} /></td>
        <td className="px-4 py-2 text-muted-foreground text-xs">{new Date(tk.updated_at).toLocaleString()}</td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={6} className="p-0">
            <TicketDetail ticketId={tk.id} />
          </td>
        </tr>
      )}
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
        defaultValue: "关闭后将无法继续回复,但管理员仍可重新打开。确认关闭?",
      }),
      destructive: true,
    });
    if (!ok) return;
    closeMutation.mutate(ticketId, {
      onSuccess: () => toast.success(t("ticket.closed", { defaultValue: "工单已关闭" })),
      onError: (e) => toast.error((e as Error).message || t("ticket.closeFailed", { defaultValue: "关闭失败" })),
    });
  };

  return (
    <div className="p-4 bg-card/50 border-t border-border">
      <div className="space-y-3 mb-4 max-h-60 overflow-y-auto">
        {messages.length === 0 && (
          <div className="text-xs text-muted-foreground">{t("ticket.noMessages", { defaultValue: "暂无消息" })}</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`p-3 rounded-lg text-sm ${m.is_staff ? "bg-primary/10 ml-8" : "bg-muted/30 mr-8"}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium">{m.is_staff ? t("ticket.staff", { defaultValue: "客服" }) : t("ticket.me", { defaultValue: "我" })}</span>
              <span className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString()}</span>
            </div>
            <div className="whitespace-pre-wrap">{m.body}</div>
          </div>
        ))}
      </div>
      {canClose ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={t("ticket.replyPlaceholder", { defaultValue: "回复..." })}
            className="flex-1 px-3 py-2 rounded border border-border bg-card text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") submitReply();
            }}
          />
          <button
            onClick={submitReply}
            disabled={replyMutation.isPending || !reply.trim()}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded disabled:opacity-50"
          >
            {t("ticket.send", { defaultValue: "发送" })}
          </button>
          <button
            onClick={submitClose}
            disabled={closeMutation.isPending}
            className="px-4 py-2 text-sm border border-destructive/30 text-destructive rounded hover:bg-destructive/10 disabled:opacity-50"
          >
            {closeMutation.isPending ? "..." : t("ticket.close", { defaultValue: "关闭" })}
          </button>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">{t("ticket.alreadyClosed", { defaultValue: "工单已关闭,无法继续回复" })}</div>
      )}
    </div>
  );
}
