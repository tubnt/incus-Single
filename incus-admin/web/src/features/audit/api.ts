import { useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";

export interface AuditLog {
  id: number;
  user_id: number | null;
  action: string;
  target_type: string;
  target_id: number;
  details: string;
  ip_address: string;
  created_at: string;
}

export function useAuditLogsQuery(limit: number, offset: number) {
  return useQuery({
    queryKey: ["auditLogs", offset],
    queryFn: () => http.get<{ logs: AuditLog[]; total: number }>(
      "/admin/audit-logs",
      { limit: String(limit), offset: String(offset) },
    ),
  });
}
