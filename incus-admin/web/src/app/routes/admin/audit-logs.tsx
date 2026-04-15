import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { http } from "@/shared/lib/http";

export const Route = createFileRoute("/admin/audit-logs")({
  component: AuditLogsPage,
});

interface AuditLog {
  id: number;
  user_id: number | null;
  action: string;
  target_type: string;
  target_id: number;
  details: string;
  ip_address: string;
  created_at: string;
}

function AuditLogsPage() {
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["auditLogs", offset],
    queryFn: () =>
      http.get<{ logs: AuditLog[]; total: number }>(
        "/admin/audit-logs",
        { limit: String(limit), offset: String(offset) },
      ),
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">审计日志</h1>
        <span className="text-xs text-muted-foreground">共 {total} 条</span>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">加载中...</div>
      ) : logs.length === 0 ? (
        <div className="border border-border rounded-lg p-6 text-center text-muted-foreground">
          暂无审计日志。
        </div>
      ) : (
        <>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">时间</th>
                  <th className="text-left px-4 py-2 font-medium">用户</th>
                  <th className="text-left px-4 py-2 font-medium">操作</th>
                  <th className="text-left px-4 py-2 font-medium">目标</th>
                  <th className="text-left px-4 py-2 font-medium">IP</th>
                  <th className="text-left px-4 py-2 font-medium">详情</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-t border-border">
                    <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-xs">{log.user_id ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-primary/20 text-primary">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {log.target_type} #{log.target_id}
                    </td>
                    <td className="px-4 py-2 text-xs font-mono">{log.ip_address || "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground max-w-xs truncate">
                      {log.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > limit && (
            <div className="flex justify-center gap-2 mt-4">
              <button
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0}
                className="px-3 py-1.5 text-xs bg-muted/50 rounded disabled:opacity-30"
              >
                上一页
              </button>
              <span className="px-3 py-1.5 text-xs text-muted-foreground">
                {offset + 1}-{Math.min(offset + limit, total)} / {total}
              </span>
              <button
                onClick={() => setOffset(offset + limit)}
                disabled={offset + limit >= total}
                className="px-3 py-1.5 text-xs bg-muted/50 rounded disabled:opacity-30"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
