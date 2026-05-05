import type { FirewallGroup, FirewallRule } from "@/features/firewall/api";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  usePortalCreateFirewallGroupMutation,
  usePortalReplaceFirewallRulesMutation,
  usePortalUpdateFirewallGroupMutation,
} from "@/features/firewall/api";
import { Button } from "@/shared/components/ui/button";
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
import { formatError } from "@/shared/lib/http";
import { cn } from "@/shared/lib/utils";

/**
 * PLAN-035 用户级 firewall group 编辑器（portal 端）。
 *
 * 两个抽屉：
 *   <CreateUserGroupSheet> 新建私有组 + 一条初始规则；POST /portal/firewall/groups
 *   <EditUserGroupSheet>   改 name/description + 替换 rules；PUT 两个 endpoint
 *
 * 视觉走 DESIGN.md token，Sheet 默认 right side + token 圆角阴影。
 */

interface RuleRow extends FirewallRule {
  _uiId: string;
}

const ACTIONS = ["allow", "reject", "drop"] as const;
const PROTOCOLS = ["tcp", "udp", "icmp4", "icmp6"] as const;
const DIRECTIONS = ["ingress", "egress"] as const;

function emptyRule(sort = 0): FirewallRule {
  return {
    direction: "ingress",
    action: "allow",
    protocol: "tcp",
    destination_port: "",
    source_cidr: "",
    description: "",
    sort_order: sort,
  };
}

function withUI(rule: FirewallRule): RuleRow {
  return { ...rule, _uiId: crypto.randomUUID() };
}

// ============================================================================
// Create
// ============================================================================

