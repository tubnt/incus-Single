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

export const auditLogKeys = {
  all: ["auditLog"] as const,
  list: (offset: number, limit: number) => [...auditLogKeys.all, "list", offset, limit] as const,
};

export function useAuditLogsQuery(offset: number, limit: number) {
  return useQuery({
    queryKey: auditLogKeys.list(offset, limit),
    queryFn: () =>
      http.get<{ logs: AuditLog[]; total: number }>("/admin/audit-logs", {
        limit: String(limit),
        offset: String(offset),
      }),
    refetchInterval: 15_000,
  });
}
