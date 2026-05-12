import type { NotifyChannel, NotifyChannelKind } from "@/features/notify-channels/api";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  useCreateNotifyChannelMutation,
  useDeleteNotifyChannelMutation,
  useNotifyChannelsQuery,
  useTestNotifyChannelMutation,
  useUpdateNotifyChannelMutation,
} from "@/features/notify-channels/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { StatusPill } from "@/shared/components/ui/status";

// 注：新路由首次跑 typecheck 时 routeTree.gen.ts 还没更新会报 "/admin/notify-channels"
// not assignable；用 as any 暂避（vite 启动后 plugin 自动重新生成 routeTree.gen.ts，
// 之后类型自然对齐）。等价方法：先跑一次 `bun run dev` 让 routeTree 生成。
export const Route = createFileRoute("/admin/notify-channels" as never)({
  component: NotifyChannelsPage,
});

const KIND_OPTIONS: { value: NotifyChannelKind; label: string; configHint: string }[] = [
  {
    value: "dingtalk",
    label: "钉钉",
    configHint: '{ "webhook_url": "https://oapi.dingtalk.com/robot/send?access_token=...", "sign_secret": "SEC..." }',
  },
  {
    value: "feishu",
    label: "飞书",
    configHint: '{ "webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/...", "sign_secret": "..." }',
  },
  {
    value: "wecom",
    label: "企业微信",
    configHint: '{ "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." }',
  },
  {
    value: "webhook",
    label: "通用 Webhook",
    configHint: '{ "url": "https://your-server/notify", "method": "POST", "bearer": "..." }',
  },
  {
    value: "smtp",
    label: "邮件 (SMTP)",
    configHint:
      '{ "host": "smtp.example.com", "port": 587, "username": "...", "password": "...", "from": "alerts@x", "to": ["a@x"], "tls": "starttls" }',
  },
];

function kindLabel(k: NotifyChannelKind): string {
  return KIND_OPTIONS.find((o) => o.value === k)?.label ?? k;
}

