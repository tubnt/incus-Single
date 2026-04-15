import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

export const Route = createFileRoute("/tickets")({
  component: TicketsPage,
});

interface Ticket {
  id: number;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
}

function TicketsPage() {
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["myTickets"],
    queryFn: () => http.get<{ tickets: Ticket[] }>("/portal/tickets"),
  });

  const tickets = data?.tickets ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">工单</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
        >
          {showCreate ? "取消" : "+ 提交工单"}
        </button>
      </div>

      {showCreate && <CreateTicketForm onDone={() => setShowCreate(false)} />}

      {isLoading ? (
        <div className="text-muted-foreground">加载中...</div>
      ) : tickets.length === 0 ? (
        <div className="border border-border rounded-lg p-8 text-center text-muted-foreground">
          暂无工单。如需帮助请提交工单。
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2 font-medium">#</th>
                <th className="text-left px-4 py-2 font-medium">主题</th>
                <th className="text-left px-4 py-2 font-medium">状态</th>
                <th className="text-left px-4 py-2 font-medium">优先级</th>
                <th className="text-left px-4 py-2 font-medium">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-t border-border hover:bg-muted/20 cursor-pointer">
                  <td className="px-4 py-2">{t.id}</td>
                  <td className="px-4 py-2 font-medium">{t.subject}</td>
                  <td className="px-4 py-2">
                    <TicketStatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-2">
                    <PriorityBadge priority={t.priority} />
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">
                    {new Date(t.updated_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreateTicketForm({ onDone }: { onDone: () => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState("normal");

  const mutation = useMutation({
    mutationFn: () => http.post("/portal/tickets", { subject, body, priority }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myTickets"] });
      onDone();
    },
  });

  return (
    <div className="border border-border rounded-lg bg-card p-4 mb-6">
      <h3 className="font-semibold mb-3">提交新工单</h3>
      <input
        type="text"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="主题"
        className="w-full px-3 py-2 mb-3 rounded border border-border bg-card text-sm"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="详细描述你的问题..."
        rows={5}
        className="w-full px-3 py-2 mb-3 rounded border border-border bg-card text-sm"
      />
      <div className="flex items-center gap-3 mb-3">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="px-3 py-2 rounded border border-border bg-card text-sm"
        >
          <option value="low">低</option>
          <option value="normal">普通</option>
          <option value="high">高</option>
          <option value="urgent">紧急</option>
        </select>
      </div>
      {mutation.isError && (
        <div className="text-destructive text-sm mb-2">{(mutation.error as Error).message}</div>
      )}
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || !subject.trim()}
        className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50"
      >
        {mutation.isPending ? "提交中..." : "提交工单"}
      </button>
    </div>
  );
}

function TicketStatusBadge({ status }: { status: string }) {
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

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    low: "text-muted-foreground",
    normal: "text-foreground",
    high: "text-yellow-600",
    urgent: "text-destructive font-semibold",
  };
  return <span className={`text-xs ${colors[priority] ?? ""}`}>{priority}</span>;
}
