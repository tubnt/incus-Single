import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { VMMetricsPanel } from "@/features/monitoring/vm-metrics-panel";
import { NodePicker } from "@/features/nodes/node-picker";
import { SnapshotPanel } from "@/features/snapshots/snapshot-panel";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import {
  useAdminResetPasswordByNameMutation,
  useAdminVMDetailQuery,
  useDeleteVMMutation,
  useMigrateVMMutation,
  useReinstallVMMutation,
  useRescueEnterByNameMutation,
  useRescueExitByNameMutation,
  useVMStateMutation,
  type ResetPasswordMode,
} from "@/features/vms/api";
import { DEFAULT_TEMPLATE_SLUG, TemplatePicker } from "@/features/templates/template-picker";

export const Route = createFileRoute("/admin/vm-detail")({
  validateSearch: (search: Record<string, unknown>) => ({
    name: (search.name as string) || "",
    cluster: (search.cluster as string) || "",
    project: (search.project as string) || "customers",
  }),
  component: VMDetailPage,
});

function VMDetailPage() {
  const { t } = useTranslation();
  const { name, cluster, project } = Route.useSearch();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [tab, setTab] = useState<"overview" | "console" | "snapshots">("overview");
  const [migrateTarget, setMigrateTarget] = useState("");
  const [showMigrate, setShowMigrate] = useState(false);
  const [showReinstall, setShowReinstall] = useState(false);
  const [showResetPwd, setShowResetPwd] = useState(false);
  const [reinstallSlug, setReinstallSlug] = useState(DEFAULT_TEMPLATE_SLUG);
  const [resetPwdMode, setResetPwdMode] = useState<ResetPasswordMode>("auto");

  const { data: detailData, isLoading: detailLoading, isError: detailError } = useAdminVMDetailQuery(
    cluster,
    name,
    project || undefined,
    15_000,
  );
  const resolvedProject = detailData?.project || project;
  const currentNode = detailData?.vm?.location ?? "";

  const stateMutation = useVMStateMutation();
  const migrateMutation = useMigrateVMMutation();
  const deleteMutation = useDeleteVMMutation();
  const reinstallMutation = useReinstallVMMutation();
  const resetPwdMutation = useAdminResetPasswordByNameMutation(name);
  const rescueEnterMutation = useRescueEnterByNameMutation();
  const rescueExitMutation = useRescueExitByNameMutation(name);

  const runAction = (action: string) =>
    stateMutation.mutate(
      { name, action, cluster, project },
      {
        onSuccess: () => toast.success(`${name}: ${action} ${t("vm.actionSubmitted")}`),
        onError: () => toast.error(`${name}: ${action} ${t("vm.actionFailed")}`),
      },
    );

  const runMigrate = (target: string) =>
    migrateMutation.mutate(
      { name, cluster, project, target_node: target },
      {
        onSuccess: () => {
          toast.success(`${name} ${t("admin.migrated", { defaultValue: "migrated" })}`);
          setShowMigrate(false);
          setMigrateTarget("");
        },
        onError: () => toast.error(`${name} ${t("admin.migrateFailed", { defaultValue: "migration failed" })}`),
      },
    );

  const runDelete = () =>
    deleteMutation.mutate(
      { name, cluster, project },
      { onSuccess: () => navigate({ to: "/admin/vms" }) },
    );

  if (!name || !cluster) {
    return <div className="text-muted-foreground p-8">Missing vm name or cluster.</div>;
  }

  if (detailLoading) {
    return <div className="text-muted-foreground p-8">{t("common.loading")}</div>;
  }

  if (detailError || !detailData?.vm) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="text-2xl font-semibold">{t("vm.notFoundTitle")}</div>
        <div className="text-sm text-muted-foreground">{t("vm.notFoundHint")}</div>
        <button
          onClick={() => navigate({ to: "/admin/vms" })}
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
          <h1 className="text-2xl font-bold font-mono">{name}</h1>
          <p className="text-sm text-muted-foreground">
            {cluster} / {resolvedProject}
            {currentNode ? ` · ${currentNode}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/console?vm=${name}&cluster=${cluster}&project=${project}&from=admin`}
            className="px-3 py-1.5 rounded text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30">
            {t("vm.console")}
          </a>
          <ActionBtn label={t("vm.start")} onClick={() => runAction("start")} disabled={stateMutation.isPending} />
          <ActionBtn label={t("vm.stop")} onClick={() => runAction("stop")} disabled={stateMutation.isPending} />
          <ActionBtn label={t("vm.restart")} onClick={() => runAction("restart")} disabled={stateMutation.isPending} />
          <button
            onClick={() => setShowMigrate(!showMigrate)}
            className="px-3 py-1.5 rounded text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20"
          >
            {t("admin.migrate", { defaultValue: "Migrate" })}
          </button>
          <ActionBtn
            label={t("vm.reinstall")}
            onClick={() => setShowReinstall(!showReinstall)}
            disabled={reinstallMutation.isPending}
          />
          <ActionBtn
            label={t("vm.passwordReset", { defaultValue: "重置密码" })}
            onClick={() => setShowResetPwd(!showResetPwd)}
            disabled={resetPwdMutation.isPending}
          />
          <ActionBtn
            label={t("vm.rescueEnter", "Rescue")}
            onClick={async () => {
              const ok = await confirm({
                title: t("vm.rescueEnterTitle", "进入 Rescue 模式"),
                message: t("vm.rescueEnterMessage", {
                  name,
                  defaultValue: `确认让 ${name} 进入 Rescue 模式？会先拍快照再停机。`,
                }),
                destructive: true,
              });
              if (!ok) return;
              rescueEnterMutation.mutate(name, {
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
            }}
            disabled={rescueEnterMutation.isPending}
          />
          <ActionBtn
            label={t("vm.rescueExitRestore", "Rescue 恢复")}
            onClick={async () => {
              const ok = await confirm({
                title: t("vm.rescueExitTitle", "退出 Rescue 模式"),
                message: t("vm.rescueExitRestoreMessage", {
                  name,
                  defaultValue: `确认退出 Rescue 并恢复快照？${name} 会回滚到进入前的状态。`,
                }),
                destructive: true,
              });
              if (!ok) return;
              rescueExitMutation.mutate(
                { restore: true, delete_snapshot: false },
                {
                  onSuccess: () => toast.success(t("vm.rescueExitedRestored", "已恢复快照并启动")),
                  onError: (err) => toast.error((err as Error).message),
                },
              );
            }}
            disabled={rescueExitMutation.isPending}
          />
          <button
            onClick={async () => {
              const ok = await confirm({
                title: t("deleteConfirm.vmTitle"),
                message: t("deleteConfirm.vmMessage", { name }),
                destructive: true,
              });
              if (ok) runDelete();
            }}
            disabled={deleteMutation.isPending}
            // aria-label includes the VM name so DOM queries / assistive
            // tools can disambiguate this from row-level Delete buttons
            // (e.g. snapshot rows in the same page). Born of the 2026-04-25
            // incident where a UI test selector "Delete" hit this button
            // instead of the snapshot row's.
            aria-label={t("vm.deleteVmAriaLabel", { name, defaultValue: `Delete VM ${name}` })}
            data-testid="delete-vm-button"
            className="px-3 py-1.5 rounded text-xs font-medium border border-destructive bg-destructive/20 text-destructive hover:bg-destructive/30 disabled:opacity-50"
          >
            ⚠ {t("vm.delete")}
          </button>
        </div>
      </div>

      {showReinstall && (
        <div className="border border-border rounded-lg bg-card p-4 mb-4">
          <h3 className="font-semibold text-sm mb-1">
            {t("vm.reinstallHeading", { name, defaultValue: `Reinstall system — ${name}` })}
          </h3>
          <p className="text-xs text-destructive mb-3">{t("vm.reinstallWarning")}</p>
          <div className="flex items-center gap-3">
            <TemplatePicker
              value={reinstallSlug}
              onChange={setReinstallSlug}
              className="px-2 py-1 text-xs border border-border rounded bg-card"
            />
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: t("deleteConfirm.reinstallTitle"),
                  message: t("deleteConfirm.reinstallMessage", { name }),
                  destructive: true,
                });
                if (!ok) return;
                reinstallMutation.mutate(
                  { name, cluster, project, template_slug: reinstallSlug },
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
              }}
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
            {t("vm.resetPwdHeading", { name, defaultValue: `重置 ${name} 密码` })}
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            {t("vm.resetPwdModeHint", {
              defaultValue: "auto：先 online 失败后回落 offline（重启走 cloud-init）；online：guest-agent 执行 chpasswd；offline：直接走 cloud-init 重启。",
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
              onClick={() => {
                resetPwdMutation.mutate(
                  { cluster, project, username: "ubuntu", mode: resetPwdMode },
                  {
                    onSuccess: (data) => {
                      const ch = data.channel ?? "online";
                      const note = data.fallback ? `${ch} (fallback)` : ch;
                      toast.success(
                        t("vm.passwordResetResult", {
                          user: data.username,
                          password: data.password,
                          channel: note,
                          defaultValue: `${data.username} / ${data.password} · via ${note}`,
                        }),
                        { duration: 20_000 },
                      );
                      setShowResetPwd(false);
                    },
                    onError: (err) => toast.error((err as Error).message),
                  },
                );
              }}
              disabled={resetPwdMutation.isPending}
              className="px-3 py-1 text-xs bg-warning text-warning-foreground rounded disabled:opacity-50"
            >
              {resetPwdMutation.isPending ? t("vm.passwordResetting") : t("vm.passwordReset")}
            </button>
          </div>
        </div>
      )}

      {showMigrate && (
        <div className="border border-border rounded-lg bg-card p-4 mb-4">
          <h3 className="font-semibold text-sm mb-2">{t("admin.migrateTitle", { defaultValue: "Migrate to target node" })}</h3>
          <div className="flex gap-2">
            <NodePicker
              clusterName={cluster}
              value={migrateTarget}
              onChange={setMigrateTarget}
              excludeNodes={currentNode ? [currentNode] : []}
              placeholder={t("admin.targetNode", { defaultValue: "Target node name" })}
              className="flex-1 font-mono"
            />
            <button
              onClick={async () => {
                if (!migrateTarget) return;
                const ok = await confirm({
                  title: t("deleteConfirm.migrateTitle"),
                  message: t("deleteConfirm.migrateMessage", { name, target: migrateTarget }),
                });
                if (ok) runMigrate(migrateTarget);
              }}
              disabled={migrateMutation.isPending || !migrateTarget}
              className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50"
            >
              {migrateMutation.isPending ? "..." : t("admin.migrateRun", { defaultValue: "Migrate" })}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-1 mb-6 border-b border-border">
        {(["overview", "console", "snapshots"] as const).map((tKey) => (
          <button key={tKey} onClick={() => setTab(tKey)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === tKey ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {tKey === "overview"
              ? t("vm.tabOverview", { defaultValue: "Overview" })
              : tKey === "console"
              ? t("vm.console")
              : t("vm.snapshots")}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <VMMetricsPanel vmName={name} apiBase="/admin" cluster={cluster} />
        </div>
      )}

      {tab === "console" && (
        <div className="border border-border rounded-lg overflow-hidden">
          <iframe
            src={`/console?vm=${name}&cluster=${cluster}&project=${project}`}
            className="w-full h-[500px] bg-black"
            title="VM Console"
          />
        </div>
      )}

      {tab === "snapshots" && (
        <SnapshotPanel vmName={name} cluster={cluster} project={project} />
      )}
    </div>
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
