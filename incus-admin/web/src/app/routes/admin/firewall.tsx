import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  type FirewallGroup,
  type FirewallRule,
  useCreateFirewallGroupMutation,
  useDeleteFirewallGroupMutation,
  useFirewallGroupsQuery,
  useReplaceFirewallRulesMutation,
} from "@/features/firewall/api";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";

export const Route = createFileRoute("/admin/firewall")({
  component: FirewallPage,
});

function FirewallPage() {
  const { t } = useTranslation();
  const [showCreate, setShowCreate] = useState(false);
  const [editingID, setEditingID] = useState<number | null>(null);
  const { data, isLoading } = useFirewallGroupsQuery();
  const groups = data?.groups ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("admin.firewall.title", "防火墙组")}</h1>
        <button
          onClick={() => {
            setShowCreate(!showCreate);
            setEditingID(null);
          }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
        >
          {showCreate ? t("common.cancel", "取消") : t("admin.firewall.add", "+ 添加组")}
        </button>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        {t(
          "admin.firewall.hint",
          "每组落地为 Incus network ACL (fwg-<slug>)。用户把组绑定到 VM NIC (security.acls)，规则立即生效。默认 L4 安全组，复杂场景走应用侧 WAF。",
        )}
      </p>

      {showCreate && <CreateGroupPanel onDone={() => setShowCreate(false)} />}

      {isLoading ? (
        <div className="text-muted-foreground">{t("common.loading", "加载中...")}</div>
      ) : groups.length === 0 ? (
        <div className="border border-border rounded-lg p-6 text-center text-muted-foreground">
          {t("admin.firewall.empty", "暂无防火墙组。")}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              editing={editingID === g.id}
              onToggleEdit={() => setEditingID(editingID === g.id ? null : g.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupCard({
  group,
  editing,
  onToggleEdit,
}: {
  group: FirewallGroup;
  editing: boolean;
  onToggleEdit: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const deleteMutation = useDeleteFirewallGroupMutation(group.id);
  const rules = group.rules ?? [];

  const onDelete = async () => {
    const ok = await confirm({
      title: t("admin.firewall.deleteTitle", "删除防火墙组"),
      message: t("admin.firewall.deleteMessage", {
        name: group.name,
        defaultValue: `确认删除防火墙组 "${group.name}"？已绑定的 VM NIC 会自动解除。`,
      }),
      destructive: true,
    });
    if (!ok) return;
    deleteMutation.mutate(undefined, {
      onSuccess: () => toast.success(t("admin.firewall.deleted", "已删除")),
      onError: (err) => toast.error((err as Error).message),
    });
  };

  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="px-4 py-3 flex items-center justify-between border-b border-border">
        <div>
          <div className="font-semibold">{group.name}</div>
          <div className="text-xs text-muted-foreground font-mono">
            {group.slug} · fwg-{group.slug}
          </div>
          {group.description && (
            <div className="text-xs text-muted-foreground mt-1">{group.description}</div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onToggleEdit}
            className="px-2 py-1 text-xs rounded border border-border hover:bg-muted"
          >
            {editing
              ? t("common.collapse", "收起")
              : t("admin.firewall.edit", "编辑规则")}
          </button>
          <button
            onClick={onDelete}
            disabled={deleteMutation.isPending}
            aria-label={`Delete firewall group ${group.name}`}
            data-testid={`delete-firewall-group-${group.slug}`}
            className="px-2 py-1 text-xs rounded border border-destructive text-destructive hover:bg-destructive/10"
          >
            ⚠ {t("common.delete", "删除")}
          </button>
        </div>
      </div>

      {editing ? (
        <RulesEditor groupID={group.id} initial={rules} />
      ) : (
        <RulesTable rules={rules} />
      )}
    </div>
  );
}

function RulesTable({ rules }: { rules: FirewallRule[] }) {
  const { t } = useTranslation();
  if (rules.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        {t("admin.firewall.noRules", "无规则")}
      </div>
    );
  }
  return (
    <table className="w-full text-xs">
      <thead className="bg-muted/20">
        <tr>
          <th className="text-left px-4 py-2">{t("admin.firewall.ruleAction", "动作")}</th>
          <th className="text-left px-4 py-2">{t("admin.firewall.ruleProtocol", "协议")}</th>
          <th className="text-left px-4 py-2">{t("admin.firewall.ruleDestPort", "端口")}</th>
          <th className="text-left px-4 py-2">{t("admin.firewall.ruleSource", "来源")}</th>
          <th className="text-left px-4 py-2">{t("admin.firewall.ruleDescription", "说明")}</th>
        </tr>
      </thead>
      <tbody>
        {rules.map((r, i) => (
          <tr key={i} className="border-t border-border">
            <td className="px-4 py-2">
              <ActionBadge action={r.action} />
            </td>
            <td className="px-4 py-2 font-mono">{r.protocol || "any"}</td>
            <td className="px-4 py-2 font-mono">{r.destination_port || "any"}</td>
            <td className="px-4 py-2 font-mono">{r.source_cidr || "any"}</td>
            <td className="px-4 py-2 text-muted-foreground">{r.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ActionBadge({ action }: { action: string }) {
  const color =
    action === "allow"
      ? "bg-success/20 text-success"
      : action === "reject"
        ? "bg-warning/20 text-warning"
        : "bg-destructive/20 text-destructive";
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>{action}</span>
  );
}

function RulesEditor({
  groupID,
  initial,
}: {
  groupID: number;
  initial: FirewallRule[];
}) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<FirewallRule[]>(
    initial.length > 0 ? initial : [emptyRule()],
  );
  const mutation = useReplaceFirewallRulesMutation(groupID);

  const patch = (i: number, patch: Partial<FirewallRule>) => {
    setRules(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const add = () => setRules([...rules, emptyRule(rules.length * 10 + 10)]);
  const remove = (i: number) => setRules(rules.filter((_, idx) => idx !== i));
  const save = () =>
    mutation.mutate(rules, {
      onSuccess: (res) => {
        if (res.warning) {
          toast.warning(`${res.warning}: ${res.sync_err ?? ""}`);
        } else {
          toast.success(t("admin.firewall.saved", "规则已保存"));
        }
      },
      onError: (err) => toast.error((err as Error).message),
    });

  return (
    <div className="p-4 space-y-2">
      {rules.map((r, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-center text-xs">
          <select
            value={r.action}
            onChange={(e) => patch(i, { action: e.target.value as FirewallRule["action"] })}
            className="col-span-2 px-2 py-1 rounded border border-border bg-card"
          >
            <option value="allow">allow</option>
            <option value="reject">reject</option>
            <option value="drop">drop</option>
          </select>
          <select
            value={r.protocol}
            onChange={(e) => patch(i, { protocol: e.target.value as FirewallRule["protocol"] })}
            className="col-span-2 px-2 py-1 rounded border border-border bg-card"
          >
            <option value="tcp">tcp</option>
            <option value="udp">udp</option>
            <option value="icmp4">icmp4</option>
            <option value="icmp6">icmp6</option>
          </select>
          <input
            type="text"
            placeholder={t("admin.firewall.portPlaceholder", "22,80 or 1000-2000")}
            value={r.destination_port}
            onChange={(e) => patch(i, { destination_port: e.target.value })}
            className="col-span-2 px-2 py-1 rounded border border-border bg-card font-mono"
          />
          <input
            type="text"
            placeholder="10.0.0.0/8"
            value={r.source_cidr}
            onChange={(e) => patch(i, { source_cidr: e.target.value })}
            className="col-span-2 px-2 py-1 rounded border border-border bg-card font-mono"
          />
          <input
            type="text"
            placeholder={t("admin.firewall.descPlaceholder", "说明")}
            value={r.description}
            onChange={(e) => patch(i, { description: e.target.value })}
            className="col-span-3 px-2 py-1 rounded border border-border bg-card"
          />
          <button
            onClick={() => remove(i)}
            disabled={rules.length === 1}
            className="col-span-1 px-2 py-1 rounded border border-destructive/30 text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            −
          </button>
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <button
          onClick={add}
          className="px-3 py-1 rounded border border-border text-xs hover:bg-muted"
        >
          {t("admin.firewall.addRule", "+ 添加规则")}
        </button>
        <button
          onClick={save}
          disabled={mutation.isPending}
          className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs disabled:opacity-50"
        >
          {mutation.isPending
            ? t("common.saving", "保存中...")
            : t("admin.firewall.saveRules", "保存规则")}
        </button>
      </div>
    </div>
  );
}

function emptyRule(sort = 0): FirewallRule {
  return {
    action: "allow",
    protocol: "tcp",
    destination_port: "",
    source_cidr: "",
    description: "",
    sort_order: sort,
  };
}

function CreateGroupPanel({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const mutation = useCreateFirewallGroupMutation();

  const submit = () => {
    mutation.mutate(
      { slug, name, description, rules: [emptyRule()] },
      {
        onSuccess: (res) => {
          if (res.warning) {
            toast.warning(`${res.warning}: ${res.sync_err ?? ""}`);
          } else {
            toast.success(t("admin.firewall.created", "组已创建"));
          }
          onDone();
        },
        onError: (err) => toast.error((err as Error).message),
      },
    );
  };

  return (
    <div className="border border-border rounded-lg bg-card p-4 mb-6 space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <label className="block text-xs">
          <span className="text-muted-foreground block mb-1">
            {t("admin.firewall.name", "名称")}
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Web"
            className="w-full px-3 py-2 rounded border border-border bg-card text-sm"
          />
        </label>
        <label className="block text-xs">
          <span className="text-muted-foreground block mb-1">Slug</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="web-basic"
            className="w-full px-3 py-2 rounded border border-border bg-card text-sm font-mono"
          />
        </label>
        <label className="block text-xs">
          <span className="text-muted-foreground block mb-1">
            {t("admin.firewall.description", "说明")}
          </span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded border border-border bg-card text-sm"
          />
        </label>
      </div>
      {mutation.isError && (
        <div className="text-destructive text-sm">
          {(mutation.error as Error).message}
        </div>
      )}
      <button
        onClick={submit}
        disabled={mutation.isPending || !slug || !name}
        className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50"
      >
        {mutation.isPending
          ? t("common.saving", "保存中...")
          : t("admin.firewall.create", "创建组")}
      </button>
    </div>
  );
}
