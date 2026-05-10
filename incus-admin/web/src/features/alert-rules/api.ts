import { useMutation, useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

// PLAN-041 / INFRA-009 告警阈值规则。
//
// kind 与后端 system_alerts.kind 对齐：
//   imbalance / vm_cpu / vm_mem / vm_disk / vm_down /
//   cluster_node_offline / order_failed / job_failed /
//   balance_low / backup_failed
//
// 一期 evaluator 仅评估非 vm_cpu/mem/disk 的 6 类（其余留 v2）。
// builtin=true 是系统内置规则（如 Cluster Imbalance），不可删，但可改 channel/threshold/enabled。

export type AlertRuleKind =
  | "imbalance"
  | "vm_cpu"
  | "vm_mem"
  | "vm_disk"
  | "vm_down"
  | "cluster_node_offline"
  | "order_failed"
  | "job_failed"
  | "balance_low"
  | "backup_failed";

export type AlertScope = "global" | "cluster" | "vm" | "user";
export type AlertSeverity = "info" | "warning" | "error" | "critical";

export interface AlertRule {
  id: number;
  name: string;
  kind: AlertRuleKind;
  scope_kind: AlertScope;
  scope_id: number | null;
  threshold: number | null;
  window_seconds: number;
  severity: AlertSeverity;
  enabled: boolean;
  channel_ids: number[];
  builtin: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateAlertRulePayload {
  name: string;
  kind: AlertRuleKind;
  scope_kind: AlertScope;
  scope_id?: number;
  threshold?: number;
  window_seconds: number;
  severity: AlertSeverity;
  channel_ids: number[];
  enabled?: boolean;
}

export interface UpdateAlertRulePayload {
  name: string;
  threshold?: number;
  window_seconds: number;
  severity: AlertSeverity;
  channel_ids: number[];
  enabled: boolean;
}

export interface AlertDelivery {
  id: number;
  alert_id: number | null;
  rule_id: number | null;
  channel_id: number;
  group_key: string;
  status: "pending" | "success" | "failed" | "resolved";
  phase: "firing" | "resolved";
  severity: AlertSeverity;
  attempts: number;
  last_error: string | null;
  next_retry_at: string | null;
  sent_at: string | null;
  created_at: string;
}

export const alertRuleKeys = {
  all: ["alert-rules"] as const,
  list: () => [...alertRuleKeys.all, "list"] as const,
  detail: (id: number) => [...alertRuleKeys.all, "detail", id] as const,
  deliveries: (id: number) => [...alertRuleKeys.all, "deliveries", id] as const,
};

export function useAlertRulesQuery() {
  return useQuery({
    queryKey: alertRuleKeys.list(),
    queryFn: () => http.get<{ rules: AlertRule[] }>("/admin/alert-rules"),
  });
}

export function useAlertRuleQuery(id: number | null | undefined) {
  return useQuery({
    queryKey: id ? alertRuleKeys.detail(id) : alertRuleKeys.detail(0),
    queryFn: () => http.get<{ rule: AlertRule }>(`/admin/alert-rules/${id}`),
    enabled: !!id,
  });
}

export function useCreateAlertRuleMutation() {
  return useMutation({
    mutationFn: (data: CreateAlertRulePayload) =>
      http.post<{ id: number }>("/admin/alert-rules", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: alertRuleKeys.all }),
  });
}

export function useUpdateAlertRuleMutation(id: number) {
  return useMutation({
    mutationFn: (data: UpdateAlertRulePayload) =>
      http.put<{ status: string }>(`/admin/alert-rules/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: alertRuleKeys.all }),
  });
}

export function useDeleteAlertRuleMutation() {
  return useMutation({
    mutationFn: (id: number) => http.delete(`/admin/alert-rules/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: alertRuleKeys.all }),
  });
}

export function useToggleAlertRuleMutation(id: number) {
  // 后端同时支持 PATCH 和 PUT；前端 http client 没 patch 方法，用 PUT 兼容。
  return useMutation({
    mutationFn: (enabled: boolean) =>
      http.put<{ status: string }>(`/admin/alert-rules/${id}/enabled`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: alertRuleKeys.all }),
  });
}

export function useAlertDeliveriesQuery(ruleID: number | null | undefined) {
  return useQuery({
    queryKey: ruleID ? alertRuleKeys.deliveries(ruleID) : alertRuleKeys.deliveries(0),
    queryFn: () =>
      http.get<{ deliveries: AlertDelivery[] }>(
        `/admin/alert-rules/${ruleID}/deliveries?limit=50`,
      ),
    enabled: !!ruleID,
  });
}
