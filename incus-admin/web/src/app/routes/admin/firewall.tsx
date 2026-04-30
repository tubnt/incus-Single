import type {FirewallGroup, FirewallRule} from "@/features/firewall/api";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {

  useCreateFirewallGroupMutation,
  useDeleteFirewallGroupMutation,
  useFirewallGroupsQuery,
  useReplaceFirewallRulesMutation
} from "@/features/firewall/api";
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

export const Route = createFileRoute("/admin/firewall")({
  component: FirewallPage,
});

function FirewallPage() {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { data, isLoading } = useFirewallGroupsQuery();
  const groups = data?.groups ?? [];

  return (
    <PageShell>
      <PageHeader
        title={t("admin.firewall.title", "防火墙组")}
        description={t(
          "admin.firewall.hint",
          "每组落地为 Incus network ACL (fwg-<slug>)。用户把组绑定到 VM NIC (security.acls)，规则立即生效。默认 L4 安全组，复杂场景走应用侧 WAF。",
        )}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            {t("admin.firewall.add", "添加组")}
          </Button>
        }
      />
      <PageContent>
        {isLoading ? (
          <div className="text-muted-foreground">{t("common.loading", "加载中...")}</div>
        ) : groups.length === 0 ? (
          <EmptyState title={t("admin.firewall.empty", "暂无防火墙组。")} />
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <GroupCard
                key={g.id}
                group={g}
                editing={editingId === g.id}
                onToggleEdit={() => setEditingId(editingId === g.id ? null : g.id)}
              />
            ))}
          </div>
        )}

        <Sheet
          open={createOpen}
          onOpenChange={(o) => {
            if (!o) setCreateOpen(false);
          }}
        >
          <SheetContent side="right" size="min(96vw, 32rem)">
            <CreateGroupPanel onDone={() => setCreateOpen(false)} />
          </SheetContent>
        </Sheet>
      </PageContent>
    </PageShell>
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
    <Card>
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
          <Button variant="ghost" size="sm" onClick={onToggleEdit}>
            {editing
              ? t("common.collapse", "收起")
              : t("admin.firewall.edit", "编辑规则")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={deleteMutation.isPending}
            aria-label={`Delete firewall group ${group.name}`}
            data-testid={`delete-firewall-group-${group.slug}`}
          >
            {t("common.delete", "删除")}
          </Button>
        </div>
      </div>

      {editing ? (
        <RulesEditor groupID={group.id} initial={rules} />
      ) : (
        <RulesTable rules={rules} />
      )}
    </Card>
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
  const status =
    action === "allow"
      ? "success"
      : action === "reject"
        ? "warning"
        : "error";
  return <StatusPill status={status}>{action}</StatusPill>;
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
            className="col-span-2 h-8 px-2 rounded-md border border-border bg-surface-1 text-foreground"
          >
            <option value="allow">allow</option>
            <option value="reject">reject</option>
            <option value="drop">drop</option>
          </select>
          <select
            value={r.protocol}
            onChange={(e) => patch(i, { protocol: e.target.value as FirewallRule["protocol"] })}
            className="col-span-2 h-8 px-2 rounded-md border border-border bg-surface-1 text-foreground"
          >
            <option value="tcp">tcp</option>
            <option value="udp">udp</option>
            <option value="icmp4">icmp4</option>
            <option value="icmp6">icmp6</option>
          </select>
          <Input
            type="text"
            placeholder={t("admin.firewall.portPlaceholder", "22,80 or 1000-2000")}
            value={r.destination_port}
            onChange={(e) => patch(i, { destination_port: e.target.value })}
            className="col-span-2 h-8 font-mono"
          />
          <Input
            type="text"
            placeholder="10.0.0.0/8"
            value={r.source_cidr}
            onChange={(e) => patch(i, { source_cidr: e.target.value })}
            className="col-span-2 h-8 font-mono"
          />
          <Input
            type="text"
            placeholder={t("admin.firewall.descPlaceholder", "说明")}
            value={r.description}
            onChange={(e) => patch(i, { description: e.target.value })}
            className="col-span-3 h-8"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => remove(i)}
            disabled={rules.length === 1}
            className="col-span-1 text-status-error"
          >
            −
          </Button>
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={add}>
          <Plus size={14} />
          {t("admin.firewall.addRule", "添加规则")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={save}
          disabled={mutation.isPending}
        >
          {mutation.isPending
            ? t("common.saving", "保存中...")
            : t("admin.firewall.saveRules", "保存规则")}
        </Button>
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
    <>
      <SheetHeader>
        <SheetTitle>{t("admin.firewall.create", "创建组")}</SheetTitle>
      </SheetHeader>
      <SheetBody>
        <div className="grid grid-cols-1 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fw-name">{t("admin.firewall.name", "名称")}</Label>
            <Input
              id="fw-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Web"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fw-slug">Slug</Label>
            <Input
              id="fw-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="web-basic"
              className="font-mono"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fw-desc">{t("admin.firewall.description", "说明")}</Label>
            <Input
              id="fw-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        {mutation.isError && (
          <div className="text-status-error text-sm mt-3">
            {(mutation.error as Error).message}
          </div>
        )}
      </SheetBody>
      <SheetFooter>
        <Button variant="ghost" onClick={onDone}>
          {t("common.cancel", "取消")}
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={mutation.isPending || !slug || !name}
        >
          {mutation.isPending
            ? t("common.saving", "保存中...")
            : t("admin.firewall.create", "创建组")}
        </Button>
      </SheetFooter>
    </>
  );
}
