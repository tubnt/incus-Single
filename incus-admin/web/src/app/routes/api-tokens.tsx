import type {APIToken} from "@/features/api-tokens/api";
import { createFileRoute } from "@tanstack/react-router";
import { KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAPITokensQuery,
  useCreateAPITokenMutation,
  useDeleteAPITokenMutation,
  useRenewAPITokenMutation,
} from "@/features/api-tokens/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { SecretReveal } from "@/shared/components/ui/secret-reveal";
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
import { cn } from "@/shared/lib/utils";

const TTL_OPTIONS: Array<{ hours: number; label: string }> = [
  { hours: 1, label: "1 小时" },
  { hours: 6, label: "6 小时" },
  { hours: 24, label: "24 小时（默认）" },
  { hours: 168, label: "7 天" },
  { hours: 720, label: "30 天" },
  { hours: 2160, label: "90 天（最长）" },
];

function formatTimeLeft(expiresAt: string | null): { text: string; tone: "normal" | "warn" | "expired" } {
  if (!expiresAt) return { text: "永不过期", tone: "normal" };
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { text: "已过期", tone: "expired" };
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  let text: string;
  if (days >= 1) text = `${days} 天后过期`;
  else if (hours >= 1) text = `${hours} 小时后过期`;
  else text = `${Math.max(1, Math.floor(ms / 60_000))} 分钟后过期`;
  const tone = hours < 1 ? "warn" : "normal";
  return { text, tone };
}

export const Route = createFileRoute("/api-tokens")({
  component: APITokensPage,
});

function APITokensPage() {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  const { data, isLoading } = useAPITokensQuery();
  const tokens = data?.tokens ?? [];

  return (
    <PageShell>
      <PageHeader
        title={t("apiToken.title", { defaultValue: "API Tokens" })}
        description={t("apiToken.description", {
          defaultValue: "用于程序化访问 API 的令牌，最长 90 天有效期。",
        })}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} aria-hidden="true" />
            {t("apiToken.create", { defaultValue: "创建 Token" })}
          </Button>
        }
      />
      <PageContent>
        {revealedToken ? (
          <Card className="border-status-success/30 bg-status-success/8">
            <CardContent className="p-4 space-y-3">
              <div className="font-[510] text-sm">
                {t("apiToken.createdSaveNow", {
                  defaultValue: "Token 创建成功！请立即保存，此后不再显示。",
                })}
              </div>
              <SecretReveal value={revealedToken} inline={false} autoMaskMs={0} />
              <div className="flex justify-end">
                <Button variant="ghost" onClick={() => setRevealedToken(null)}>
                  {t("common.ok", { defaultValue: "好的" })}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : tokens.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title={t("apiToken.emptyTitle", { defaultValue: "暂无 API Token" })}
            description={t("apiToken.empty", {
              defaultValue: "创建后可用于程序化访问 API。",
            })}
            action={
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus size={14} aria-hidden="true" />
                {t("apiToken.create", { defaultValue: "创建 Token" })}
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            {tokens.map((tk) => (
              <TokenCard key={tk.id} token={tk} onRenewed={(raw) => setRevealedToken(raw)} />
            ))}
          </div>
        )}
      </PageContent>
      <CreateTokenSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(raw) => {
          setRevealedToken(raw);
          setCreateOpen(false);
        }}
      />
    </PageShell>
  );
}

function CreateTokenSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (raw: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [ttlHours, setTtlHours] = useState("24");
  const mutation = useCreateAPITokenMutation();

  const submit = () => {
    mutation.mutate(
      { name, expiresInHours: Number(ttlHours) },
      {
        onSuccess: (data) => {
          if (data.token.token) {
            onCreated(data.token.token);
            setName("");
            setTtlHours("24");
          }
        },
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" size="min(96vw, 28rem)">
        <SheetHeader>
          <SheetTitle>
            {t("apiToken.createTitle", { defaultValue: "创建 API Token" })}
          </SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="token-name">{t("apiToken.nameLabel", { defaultValue: "名称" })}</Label>
            <Input
              id="token-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("apiToken.namePlaceholder", { defaultValue: "如 ci-deploy" })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("apiToken.ttlLabel", { defaultValue: "有效期" })}</Label>
            <Select value={ttlHours} onValueChange={(v) => setTtlHours(String(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TTL_OPTIONS.map((o) => (
                  <SelectItem key={o.hours} value={String(o.hours)}>
                    {o.label}
                  </SelectItem>
                ))}
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
          <Button variant="primary" disabled={mutation.isPending} onClick={submit}>
            {mutation.isPending
              ? t("apiToken.submitting", { defaultValue: "创建中..." })
              : t("apiToken.submit", { defaultValue: "创建" })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function TokenCard({
  token,
  onRenewed,
}: {
  token: APIToken;
  onRenewed: (raw: string) => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const deleteMutation = useDeleteAPITokenMutation();
  const renewMutation = useRenewAPITokenMutation();
  const [renewTtl, setRenewTtl] = useState("24");

  const expiry = formatTimeLeft(token.expires_at);
  const expiryColor =
    expiry.tone === "expired"
      ? "text-status-error"
      : expiry.tone === "warn"
        ? "text-status-warning"
        : "text-text-tertiary";

  const onDelete = async () => {
    const ok = await confirm({
      title: t("apiToken.deleteTitle"),
      message: t("apiToken.deleteMessage", { name: token.name }),
      destructive: true,
    });
    if (ok) deleteMutation.mutate(token.id);
  };

  return (
    <Card>
      <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-[510] truncate">{token.name}</div>
          <div className="text-caption text-text-tertiary mt-1">
            {t("apiToken.createdAt", { defaultValue: "创建于" })}{" "}
            {new Date(token.created_at).toLocaleDateString()}
            {token.last_used_at
              ? ` · ${t("apiToken.lastUsedAt", { defaultValue: "最后使用" })} ${new Date(token.last_used_at).toLocaleString()}`
              : null}
          </div>
          <div className={cn("text-caption mt-1", expiryColor)}>{expiry.text}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={renewTtl} onValueChange={(v) => setRenewTtl(String(v))}>
            <SelectTrigger
              className="h-7 text-xs w-[10rem]"
              aria-label={t("apiToken.renewTtl", { defaultValue: "续签有效期" })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TTL_OPTIONS.map((o) => (
                <SelectItem key={o.hours} value={String(o.hours)}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="primary"
            disabled={renewMutation.isPending || expiry.tone === "expired"}
            onClick={() =>
              renewMutation.mutate(
                { id: token.id, expiresInHours: Number(renewTtl) },
                {
                  onSuccess: (data) => {
                    if (data.token.token) onRenewed(data.token.token);
                  },
                },
              )
            }
          >
            <RefreshCw size={12} aria-hidden="true" />
            {renewMutation.isPending
              ? t("apiToken.renewing", { defaultValue: "续签中..." })
              : t("apiToken.renew", { defaultValue: "续签" })}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={deleteMutation.isPending}
            aria-label={`Delete API token ${token.name}`}
            data-testid={`delete-api-token-${token.id}`}
            onClick={onDelete}
          >
            <Trash2 size={12} aria-hidden="true" />
            {t("common.delete")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