function NotifyChannelsPage() {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<NotifyChannel | null>(null);
  const { data, isLoading } = useNotifyChannelsQuery();
  const channels = data?.channels ?? [];

  const deleteM = useDeleteNotifyChannelMutation();
  const testM = useTestNotifyChannelMutation();
  const confirm = useConfirm();

  const handleDelete = async (ch: NotifyChannel) => {
    const ok = await confirm({
      title: t("notify.deleteConfirmTitle", "删除通道？"),
      message: t("notify.deleteConfirmDesc", `通道「${ch.name}」将永久删除，绑定它的告警规则将不再发送到此通道。`),
      confirmLabel: t("common.delete", "删除"),
      destructive: true,
    });
    if (!ok) return;
    deleteM.mutate(ch.id, {
      onSuccess: () => toast.success(t("notify.deleted", "通道已删除")),
      onError: (e) => toast.error(`${e}`),
    });
  };

  const handleTest = async (ch: NotifyChannel) => {
    testM.mutate(ch.id, {
      onSuccess: (resp) => {
        if (resp.status === "ok") {
          toast.success(t("notify.testOk", "测试发送成功，请检查目标"));
        } else {
          toast.error(t("notify.testFailed", { defaultValue: "测试失败：{{err}}", err: resp.error ?? "" }));
        }
      },
      onError: (e) => toast.error(`${e}`),
    });
  };

  return (
    <PageShell>
      <PageHeader
        title={t("notify.title", "通知通道")}
        description={t(
          "notify.description",
          "钉钉 / 飞书 / 企微 / Webhook / SMTP 五种通道。secret 在 DB 内 AES-256-GCM 加密。",
        )}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            {t("notify.add", "添加通道")}
          </Button>
        }
      />
      <PageContent>
        {isLoading ? (
          <div className="text-muted-foreground">{t("common.loading", "加载中...")}</div>
        ) : channels.length === 0 ? (
          <EmptyState title={t("notify.empty", "尚未配置通道，先点右上角添加。")} />
        ) : (
          <div className="space-y-3">
            {channels.map((ch) => (
              <Card key={ch.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-medium">{ch.name}</span>
                      <StatusPill status="pending">{kindLabel(ch.kind)}</StatusPill>
                      <StatusPill status={ch.enabled ? "success" : "pending"}>
                        {ch.enabled ? t("common.enabled", "启用") : t("common.disabled", "停用")}
                      </StatusPill>
                    </div>
                    <div className="text-sm text-muted-foreground">ID #{ch.id}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => handleTest(ch)} disabled={testM.isPending}>
                      <Send size={14} />
                      {t("notify.test", "测试发送")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(ch)}>
                      {t("common.edit", "编辑")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(ch)}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        <CreateChannelSheet open={createOpen} onClose={() => setCreateOpen(false)} />
        <EditChannelSheet channel={editing} onClose={() => setEditing(null)} />
      </PageContent>
    </PageShell>
  );
}

function CreateChannelSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<NotifyChannelKind>("dingtalk");
  const [configText, setConfigText] = useState("");
  const [enabled, setEnabled] = useState(true);
  const m = useCreateNotifyChannelMutation();

  const reset = () => {
    setName("");
    setKind("dingtalk");
    setConfigText("");
    setEnabled(true);
  };

  const submit = () => {
    if (!name.trim()) {
      toast.error(t("notify.nameRequired", "名称必填"));
      return;
    }
    let cfg: Record<string, unknown>;
    try {
      cfg = JSON.parse(configText) as Record<string, unknown>;
    } catch {
      toast.error(t("notify.configJsonInvalid", "配置必须是合法 JSON"));
      return;
    }
    m.mutate(
      { name, kind, config: cfg, enabled },
      {
        onSuccess: () => {
          toast.success(t("notify.created", "通道已创建"));
          reset();
          onClose();
        },
        onError: (e) => toast.error(`${e}`),
      },
    );
  };

  const hint = KIND_OPTIONS.find((o) => o.value === kind)?.configHint ?? "";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && (reset(), onClose())}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t("notify.addTitle", "添加通知通道")}</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <div className="space-y-1">
            <Label>{t("notify.name", "名称")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ops-dingtalk" />
          </div>
          <div className="space-y-1">
            <Label>{t("notify.kind", "类型")}</Label>
            <select
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as NotifyChannelKind)}
            >
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>{t("notify.config", "配置 (JSON)")}</Label>
            <textarea
              className="min-h-32 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              placeholder={hint}
            />
            <div className="text-xs text-muted-foreground">{t("notify.configHintLabel", "示例：")} {hint}</div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {t("notify.enabled", "启用")}
          </label>
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel", "取消")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={m.isPending}>
            {t("common.save", "保存")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function EditChannelSheet({ channel, onClose }: { channel: NotifyChannel | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(channel?.name ?? "");
  const [configText, setConfigText] = useState("");
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const m = useUpdateNotifyChannelMutation(channel?.id ?? 0);

  // 当 channel 变化时刷新表单（编辑不同行）
  if (channel && channel.name !== name && configText === "") {
    // 简单同步初始 name；config 因为不返回所以为空，让用户主动重新输入。
    setName(channel.name);
    setEnabled(channel.enabled);
  }

  if (!channel) return null;

  const submit = () => {
    const data: Record<string, unknown> = { name, enabled };
    if (configText.trim() !== "") {
      try {
        data.config = JSON.parse(configText);
      } catch {
        toast.error(t("notify.configJsonInvalid", "配置必须是合法 JSON"));
        return;
      }
    }
    m.mutate(data, {
      onSuccess: () => {
        toast.success(t("notify.updated", "通道已更新"));
        setConfigText("");
        onClose();
      },
      onError: (e) => toast.error(`${e}`),
    });
  };

  return (
    <Sheet open={!!channel} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>
            {t("notify.editTitle", "编辑通道")} — {channel.name}
          </SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <div className="space-y-1">
            <Label>{t("notify.name", "名称")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>
              {t("notify.config", "配置 (JSON)")}
              <span className="ml-2 text-xs text-muted-foreground">
                {t("notify.configEditHint", "为空则保留原配置")}
              </span>
            </Label>
            <textarea
              className="min-h-32 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              placeholder={t("notify.configEditPlaceholder", "重新粘贴完整 JSON 才会覆盖；不变更则留空。")}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {t("notify.enabled", "启用")}
          </label>
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel", "取消")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={m.isPending}>
            {t("common.save", "保存")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
