import type {SSHKey} from "@/features/ssh-keys/api";
import { createFileRoute } from "@tanstack/react-router";
import { Key, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useCreateSSHKeyMutation,
  useDeleteSSHKeyMutation,
  useSSHKeysQuery,
} from "@/features/ssh-keys/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { Input, Textarea } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { Skeleton } from "@/shared/components/ui/skeleton";

export const Route = createFileRoute("/ssh-keys")({
  component: SSHKeysPage,
});

function SSHKeysPage() {
  const { t } = useTranslation();
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading } = useSSHKeysQuery();
  const keys = data?.keys ?? [];

  return (
    <PageShell>
      <PageHeader
        title={t("sshKey.title", { defaultValue: "SSH 密钥" })}
        description={t("sshKey.description", {
          defaultValue: "管理用于 SSH 登录 VM 的公钥。创建 VM 时可自动注入。",
        })}
        actions={
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            <Plus size={14} aria-hidden="true" />
            {t("sshKey.add", { defaultValue: "添加密钥" })}
          </Button>
        }
      />
      <PageContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : keys.length === 0 ? (
          <EmptyState
            icon={Key}
            title={t("sshKey.emptyTitle", { defaultValue: "暂无 SSH 密钥" })}
            description={t("sshKey.empty", {
              defaultValue: "添加密钥后可在创建 VM 时自动注入到 ~/.ssh/authorized_keys。",
            })}
            action={
              <Button variant="primary" onClick={() => setAddOpen(true)}>
                <Plus size={14} aria-hidden="true" />
                {t("sshKey.add", { defaultValue: "添加密钥" })}
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <KeyCard key={k.id} sshKey={k} />
            ))}
          </div>
        )}
      </PageContent>
      <AddKeySheet open={addOpen} onClose={() => setAddOpen(false)} />
    </PageShell>
  );
}

function AddKeySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [pubKey, setPubKey] = useState("");
  const mutation = useCreateSSHKeyMutation();

  const submit = () => {
    mutation.mutate(
      { name, public_key: pubKey },
      {
        onSuccess: () => {
          setName("");
          setPubKey("");
          onClose();
        },
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" size="min(96vw, 32rem)">
        <SheetHeader>
          <SheetTitle>{t("sshKey.addTitle", { defaultValue: "添加 SSH 公钥" })}</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ssh-name">
              {t("sshKey.nameLabel", { defaultValue: "名称（可选）" })}
            </Label>
            <Input
              id="ssh-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("sshKey.namePlaceholder", { defaultValue: "如 my-laptop" })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ssh-pubkey" required>
              {t("sshKey.pubKeyLabel", { defaultValue: "公钥内容" })}
            </Label>
            <Textarea
              id="ssh-pubkey"
              value={pubKey}
              onChange={(e) => setPubKey(e.target.value)}
              placeholder="ssh-rsa AAAA... / ssh-ed25519 AAAA..."
              rows={6}
              className="font-mono"
            />
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
          <Button
            variant="primary"
            disabled={mutation.isPending || !pubKey.trim()}
            onClick={submit}
          >
            {mutation.isPending
              ? t("sshKey.adding", { defaultValue: "添加中..." })
              : t("sshKey.addButton", { defaultValue: "添加密钥" })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function KeyCard({ sshKey }: { sshKey: SSHKey }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const deleteMutation = useDeleteSSHKeyMutation();

  const onDelete = async () => {
    const ok = await confirm({
      title: t("sshKey.deleteTitle"),
      message: t("sshKey.deleteMessage", { name: sshKey.name }),
      destructive: true,
    });
    if (ok) deleteMutation.mutate(sshKey.id);
  };

  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-emphasis truncate">{sshKey.name}</div>
          <div className="text-caption font-mono text-text-tertiary mt-1 truncate">
            {sshKey.fingerprint}
          </div>
          <div className="text-caption text-text-tertiary mt-1">
            {t("sshKey.createdAt", { defaultValue: "添加时间" })}{" "}
            {new Date(sshKey.created_at).toLocaleDateString()}
          </div>
        </div>
        <Button
          variant="destructive"
          size="sm"
          disabled={deleteMutation.isPending}
          onClick={onDelete}
        >
          <Trash2 size={12} aria-hidden="true" />
          {t("common.delete")}
        </Button>
      </CardContent>
    </Card>
  );
}
