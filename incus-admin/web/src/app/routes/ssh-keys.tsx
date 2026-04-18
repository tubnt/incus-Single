import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import {
  type SSHKey,
  useCreateSSHKeyMutation,
  useDeleteSSHKeyMutation,
  useSSHKeysQuery,
} from "@/features/ssh-keys/api";

export const Route = createFileRoute("/ssh-keys")({
  component: SSHKeysPage,
});

function SSHKeysPage() {
  const { t } = useTranslation();
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading } = useSSHKeysQuery();
  const keys = data?.keys ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("sshKey.title", { defaultValue: "SSH Keys" })}</h1>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
        >
          {showAdd ? t("common.cancel", { defaultValue: "取消" }) : `+ ${t("sshKey.add", { defaultValue: "添加密钥" })}`}
        </button>
      </div>

      {showAdd && <AddKeyForm onDone={() => setShowAdd(false)} />}

      {isLoading ? (
        <div className="text-muted-foreground">{t("common.loading")}</div>
      ) : keys.length === 0 ? (
        <div className="border border-border rounded-lg p-8 text-center text-muted-foreground">
          {t("sshKey.empty", { defaultValue: "暂无 SSH 密钥。添加密钥后可在创建 VM 时自动注入。" })}
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((k) => (
            <KeyCard key={k.id} sshKey={k} />
          ))}
        </div>
      )}
    </div>
  );
}

function AddKeyForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [pubKey, setPubKey] = useState("");

  const mutation = useCreateSSHKeyMutation();

  return (
    <div className="border border-border rounded-lg bg-card p-4 mb-6">
      <h3 className="font-semibold mb-3">{t("sshKey.addTitle", { defaultValue: "添加 SSH 公钥" })}</h3>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("sshKey.namePlaceholder", { defaultValue: "名称（可选，如 my-laptop）" })}
        className="w-full px-3 py-2 mb-3 rounded border border-border bg-card text-sm"
      />
      <textarea
        value={pubKey}
        onChange={(e) => setPubKey(e.target.value)}
        placeholder="ssh-rsa AAAA... / ssh-ed25519 AAAA..."
        rows={4}
        className="w-full px-3 py-2 mb-3 rounded border border-border bg-card text-sm font-mono"
      />
      {mutation.isError && (
        <div className="text-destructive text-sm mb-2">{(mutation.error as Error).message}</div>
      )}
      <button
        onClick={() => mutation.mutate({ name, public_key: pubKey }, { onSuccess: onDone })}
        disabled={mutation.isPending || !pubKey.trim()}
        className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50"
      >
        {mutation.isPending ? t("sshKey.adding", { defaultValue: "添加中..." }) : t("sshKey.addButton", { defaultValue: "添加密钥" })}
      </button>
    </div>
  );
}

function KeyCard({ sshKey }: { sshKey: SSHKey }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const deleteMutation = useDeleteSSHKeyMutation();

  return (
    <div className="border border-border rounded-lg bg-card p-4 flex items-center justify-between">
      <div>
        <div className="font-medium">{sshKey.name}</div>
        <div className="text-xs text-muted-foreground font-mono mt-1">
          {sshKey.fingerprint}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {t("sshKey.createdAt", { defaultValue: "添加时间" })} {new Date(sshKey.created_at).toLocaleDateString()}
        </div>
      </div>
      <button
        onClick={async () => {
          const ok = await confirm({
            title: t("sshKey.deleteTitle"),
            message: t("sshKey.deleteMessage", { name: sshKey.name }),
            destructive: true,
          });
          if (ok) deleteMutation.mutate(sshKey.id);
        }}
        disabled={deleteMutation.isPending}
        className="px-3 py-1.5 text-xs bg-destructive/20 text-destructive rounded hover:bg-destructive/30 disabled:opacity-50"
      >
        {t("common.delete")}
      </button>
    </div>
  );
}
