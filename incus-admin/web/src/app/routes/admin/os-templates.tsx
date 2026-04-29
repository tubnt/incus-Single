import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  type OSTemplate,
  type OSTemplateFormData,
  useAdminOSTemplatesQuery,
  useCreateOSTemplateMutation,
  useDeleteOSTemplateMutation,
  useUpdateOSTemplateMutation,
} from "@/features/templates/api";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";

export const Route = createFileRoute("/admin/os-templates")({
  component: OSTemplatesPage,
});

const EMPTY_FORM: OSTemplateFormData = {
  slug: "",
  name: "",
  source: "",
  protocol: "simplestreams",
  server_url: "https://images.linuxcontainers.org",
  default_user: "ubuntu",
  cloud_init_template: "",
  supports_rescue: false,
  enabled: true,
  sort_order: 100,
};

function OSTemplatesPage() {
  const { t } = useTranslation();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<OSTemplate | null>(null);

  const { data, isLoading } = useAdminOSTemplatesQuery();
  const templates = data?.templates ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">
          {t("admin.osTemplates.title", "OS 镜像模板")}
        </h1>
        <button
          onClick={() => {
            setShowCreate(!showCreate);
            setEditing(null);
          }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
        >
          {showCreate ? t("common.cancel", "取消") : t("admin.osTemplates.add", "+ 添加模板")}
        </button>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        {t(
          "admin.osTemplates.hint",
          "这里维护用户在创建 / 重装 VM 时可选的 OS 镜像。新增镜像无需改代码。",
        )}
      </p>

      {showCreate && <TemplateForm onDone={() => setShowCreate(false)} />}

      {editing && (
        <TemplateForm template={editing} onDone={() => setEditing(null)} />
      )}

      {isLoading ? (
        <div className="text-muted-foreground">{t("common.loading", "加载中...")}</div>
      ) : templates.length === 0 ? (
        <div className="border border-border rounded-lg p-6 text-center text-muted-foreground">
          {t("admin.osTemplates.empty", "暂无模板。点击右上角添加。")}
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2 font-medium">{t("admin.osTemplates.name", "名称")}</th>
                <th className="text-left px-4 py-2 font-medium">Slug</th>
                <th className="text-left px-4 py-2 font-medium">{t("admin.osTemplates.source", "镜像源")}</th>
                <th className="text-left px-4 py-2 font-medium">{t("admin.osTemplates.defaultUser", "默认用户")}</th>
                <th className="text-right px-4 py-2 font-medium">{t("admin.osTemplates.sortOrder", "排序")}</th>
                <th className="text-left px-4 py-2 font-medium">{t("admin.osTemplates.status", "状态")}</th>
                <th className="text-right px-4 py-2 font-medium">{t("admin.osTemplates.actions", "操作")}</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((tpl) => (
                <TemplateRow
                  key={tpl.id}
                  template={tpl}
                  onEdit={() => {
                    setEditing(tpl);
                    setShowCreate(false);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TemplateRow({ template, onEdit }: { template: OSTemplate; onEdit: () => void }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const toggleMutation = useUpdateOSTemplateMutation(template.id);
  const deleteMutation = useDeleteOSTemplateMutation(template.id);

  const onDelete = async () => {
    const ok = await confirm({
      title: t("admin.osTemplates.deleteTitle", "删除模板"),
      message: t(
        "admin.osTemplates.deleteMessage",
        { defaultValue: `确认删除模板「${template.name}」?`, name: template.name },
      ),
      destructive: true,
    });
    if (!ok) return;
    deleteMutation.mutate(undefined, {
      onSuccess: () => toast.success(t("admin.osTemplates.deleted", "已删除")),
      onError: (err) => toast.error((err as Error).message),
    });
  };

  return (
    <tr className="border-t border-border">
      <td className="px-4 py-2 font-medium">{template.name}</td>
      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{template.slug}</td>
      <td className="px-4 py-2 font-mono text-xs">{template.source}</td>
      <td className="px-4 py-2">{template.default_user}</td>
      <td className="px-4 py-2 text-right font-mono">{template.sort_order}</td>
      <td className="px-4 py-2">
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${template.enabled ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"}`}
        >
          {template.enabled
            ? t("admin.osTemplates.enabled", "启用")
            : t("admin.osTemplates.disabled", "停用")}
        </span>
      </td>
      <td className="px-4 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onEdit}
            className="px-2 py-1 text-xs rounded border border-border hover:bg-muted"
          >
            {t("common.edit", "编辑")}
          </button>
          <button
            onClick={() => toggleMutation.mutate({ enabled: !template.enabled })}
            disabled={toggleMutation.isPending}
            aria-label={
              template.enabled
                ? `Disable OS template ${template.slug}`
                : `Enable OS template ${template.slug}`
            }
            data-testid={
              template.enabled
                ? `disable-os-template-${template.slug}`
                : `enable-os-template-${template.slug}`
            }
            className={`px-2 py-1 text-xs rounded border ${
              template.enabled
                ? "border-destructive text-destructive hover:bg-destructive/10"
                : "border-success/30 text-success hover:bg-success/10"
            }`}
          >
            {template.enabled
              ? `⚠ ${t("admin.osTemplates.disable", "停用")}`
              : t("admin.osTemplates.enable", "启用")}
          </button>
          <button
            onClick={onDelete}
            disabled={deleteMutation.isPending}
            aria-label={`Delete OS template ${template.slug}`}
            data-testid={`delete-os-template-${template.slug}`}
            className="px-2 py-1 text-xs rounded border border-destructive text-destructive hover:bg-destructive/10"
          >
            ⚠ {t("common.delete", "删除")}
          </button>
        </div>
      </td>
    </tr>
  );
}

function TemplateForm({
  template,
  onDone,
}: {
  template?: OSTemplate;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = !!template;

  const [form, setForm] = useState<OSTemplateFormData>(
    template
      ? {
          slug: template.slug,
          name: template.name,
          source: template.source,
          protocol: template.protocol,
          server_url: template.server_url,
          default_user: template.default_user,
          cloud_init_template: template.cloud_init_template,
          supports_rescue: template.supports_rescue,
          enabled: template.enabled,
          sort_order: template.sort_order,
        }
      : EMPTY_FORM,
  );

  const createMutation = useCreateOSTemplateMutation();
  const updateMutation = useUpdateOSTemplateMutation(template?.id ?? 0);
  const mutation = isEdit ? updateMutation : createMutation;

  const onSubmit = () => {
    mutation.mutate(form, {
      onSuccess: () => {
        toast.success(
          isEdit
            ? t("admin.osTemplates.updated", "已保存")
            : t("admin.osTemplates.created", "已创建"),
        );
        onDone();
      },
      onError: (err) => toast.error((err as Error).message),
    });
  };

  const set = <K extends keyof OSTemplateFormData>(k: K, v: OSTemplateFormData[K]) =>
    setForm({ ...form, [k]: v });

  return (
    <div className="border border-border rounded-lg bg-card p-4 mb-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">
          {isEdit
            ? t("admin.osTemplates.editTitle", "编辑模板")
            : t("admin.osTemplates.createTitle", "添加模板")}
        </h3>
        <button
          onClick={onDone}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {t("common.cancel", "取消")}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("admin.osTemplates.name", "名称")}>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Ubuntu 24.04 LTS"
            className="w-full px-3 py-2 rounded border border-border bg-card text-sm"
          />
        </Field>
        <Field label="Slug">
          <input
            value={form.slug}
            onChange={(e) => set("slug", e.target.value)}
            placeholder="ubuntu-24-04"
            className="w-full px-3 py-2 rounded border border-border bg-card text-sm font-mono"
          />
        </Field>
        <Field label={t("admin.osTemplates.source", "镜像源 (images:… 不含前缀)")}>
          <input
            value={form.source}
            onChange={(e) => set("source", e.target.value)}
            placeholder="ubuntu/24.04/cloud"
            className="w-full px-3 py-2 rounded border border-border bg-card text-sm font-mono"
          />
        </Field>
        <Field label={t("admin.osTemplates.defaultUser", "默认用户")}>
          <input
            value={form.default_user}
            onChange={(e) => set("default_user", e.target.value)}
            placeholder="ubuntu"
            className="w-full px-3 py-2 rounded border border-border bg-card text-sm"
          />
        </Field>
        <Field label={t("admin.osTemplates.protocol", "协议")}>
          <select
            value={form.protocol}
            onChange={(e) => set("protocol", e.target.value)}
            className="w-full px-3 py-2 rounded border border-border bg-card text-sm"
          >
            <option value="simplestreams">simplestreams</option>
            <option value="incus">incus</option>
          </select>
        </Field>
        <Field label={t("admin.osTemplates.serverUrl", "镜像服务器")}>
          <input
            value={form.server_url}
            onChange={(e) => set("server_url", e.target.value)}
            className="w-full px-3 py-2 rounded border border-border bg-card text-sm font-mono"
          />
        </Field>
        <Field label={t("admin.osTemplates.sortOrder", "排序")}>
          <input
            type="number"
            value={form.sort_order}
            onChange={(e) => set("sort_order", +e.target.value)}
            className="w-full px-3 py-2 rounded border border-border bg-card text-sm"
          />
        </Field>
        <div className="flex items-center gap-4 pt-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => set("enabled", e.target.checked)}
            />
            {t("admin.osTemplates.enabled", "启用")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.supports_rescue}
              onChange={(e) => set("supports_rescue", e.target.checked)}
            />
            {t("admin.osTemplates.supportsRescue", "支持救援模式")}
          </label>
        </div>
      </div>

      {mutation.isError && (
        <div className="text-destructive text-sm">
          {(mutation.error as Error).message}
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={mutation.isPending || !form.name || !form.slug || !form.source}
        className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50"
      >
        {mutation.isPending
          ? t("common.saving", "保存中...")
          : isEdit
            ? t("common.save", "保存")
            : t("admin.osTemplates.create", "创建模板")}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground mb-1 block">{label}</span>
      {children}
    </label>
  );
}
