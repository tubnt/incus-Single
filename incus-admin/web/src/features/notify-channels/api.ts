import { useMutation, useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

// PLAN-041 / INFRA-009 通知通道（钉钉 / 飞书 / 企微 / Webhook / SMTP）。
//
// 列表 API 返不含 config（敏感）。创建 / 更新时 config 是 JSON 对象，由各 kind
// 自行约定 schema：
//   - dingtalk:  { webhook_url, sign_secret }
//   - feishu:    { webhook_url, sign_secret }
//   - wecom:     { webhook_url }
//   - webhook:   { url, method?, headers?, bearer? }
//   - smtp:      { host, port, username, password, from, to[], tls }

export type NotifyChannelKind = "dingtalk" | "feishu" | "wecom" | "webhook" | "smtp";

export interface NotifyChannel {
  id: number;
  name: string;
  kind: NotifyChannelKind;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateChannelPayload {
  name: string;
  kind: NotifyChannelKind;
  config: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateChannelPayload {
  name?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export const notifyKeys = {
  all: ["notify-channels"] as const,
  list: () => [...notifyKeys.all, "list"] as const,
};

export function useNotifyChannelsQuery() {
  return useQuery({
    queryKey: notifyKeys.list(),
    queryFn: () => http.get<{ channels: NotifyChannel[] }>("/admin/notify-channels"),
  });
}

export function useCreateNotifyChannelMutation() {
  return useMutation({
    mutationFn: (data: CreateChannelPayload) =>
      http.post<{ channel: NotifyChannel }>("/admin/notify-channels", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notifyKeys.all }),
  });
}

export function useUpdateNotifyChannelMutation(id: number) {
  return useMutation({
    mutationFn: (data: UpdateChannelPayload) =>
      http.put<{ status: string }>(`/admin/notify-channels/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notifyKeys.all }),
  });
}

export function useDeleteNotifyChannelMutation() {
  return useMutation({
    mutationFn: (id: number) => http.delete(`/admin/notify-channels/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notifyKeys.all }),
  });
}

// 测试发送：同步发一条 demo 告警，立刻返回成功 / 失败 + 错误信息（前端打 toast 显示）。
export function useTestNotifyChannelMutation() {
  return useMutation({
    mutationFn: (id: number) =>
      http.post<{ status: "ok" | "failed"; error?: string }>(
        `/admin/notify-channels/${id}/test`,
        {},
      ),
  });
}