export function CreateUserGroupSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onCreated?: (group: FirewallGroup) => void;
}) {
  const { t } = useTranslation();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState<RuleRow[]>(() => [withUI(emptyRule(10))]);
  const mutation = usePortalCreateFirewallGroupMutation();

  const reset = () => {
    setSlug("");
    setName("");
    setDescription("");
    setRules([withUI(emptyRule(10))]);
  };

  const submit = () => {
    if (!slug.trim() || !name.trim()) return;
    mutation.mutate(
      {
        slug: slug.trim(),
        name: name.trim(),
        description: description.trim(),
        rules: rules.map(({ _uiId: _, ...r }) => r),
      },
      {
        onSuccess: (res) => {
          if (res.warning) {
            toast.warning(`${res.warning}: ${res.sync_err ?? ""}`);
          } else {
            toast.success(
              t("vm.firewall.userCreatedOk", { defaultValue: "已创建组 {{name}}", name: res.group.name }),
            );
          }
          onCreated?.(res.group);
          reset();
          onOpenChange(false);
        },
        onError: (e) => toast.error(formatError(e)),
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" size="min(96vw, 36rem)">
        <SheetHeader>
          <SheetTitle>{t("vm.firewall.userCreateTitle", { defaultValue: "新建防火墙组" })}</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="user-fw-name">{t("admin.firewall.name", { defaultValue: "名称" })}</Label>
            <Input
              id="user-fw-name"
              value={name}
              placeholder="My Web Stack"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-fw-slug">Slug</Label>
            <Input
              id="user-fw-slug"
              value={slug}
              placeholder="my-web"
              className="font-mono"
              onChange={(e) => setSlug(e.target.value)}
            />
            <p className="text-caption text-text-tertiary">
              {t("vm.firewall.userSlugHint", {
                defaultValue: "唯一短标识；与你的其他组不冲突即可。",
              })}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-fw-desc">{t("admin.firewall.description", { defaultValue: "说明" })}</Label>
            <Input
              id="user-fw-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <RulesEditor rules={rules} onChange={setRules} />
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>
            {t("common.cancel", { defaultValue: "取消" })}
          </Button>
          <Button
            variant="primary"
            disabled={mutation.isPending || !slug.trim() || !name.trim()}
            onClick={submit}
          >
            {mutation.isPending
              ? t("common.saving", { defaultValue: "保存中..." })
              : t("vm.firewall.userCreate", { defaultValue: "创建组" })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================================
// Edit
// ============================================================================

export function EditUserGroupSheet({
  group,
  open,
  onOpenChange,
}: {
  group: FirewallGroup | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();

  // PR #17 fixup（PLAN-034 同款）：关闭 transition 期间保留最后一个 group 引用，
  // 避免 base-ui Sheet 还在跑 close 动画时 group=null 导致 portal 立刻 unmount，
  // focus trap / body[inert] 残留致页面后续不可点。
  const lastGroupRef = useRef<FirewallGroup | null>(group);
  if (group) lastGroupRef.current = group;
  const display = group ?? lastGroupRef.current;

  const [name, setName] = useState(display?.name ?? "");
  const [description, setDescription] = useState(display?.description ?? "");
  const [rules, setRules] = useState<RuleRow[]>(() =>
    (display?.rules ?? [emptyRule(10)]).map(withUI),
  );
  const updateGroup = usePortalUpdateFirewallGroupMutation(display?.id ?? 0);
  const replaceRules = usePortalReplaceFirewallRulesMutation(display?.id ?? 0);

  // PR #17 fixup（替代原 in-render setState 反模式）：每次 open 切到 true 或者
  // group.id 变化时，从最新 group 重新加载本地 state。这样"先编辑组 A 再编辑
  // 组 B" 不会让 B 显示 A 的字段。
  // 同步 set-state-in-effect 是有意为之——这里没用 useReducer 因为字段独立编辑
  // 频繁，effect 只在 open/id 边界跑一次。
  /* eslint-disable react/set-state-in-effect, react/exhaustive-deps -- intentional sync-on-open */
  useEffect(() => {
    if (!open || !group) return;
    setName(group.name);
    setDescription(group.description);
    setRules((group.rules ?? [emptyRule(10)]).map(withUI));
  }, [open, group?.id]);
  /* eslint-enable react/set-state-in-effect, react/exhaustive-deps */

  if (!display) return null;

  const save = async () => {
    try {
      if (name !== display.name || description !== display.description) {
        await updateGroup.mutateAsync({ name, description });
      }
      const res = await replaceRules.mutateAsync(
        rules.map(({ _uiId: _, ...r }) => r),
      );
      if (res.warning) {
        toast.warning(`${res.warning}: ${res.sync_err ?? ""}`);
      } else {
        toast.success(t("vm.firewall.userSavedOk", { defaultValue: "已保存" }));
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(formatError(e));
    }
  };

  const pending = updateGroup.isPending || replaceRules.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" size="min(96vw, 36rem)">
        <SheetHeader>
          <SheetTitle>
            {t("vm.firewall.userEditTitle", { defaultValue: "编辑组" })}
            {" · "}
            <span className="font-mono text-text-tertiary">{display.slug}</span>
          </SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="user-fw-edit-name">{t("admin.firewall.name", { defaultValue: "名称" })}</Label>
            <Input
              id="user-fw-edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-fw-edit-desc">{t("admin.firewall.description", { defaultValue: "说明" })}</Label>
            <Input
              id="user-fw-edit-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <RulesEditor rules={rules} onChange={setRules} />
          <div className="rounded-md border border-status-warning/30 bg-status-warning/8 p-3 text-caption text-status-warning">
            {t("vm.firewall.coldModifyHint", {
              defaultValue: "提示：保存规则时如果 VM 正在运行，后端会自动 stop→PATCH→start 应用 ACL（约 10-15s 不可达）。",
            })}
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel", { defaultValue: "取消" })}
          </Button>
          <Button variant="primary" disabled={pending} onClick={save}>
            {pending
              ? t("common.saving", { defaultValue: "保存中..." })
              : t("common.save", { defaultValue: "保存" })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================================
// RulesEditor —— Create + Edit 共用
// ============================================================================

function RulesEditor({
  rules,
  onChange,
}: {
  rules: RuleRow[];
  onChange: (next: RuleRow[]) => void;
}) {
  const { t } = useTranslation();

  const patch = (uiId: string, p: Partial<FirewallRule>) =>
    onChange(rules.map((r) => (r._uiId === uiId ? { ...r, ...p } : r)));
  const add = () =>
    onChange([...rules, withUI(emptyRule(rules.length * 10 + 10))]);
  const remove = (uiId: string) =>
    onChange(rules.filter((r) => r._uiId !== uiId));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{t("vm.firewall.userRules", { defaultValue: "规则" })}</Label>
        <Button size="sm" variant="ghost" onClick={add}>
          <Plus size={12} aria-hidden="true" />
          {t("admin.firewall.addRule", { defaultValue: "添加规则" })}
        </Button>
      </div>
      {rules.length === 0 ? (
        <p className="text-caption text-text-tertiary">
          {t("admin.firewall.noRules", { defaultValue: "无规则" })}
        </p>
      ) : (
        <div className="space-y-1.5">
          {rules.map((r) => (
            <div
              key={r._uiId}
              className={cn(
                "grid grid-cols-12 gap-1.5 items-center text-caption",
                "rounded-md border border-border bg-surface-1 p-2",
              )}
            >
              <select
                value={r.direction ?? "ingress"}
                onChange={(e) => patch(r._uiId, { direction: e.target.value as FirewallRule["direction"] })}
                className="col-span-2 h-7 px-2 rounded-md border border-border bg-surface-2 text-foreground"
              >
                {DIRECTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <select
                value={r.action}
                onChange={(e) => patch(r._uiId, { action: e.target.value as FirewallRule["action"] })}
                className="col-span-2 h-7 px-2 rounded-md border border-border bg-surface-2 text-foreground"
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <select
                value={r.protocol}
                onChange={(e) => patch(r._uiId, { protocol: e.target.value as FirewallRule["protocol"] })}
                className="col-span-1 h-7 px-2 rounded-md border border-border bg-surface-2 text-foreground"
              >
                {PROTOCOLS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <Input
                placeholder="22,80"
                value={r.destination_port}
                onChange={(e) => patch(r._uiId, { destination_port: e.target.value })}
                className="col-span-2 h-7 font-mono"
              />
              <Input
                placeholder="0.0.0.0/0"
                value={r.source_cidr}
                onChange={(e) => patch(r._uiId, { source_cidr: e.target.value })}
                className="col-span-2 h-7 font-mono"
              />
              <Input
                placeholder={t("admin.firewall.descPlaceholder", { defaultValue: "说明" })}
                value={r.description}
                onChange={(e) => patch(r._uiId, { description: e.target.value })}
                className="col-span-2 h-7"
              />
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => remove(r._uiId)}
                disabled={rules.length === 1}
                aria-label={t("common.delete", { defaultValue: "删除" })}
                className="col-span-1 text-status-error"
              >
                <Trash2 size={12} aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
