import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

export const Route = createFileRoute("/admin/tickets")({
  component: AdminTicketsPage,
});

interface Ticket {
  id: number;
  user_id: number;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
}

interface TicketMessage {
  id: number;
  ticket_id: number;
  user_id: number;
  body: string;
  is_staff: boolean;
  created_at: string;
}

function AdminTicketsPage() {
  const [selected, setSelected] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["adminTickets"],
    queryFn: () => http.get<{ tickets: Ticket[] }>("/admin/tickets"),
    refetchInterval: 15_000,
  });

  const tickets = data?.tickets ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">工单管理</h1>

      {isLoading ? (
        <div className="text-muted-foreground">加载中...</div>
      ) : tickets.length === 0 ? (
        <div className="border border-border rounded-lg p-6 text-center text-muted-foreground">
          暂无工单。
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2 font-medium">#</th>
                <th className="text-left px-4 py-2 font-medium">用户</th>
                <th className="text-left px-4 py-2 font-medium">主题</th>
                <th className="text-left px-4 py-2 font-medium">状态</th>
                <th className="text-left px-4 py-2 font-medium">优先级</th>
                <th className="text-left px-4 py-2 font-medium">更新时间</th>
                <th className="text-right px-4 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <>
                  <tr key={t.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-2">{t.id}</td>
                    <td className="px-4 py-2 text-xs">{t.user_id}</td>
                    <td className="px-4 py-2 font-medium">{t.subject}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-2 text-xs">{t.priority}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">
                      {new Date(t.updated_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => setSelected(selected === t.id ? null : t.id)}
                        className="px-2 py-1 text-xs rounded bg-primary/20 text-primary hover:bg-primary/30"
                      >
                        {selected === t.id ? "收起" : "查看"}
                      </button>
                    </td>
                  </tr>
                  {selected === t.id && (
                    <tr key={`detail-${t.id}`}>
                      <td colSpan={7} className="p-0">
                        <TicketDetail ticketId={t.id} status={t.status} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TicketDetail({ ticketId, status }: { ticketId: number; status: string }) {
  const [reply, setReply] = useState("");

  const { data } = useQuery({
    queryKey: ["ticketDetail", ticketId],
    queryFn: () => http.get<{ ticket: Ticket; messages: TicketMessage[] }>(`/admin/tickets/${ticketId}`),
  });

  const replyMutation = useMutation({
    mutationFn: () => http.post(`/admin/tickets/${ticketId}/messages`, { body: reply }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ticketDetail", ticketId] });
      setReply("");
    },
  });

  const statusMutation = useMutation({
    mutationFn: (newStatus: string) => http.put(`/admin/tickets/${ticketId}/status`, { status: newStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminTickets"] });
      queryClient.invalidateQueries({ queryKey: ["ticketDetail", ticketId] });
    },
  });

  const messages = data?.messages ?? [];

  return (
    <div className="p-4 bg-card/50 border-t border-border">
      <div className="space-y-3 mb-4 max-h-80 overflow-y-auto">
        {messages.length === 0 && (
          <div className="text-xs text-muted-foreground">暂无消息</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`p-3 rounded-lg text-sm ${m.is_staff ? "bg-primary/10 ml-8" : "bg-muted/30 mr-8"}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium">{m.is_staff ? "客服" : `用户 #${m.user_id}`}</span>
              <span className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString()}</span>
            </div>
            <div className="whitespace-pre-wrap">{m.body}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="回复..."
          rows={2}
          className="flex-1 px-3 py-2 rounded border border-border bg-card text-sm"
        />
        <div className="flex flex-col gap-1">
          <button
            onClick={() => replyMutation.mutate()}
            disabled={replyMutation.isPending || !reply.trim()}
            className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded disabled:opacity-50"
          >
            回复
          </button>
          {status !== "closed" && (
            <button
              onClick={() => statusMutation.mutate("closed")}
              className="px-3 py-1.5 text-xs bg-muted/50 text-muted-foreground rounded"
            >
              关闭
            </button>
          )}
          {status === "closed" && (
            <button
              onClick={() => statusMutation.mutate("open")}
              className="px-3 py-1.5 text-xs bg-success/20 text-success rounded"
            >
              重开
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: "bg-success/20 text-success",
    answered: "bg-primary/20 text-primary",
    closed: "bg-muted text-muted-foreground",
    pending: "bg-yellow-500/20 text-yellow-600",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}
