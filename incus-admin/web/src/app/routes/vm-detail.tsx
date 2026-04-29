import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { VMMetricsPanel } from "@/features/monitoring/vm-metrics-panel";
import { SnapshotPanel } from "@/features/snapshots/snapshot-panel";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import {
  usePortalReinstallVMMutation,
  usePortalRescueEnterMutation,
  usePortalRescueExitMutation,
  useMyVMDetailQuery,
  useResetVMPasswordMutation,
  useVMActionMutation,
  type ResetPasswordMode,
} from "@/features/vms/api";
import { DEFAULT_TEMPLATE_SLUG, TemplatePicker } from "@/features/templates/template-picker";
import { defaultUserForImage } from "@/features/vms/default-user";
import {
  usePortalFirewallGroupsQuery,
  usePortalVMFirewallBindingsQuery,
  usePortalBindVMFirewallMutation,
  usePortalUnbindVMFirewallMutation,
  type FirewallGroup,
} from "@/features/firewall/api";

export const Route = createFileRoute("/vm-detail")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: Number(search.id) || 0,
  }),
  component: UserVMDetailPage,
});

function UserVMDetailPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { id } = Route.useSearch();
  const [tab, setTab] = useState<"overview" | "snapshots" | "firewall">("overview");
  const [showReinstall, setShowReinstall] = useState(false);
  const [reinstallSlug, setReinstallSlug] = useState(DEFAULT_TEMPLATE_SLUG);
  const [showResetPwd, setShowResetPwd] = useState(false);
  const [resetPwdMode, setResetPwdMode] = useState<ResetPasswordMode>("auto");

  const { data, isLoading } = useMyVMDetailQuery(id);
  const vm = data?.vm;

  const actionMutation = useVMActionMutation(id);

  const resetPwdMutation = useResetVMPasswordMutation(id);
  const reinstallMutation = usePortalReinstallVMMutation(id);
  const rescueEnterMutation = usePortalRescueEnterMutation(id);
  const rescueExitMutation = usePortalRescueExitMutation(id);
  const runResetPwd = () =>
    resetPwdMutation.mutate(resetPwdMode, {
      onSuccess: (data) => {
        const ch = data.channel ?? "online";
        const note = data.fallback ? `${ch} (fallback)` : ch;
        toast.success(
          t("vm.passwordResetToastWithChannel", {
            password: data.password,
            channel: note,
            defaultValue: `新密码: ${data.password} · 通道: ${note}`,
          }),
          {
            duration: 15000,
            action: {
              label: t("vm.passwordCopy", { defaultValue: "复制" }),
              onClick: () => {
                navigator.clipboard
                  .writeText(data.password)
                  .then(() => toast.success(t("vm.passwordCopied", { defaultValue: "已复制到剪贴板" })))
                  .catch(() => toast.error(t("vm.passwordCopyFailed", { defaultValue: "复制失败，请手动复制" })));
              },
            },
          },
        );
        setShowResetPwd(false);
      },
      onError: () => toast.error(t("vm.passwordResetFailed")),
    });

  const runReinstall = async () => {
    const ok = await confirm({
      title: t("deleteConfirm.reinstallTitle"),
      message: t("deleteConfirm.reinstallMessage", { name: vm?.name ?? "" }),
      destructive: true,
    });
    if (!ok) return;
    reinstallMutation.mutate(
      { template_slug: reinstallSlug },
      {
        onSuccess: (data) => {
          toast.success(
            t("vm.reinstallDone", {
              username: data.username,
              password: data.password,
              defaultValue: `重装完成 · ${data.username} / ${data.password}`,
            }),
            { duration: 20_000 },
          );
          setShowReinstall(false);
        },
        onError: (err) => toast.error((err as Error).message),
      },
    );
  };

  const runRescueEnter = async () => {
    const ok = await confirm({
      title: t("vm.rescueEnterTitle", "进入 Rescue 模式"),
      message: t("vm.rescueEnterMessage", {
        name: vm?.name ?? "",
        defaultValue: `确认让 ${vm?.name} 进入 Rescue 模式？会先拍快照再停机。`,
      }),
      destructive: true,
    });
    if (!ok) return;
    rescueEnterMutation.mutate(undefined, {
      onSuccess: (res) =>
        toast.success(
          t("vm.rescueEntered", {
            snap: res.snapshot,
            defaultValue: `已进入 Rescue；快照 ${res.snapshot}`,
          }),
          { duration: 15_000 },
        ),
      onError: (err) => toast.error((err as Error).message),
    });
  };

  const runRescueExit = async (restore: boolean) => {
    const ok = await confirm({
      title: t("vm.rescueExitTitle", "退出 Rescue 模式"),
      message: restore
        ? t("vm.rescueExitRestoreMessage", {
            name: vm?.name ?? "",
            defaultValue: `确认退出 Rescue 并恢复快照？${vm?.name} 会回滚到进入前的状态。`,
          })
        : t("vm.rescueExitMessage", {
            name: vm?.name ?? "",
            defaultValue: `确认退出 Rescue？${vm?.name} 会直接启动（不恢复快照）。`,
          }),
      destructive: restore,
    });
    if (!ok) return;
    rescueExitMutation.mutate(
      { restore, delete_snapshot: false },
      {
        onSuccess: () =>
          toast.success(
            restore
              ? t("vm.rescueExitedRestored", "已恢复快照并启动")
              : t("vm.rescueExited", "已退出 Rescue"),
          ),
        onError: (err) => toast.error((err as Error).message),
      },
    );
  };

  if (id > 0 && isLoading) {
    return <div className="text-muted-foreground p-8">{t("common.loading")}</div>;
  }

  if (!vm) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="text-2xl font-semibold">{t("vm.notFoundTitle")}</div>
        <div className="text-sm text-muted-foreground">{t("vm.notFoundHint")}</div>
        <button
          onClick={() => navigate({ to: "/vms" })}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
        >
          {t("vm.backToList")}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-mono">{vm.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <StatusBadge status={vm.status} />
            <span className="text-sm text-muted-foreground">
              {vm.cpu}C / {(vm.memory_mb / 1024).toFixed(0)}G RAM / {vm.disk_gb}G Disk
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {vm.status === "running" && (
            <>
              <a href={`/console?vm=${encodeURIComponent(vm.name)}&cluster=${encodeURIComponent(vm.cluster)}&project=${encodeURIComponent(vm.project)}&from=portal`}
                className="px-3 py-1.5 rounded text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30">
                Console
              </a>
              <ActionBtn label="Stop" onClick={() => actionMutation.mutate("stop")} disabled={actionMutation.isPending} />
              <ActionBtn label="Restart" onClick={() => actionMutation.mutate("restart")} disabled={actionMutation.isPending} />
              <ActionBtn
                label={t("vm.passwordReset", "重置密码")}
                onClick={() => setShowResetPwd(!showResetPwd)}
                disabled={resetPwdMutation.isPending}
              />
            </>
          )}
          {vm.status === "stopped" && (
            <ActionBtn label="Start" onClick={() => actionMutation.mutate("start")} disabled={actionMutation.isPending} />
          )}
          <ActionBtn
            label={t("vm.reinstall")}
            onClick={() => setShowReinstall(!showReinstall)}
            disabled={reinstallMutation.isPending}
          />
          <ActionBtn
            label={t("vm.rescueEnter", "Rescue")}
            onClick={runRescueEnter}
            disabled={rescueEnterMutation.isPending}
          />
          <ActionBtn
            label={t("vm.rescueExit", "Rescue 退出")}
            onClick={() => runRescueExit(false)}
            disabled={rescueExitMutation.isPending}
          />
        </div>
      </div>

      {showReinstall && (
        <div className="border border-border rounded-lg bg-card p-4 mb-4">
          <h3 className="font-semibold text-sm mb-1">
            {t("vm.reinstallHeading", { name: vm.name, defaultValue: `重装 ${vm.name}` })}
          </h3>
          <p className="text-xs text-destructive mb-3">{t("vm.reinstallWarning")}</p>
          <div className="flex items-center gap-3">
            <TemplatePicker
              value={reinstallSlug}
              onChange={setReinstallSlug}
              className="px-2 py-1 text-xs border border-border rounded bg-card"
            />
            <button
              onClick={runReinstall}
              disabled={reinstallMutation.isPending}
              className="px-3 py-1 text-xs bg-destructive text-destructive-foreground rounded disabled:opacity-50"
            >
              {reinstallMutation.isPending ? t("vm.reinstalling") : t("vm.reinstallConfirm")}
            </button>
          </div>
        </div>
      )}

      {showResetPwd && (
        <div className="border border-border rounded-lg bg-card p-4 mb-4">
          <h3 className="font-semibold text-sm mb-1">
            {t("vm.resetPwdHeading", { name: vm.name, defaultValue: `重置 ${vm.name} 密码` })}
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            {t("vm.resetPwdModeHint", {
              defaultValue: "auto：先 online 失败后回落 offline；online：guest-agent chpasswd；offline：cloud-init 重启",
            })}
          </p>
          <div className="flex items-center gap-3">
            <select
              value={resetPwdMode}
              onChange={(e) => setResetPwdMode(e.target.value as ResetPasswordMode)}
              className="px-2 py-1 text-xs border border-border rounded bg-card"
            >
              <option value="auto">auto</option>
              <option value="online">online</option>
              <option value="offline">offline</option>
            </select>
            <button
              onClick={runResetPwd}
              disabled={resetPwdMutation.isPending}
              className="px-3 py-1 text-xs bg-warning text-warning-foreground rounded disabled:opacity-50"
            >
              {resetPwdMutation.isPending ? t("vm.passwordResetting") : t("vm.passwordReset")}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <InfoCard label="IP" value={vm.ip || "—"} mono />
        <InfoCard label="Username" value={defaultUserForImage(vm.os_image)} mono />
        <InfoCard label="Node" value={vm.node} />
        <InfoCard label="Created" value={new Date(vm.created_at).toLocaleDateString()} />
      </div>

      <div className="flex gap-1 mb-6 border-b border-border">
        {(["overview", "snapshots", "firewall"] as const).map((tabKey) => (
          <button key={tabKey} onClick={() => setTab(tabKey)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === tabKey ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {tabKey === "overview"
              ? t("vm.monitor", { defaultValue: "Monitoring" })
              : tabKey === "snapshots"
                ? t("vm.snapshots", { defaultValue: "Snapshots" })
                : t("vm.firewall.tab", { defaultValue: "Firewall" })}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <VMMetricsPanel vmName={vm.name} apiBase="/portal" />
      )}

      {tab === "snapshots" && (
        <SnapshotPanel vmName={vm.name} cluster={vm.cluster} project={vm.project} apiBase="/portal" />
      )}

      {tab === "firewall" && <PortalFirewallPanel vmID={vm.id} />}
    </div>
  );
}

function PortalFirewallPanel({ vmID }: { vmID: number }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { data: allGroupsData, isLoading: groupsLoading } = usePortalFirewallGroupsQuery();
  const { data: bindingsData, isLoading: bindingsLoading } = usePortalVMFirewallBindingsQuery(vmID);
  const bindMutation = usePortalBindVMFirewallMutation(vmID);
  const unbindMutation = usePortalUnbindVMFirewallMutation(vmID);

  const allGroups: FirewallGroup[] = allGroupsData?.groups ?? [];
  const boundGroups: FirewallGroup[] = bindingsData?.groups ?? [];
  const boundIDs = new Set(boundGroups.map((g) => g.id));
  const availableGroups = allGroups.filter((g) => !boundIDs.has(g.id));

  if (groupsLoading || bindingsLoading) {
    return <div className="text-sm text-muted-foreground">{t("common.loading", { defaultValue: "Loading..." })}</div>;
  }

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-sm font-medium mb-2">
          {t("vm.firewall.bound", { defaultValue: "已绑定的防火墙组" })}
        </h3>
        {boundGroups.length === 0 ? (
          <div className="text-xs text-muted-foreground border border-dashed border-border rounded p-3">
            {t("vm.firewall.noBound", { defaultValue: "尚未绑定任何防火墙组" })}
          </div>
        ) : (
          <div className="space-y-2">
            {boundGroups.map((g) => (
              <div key={g.id} className="flex items-center justify-between border border-border rounded-lg bg-card p-3">
                <div>
                  <div className="font-medium text-sm">{g.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{g.slug}</div>
                  {g.description && (
                    <div className="text-xs text-muted-foreground mt-0.5">{g.description}</div>
                  )}
                </div>
                <button
                  onClick={async () => {
                    const ok = await confirm({
                      title: t("vm.firewall.unbindConfirmTitle", { defaultValue: "解绑防火墙组" }),
                      message: t("vm.firewall.unbindConfirmMessage", {
                        defaultValue: "解绑后，{{name}} 的规则将不再应用到本 VM。运行中 VM 会自动 stop→PATCH→start。继续？",
                        name: g.name,
                      }),
                      destructive: true,
                    });
                    if (!ok) return;
                    unbindMutation.mutate(g.id, {
                      onSuccess: () => toast.success(t("vm.firewall.unbindOk", { defaultValue: "已解绑" })),
                      onError: (e) => toast.error((e as Error).message),
                    });
                  }}
                  disabled={unbindMutation.isPending}
                  aria-label={`Unbind firewall group ${g.slug}`}
                  data-testid={`unbind-firewall-${g.slug}`}
                  className="px-3 py-1 text-xs rounded border border-warning/40 text-warning hover:bg-warning/10 disabled:opacity-50"
                >
                  {t("vm.firewall.unbind", { defaultValue: "解绑" })}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-medium mb-2">
          {t("vm.firewall.available", { defaultValue: "可绑定的防火墙组" })}
        </h3>
        {availableGroups.length === 0 ? (
          <div className="text-xs text-muted-foreground border border-dashed border-border rounded p-3">
            {boundGroups.length === allGroups.length && allGroups.length > 0
              ? t("vm.firewall.allBound", { defaultValue: "已绑定全部可用组" })
              : t("vm.firewall.noGroupsConfigured", { defaultValue: "当前没有可绑定的防火墙组" })}
          </div>
        ) : (
          <div className="space-y-2">
            {availableGroups.map((g) => (
              <div key={g.id} className="flex items-center justify-between border border-border rounded-lg bg-card p-3">
                <div>
                  <div className="font-medium text-sm">{g.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{g.slug}</div>
                  {g.description && (
                    <div className="text-xs text-muted-foreground mt-0.5">{g.description}</div>
                  )}
                </div>
                <button
                  onClick={() => {
                    bindMutation.mutate(g.id, {
                      onSuccess: () => toast.success(t("vm.firewall.bindOk", { defaultValue: "已绑定" })),
                      onError: (e) => toast.error((e as Error).message),
                    });
                  }}
                  disabled={bindMutation.isPending}
                  aria-label={`Bind firewall group ${g.slug}`}
                  data-testid={`bind-firewall-${g.slug}`}
                  className="px-3 py-1 text-xs rounded border border-primary text-primary hover:bg-primary/10 disabled:opacity-50"
                >
                  {bindMutation.isPending ? "..." : t("vm.firewall.bind", { defaultValue: "绑定" })}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        {t("vm.firewall.coldModifyHint", {
          defaultValue: "提示：bind/unbind 时如果 VM 正在运行，后端会自动 stop→PATCH→start 以应用 ACL（约 10-15s 不可达）。",
        })}
      </p>
    </div>
  );
}

function InfoCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border border-border rounded-lg bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm font-medium mt-0.5 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-success/20 text-success",
    stopped: "bg-muted text-muted-foreground",
    creating: "bg-primary/20 text-primary",
    error: "bg-destructive/20 text-destructive",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function ActionBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="px-3 py-1.5 rounded text-xs font-medium bg-muted/50 text-muted-foreground hover:bg-muted disabled:opacity-50">
      {label}
    </button>
  );
}
