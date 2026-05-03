import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useCreateCredentialMutation,
  useDeleteCredentialMutation,
  useNodeCredentialsQuery,
} from "@/features/nodes/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Button, buttonVariants } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { Input, Textarea } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

export const Route = createFileRoute("/admin/node-credentials")({
  component: NodeCredentialsPage,
});

/* ============================================================
 * PLAN-033 / OPS-039 — admin SSH credential vault.
 * Credentials are encrypted at rest (AES-256-GCM, OPS-022 key shared).
 * ============================================================ */

function NodeCredentialsPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const list = useNodeCredentialsQuery();
  const create = useCreateCredentialMutation();
  const del = useDeleteCredentialMutation();

  const [name, setName] = useState("");
  const [kind, setKind] = useState<"password" | "private_key">("password");
  const [password, setPassword] = useState("");
  const [keyData, setKeyData] = useState("");

  const onSave = () => {
    if (!name.trim()) {
      toast.error(t("admin.nodeCredentials.errMissingName", "凭据名必填"));
      return;
    }
    if (kind === "password" && !password) {
      toast.error(t("admin.nodeCredentials.errMissingPassword", "密码必填"));
      return;
    }
    if (kind === "private_key" && !keyData) {
      toast.error(t("admin.nodeCredentials.errMissingKey", "私钥必填"));
      return;
    }
    create.mutate(
      {
        name: name.trim(),
        kind,
        password: kind === "password" ? password : undefined,
        key_data: kind === "private_key" ? keyData : undefined,
      },
      {
        onSuccess: () => {
          toast.success(t("admin.nodeCredentials.saved", "凭据已保存"));
          setName("");
          setPassword("");
          setKeyData("");
        },
        onError: (err) => toast.error((err as Error).message),
      },
    );
  };

  return (
    <PageShell>
      <PageHeader
        title={t("admin.nodeCredentials.title", "节点凭据")}
        actions={
          <Link
            to="/admin/node-join"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {t("common.back", "返回")}
          </Link>
        }
      />
      <PageContent>
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.nodeCredentials.createTitle", "新增凭据")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-status-warning/30 bg-status-warning/8 p-3 text-caption text-status-warning">
              {t(
                "admin.nodeCredentials.securityNote",
                "本页用于保存 admin 进入新节点的 SSH 凭据，操作受 step-up 二次认证保护。所有密码 / 私钥使用 AES-256-GCM 加密落库；列表仅展示指纹。",
              )}
            </div>

            <FormField label={t("admin.nodeCredentials.name", "名称")}>
              <Input
                value={name}
                placeholder="node6-deploy"
                onChange={(e) => setName(e.target.value)}
              />
            </FormField>

            <FormField label={t("admin.nodeCredentials.kind", "类型")}>
              <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="password">{t("admin.nodeCredentials.kindPassword", "密码")}</SelectItem>
                  <SelectItem value="private_key">{t("admin.nodeCredentials.kindKey", "私钥（PEM）")}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            {kind === "password" ? (
              <FormField label={t("admin.nodeCredentials.password", "密码")}>
                <Input
                  type="password"
                  value={password}
                  autoComplete="off"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </FormField>
            ) : (
              <FormField label={t("admin.nodeCredentials.privateKey", "私钥（PEM）")}>
                <Textarea
                  value={keyData}
                  spellCheck={false}
                  autoComplete="off"
                  rows={6}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  onChange={(e) => setKeyData(e.target.value)}
                />
              </FormField>
            )}

            <div className="flex justify-end">
              <Button variant="primary" disabled={create.isPending} onClick={onSave}>
                {create.isPending
                  ? t("common.processing", "处理中...")
                  : t("admin.nodeCredentials.save", "保存凭据")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("admin.nodeCredentials.listTitle", "已保存凭据")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-caption">
                <thead className="bg-surface-1 text-text-tertiary">
                  <tr>
                    <th className="px-3 py-2 text-left">{t("admin.nodeCredentials.name", "名称")}</th>
                    <th className="px-3 py-2 text-left">{t("admin.nodeCredentials.kind", "类型")}</th>
                    <th className="px-3 py-2 text-left">{t("admin.nodeCredentials.fingerprint", "指纹")}</th>
                    <th className="px-3 py-2 text-left">{t("admin.nodeCredentials.lastUsed", "上次使用")}</th>
                    <th className="px-3 py-2 text-right">{t("common.actions", "操作")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(list.data?.credentials ?? []).map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="px-3 py-2 text-text-primary">{c.name}</td>
                      <td className="px-3 py-2 text-text-secondary">
                        {c.kind === "password"
                          ? t("admin.nodeCredentials.kindPassword", "密码")
                          : t("admin.nodeCredentials.kindKey", "私钥（PEM）")}
                      </td>
                      <td className="px-3 py-2 font-mono text-text-secondary break-all">{c.fingerprint ?? "—"}</td>
                      <td className="px-3 py-2 text-text-tertiary">{c.last_used_at ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            const ok = await confirm({
                              title: t("admin.nodeCredentials.deleteTitle", "删除凭据") ?? "",
                              message: t(
                                "admin.nodeCredentials.deleteMessage",
                                {
                                  defaultValue: "确认删除凭据 {{name}}？引用此凭据的 wizard 流程将失败。",
                                  name: c.name,
                                },
                              ),
                              confirmLabel: t("common.delete", "删除") ?? "Delete",
                              destructive: true,
                            });
                            if (!ok) return;
                            del.mutate(c.id, {
                              onSuccess: () => toast.success(t("admin.nodeCredentials.deleted", "已删除")),
                              onError: (err) => toast.error((err as Error).message),
                            });
                          }}
                        >
                          {t("common.delete", "删除")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {list.data?.credentials?.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-text-tertiary">
                        {t("admin.nodeCredentials.empty", "暂无凭据")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </PageContent>

    </PageShell>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
