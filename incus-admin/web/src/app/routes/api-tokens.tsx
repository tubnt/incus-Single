import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import {
  type APIToken,
  useAPITokensQuery,
  useCreateAPITokenMutation,
  useDeleteAPITokenMutation,
} from "@/features/api-tokens/api";

export const Route = createFileRoute("/api-tokens")({
  component: APITokensPage,
});

function APITokensPage() {
  const { t } = useTranslation();
  const [showCreate, setShowCreate] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  const { data, isLoading } = useAPITokensQuery();
  const tokens = data?.tokens ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("apiToken.title", { defaultValue: "API Tokens" })}</h1>
        <button
          onClick={() => { setShowCreate(!showCreate); setNewToken(null); }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
        >
          {showCreate ? t("common.cancel", { defaultValue: "取消" }) : `+ ${t("apiToken.create", { defaultValue: "创建 Token" })}`}
        </button>
      </div>

      {newToken && (
        <div className="border border-success/30 bg-success/10 rounded-lg p-4 mb-6">
          <div className="font-medium text-sm mb-2">{t("apiToken.createdSaveNow", { defaultValue: "Token 创建成功！请立即保存，此后不再显示：" })}</div>
          <code className="text-xs font-mono bg-card px-3 py-2 rounded block break-all">{newToken}</code>
        </div>
      )}

      {showCreate && <CreateTokenForm onCreated={(token) => { setNewToken(token); setShowCreate(false); }} />}

      {isLoading ? (
        <div className="text-muted-foreground">{t("common.loading")}</div>
      ) : tokens.length === 0 ? (
        <div className="border border-border rounded-lg p-8 text-center text-muted-foreground">
          {t("apiToken.empty", { defaultValue: "暂无 API Token。创建后可用于程序化访问 API。" })}
        </div>
      ) : (
        <div className="space-y-3">
          {tokens.map((tk) => (
            <TokenCard key={tk.id} token={tk} />
          ))}
        </div>
      )}
    </div>
  );
}

function CreateTokenForm({ onCreated }: { onCreated: (token: string) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const mutation = useCreateAPITokenMutation();

  return (
    <div className="border border-border rounded-lg bg-card p-4 mb-6">
      <h3 className="font-semibold mb-3">{t("apiToken.createTitle", { defaultValue: "创建 API Token" })}</h3>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("apiToken.namePlaceholder", { defaultValue: "名称（如 ci-deploy）" })}
        className="w-full px-3 py-2 mb-3 rounded border border-border bg-card text-sm"
      />
      <button
        onClick={() => mutation.mutate(name, {
          onSuccess: (data) => { if (data.token.token) onCreated(data.token.token); },
        })}
        disabled={mutation.isPending}
        className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50"
      >
        {mutation.isPending ? t("apiToken.submitting", { defaultValue: "创建中..." }) : t("apiToken.submit", { defaultValue: "创建" })}
      </button>
    </div>
  );
}

function TokenCard({ token }: { token: APIToken }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const deleteMutation = useDeleteAPITokenMutation();

  return (
    <div className="border border-border rounded-lg bg-card p-4 flex items-center justify-between">
      <div>
        <div className="font-medium">{token.name}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {t("apiToken.createdAt", { defaultValue: "创建于" })} {new Date(token.created_at).toLocaleDateString()}
          {token.last_used_at && ` · ${t("apiToken.lastUsedAt", { defaultValue: "最后使用" })} ${new Date(token.last_used_at).toLocaleString()}`}
        </div>
      </div>
      <button
        onClick={async () => {
          const ok = await confirm({
            title: t("apiToken.deleteTitle"),
            message: t("apiToken.deleteMessage", { name: token.name }),
            destructive: true,
          });
          if (ok) deleteMutation.mutate(token.id);
        }}
        disabled={deleteMutation.isPending}
        className="px-3 py-1.5 text-xs bg-destructive/20 text-destructive rounded hover:bg-destructive/30 disabled:opacity-50"
      >
        {t("common.delete")}
      </button>
    </div>
  );
}
