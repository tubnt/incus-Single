import type {IncusInstance} from "@/features/vms/api";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { VMMetricsPanel } from "@/features/monitoring/vm-metrics-panel";
import { SnapshotPanel } from "@/features/snapshots/snapshot-panel";
import {
  DEFAULT_TEMPLATE_SLUG,
  TemplatePicker,
} from "@/features/templates/template-picker";
import { useReinstallVMMutation } from "@/features/vms/api";
import { Button } from "@/shared/components/ui/button";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { SecretReveal } from "@/shared/components/ui/secret-reveal";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";

export type VMSheetKind = "snapshots" | "metrics" | "reinstall";

interface VMActionSheetsProps {
  vm: IncusInstance;
  cluster: string;
  open: VMSheetKind | null;
  onClose: () => void;
}

/**
 * 把原 admin/vms.tsx 行内 `<tr colspan=6>` 嵌入面板搬到右侧 Sheet 抽屉。
 * 同时只允许一个 Sheet 打开（C4）。
 */
export function VMActionSheets({ vm, cluster, open, onClose }: VMActionSheetsProps) {
  const { t } = useTranslation();
  const project = vm.project || "customers";
  const isOpen = open !== null;

  const handleOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  const titleMap: Record<VMSheetKind, string> = {
    snapshots: t("vm.snapshots", { defaultValue: "快照" }),
    metrics: t("vm.metrics", { defaultValue: "指标" }),
    reinstall: t("vm.reinstall", { defaultValue: "重装系统" }),
  };

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetContent side="right" size="min(96vw, 38rem)">
        {open ? (
          <>
            <SheetHeader>
              <SheetTitle>
                {titleMap[open]} · <span className="font-mono text-text-tertiary">{vm.name}</span>
              </SheetTitle>
              <SheetDescription>
                {open === "snapshots"
                  ? t("vm.snapshotsHelp", {
                      defaultValue: "VM 级别的快照管理。删除快照不可恢复。",
                    })
                  : open === "metrics"
                    ? t("vm.metricsHelp", {
                        defaultValue: "实时指标流，每 5s 刷新一次。",
                      })
                    : t("vm.reinstallHelp", {
                        defaultValue: "重装会清除 VM 内所有数据，并生成新的密码。",
                      })}
              </SheetDescription>
            </SheetHeader>
            <SheetBody>
              {open === "snapshots" ? (
                <SnapshotPanel vmName={vm.name} cluster={cluster} project={project} apiBase="/admin" />
              ) : null}
              {open === "metrics" && vm.status === "Running" ? (
                <VMMetricsPanel vmName={vm.name} apiBase="/admin" cluster={cluster} />
              ) : null}
              {open === "metrics" && vm.status !== "Running" ? (
                <div className="text-sm text-muted-foreground">
                  {t("vm.metricsRunningOnly", {
                    defaultValue: "仅运行中的 VM 才有实时指标。",
                  })}
                </div>
              ) : null}
              {open === "reinstall" ? (
                <ReinstallForm vm={vm} cluster={cluster} onDone={onClose} />
              ) : null}
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ReinstallForm({
  vm,
  cluster,
  onDone,
}: {
  vm: IncusInstance;
  cluster: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const project = vm.project || "customers";
  const [slug, setSlug] = useState<string>(DEFAULT_TEMPLATE_SLUG);
  const mutation = useReinstallVMMutation();
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(null);

  const run = async () => {
    const ok = await confirm({
      title: t("deleteConfirm.reinstallTitle"),
      message: t("deleteConfirm.reinstallMessage", { name: vm.name }),
      destructive: true,
      typeToConfirm: vm.name,
      typeToConfirmLabel: t("confirmDialog.typeVmName", {
        defaultValue: "请输入 VM 名称 {{name}} 以确认",
        name: vm.name,
      }),
    });
    if (!ok) return;
    mutation.mutate(
      { name: vm.name, cluster, project, template_slug: slug },
      {
        onSuccess: (data) => {
          setCredentials({ username: data.username, password: data.password });
          toast.success(t("vm.reinstallDone", { defaultValue: "重装完成" }));
        },
        onError: (err) => toast.error((err as Error).message),
      },
    );
  };

  if (credentials) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-status-success/30 bg-status-success/8 p-3 text-sm text-foreground">
          {t("vm.reinstallSuccessHint", {
            defaultValue: "重装成功。请保存以下凭据 —— 密码仅显示一次。",
          })}
        </div>
        <div className="space-y-2">
          <SecretReveal label={t("vm.username", { defaultValue: "Username" })} value={credentials.username} inline={false} />
          <SecretReveal label={t("vm.password", { defaultValue: "Password" })} value={credentials.password} inline={false} />
        </div>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onDone}>
            {t("common.ok", { defaultValue: "好的" })}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-status-error/30 bg-status-error/8 p-3 text-sm text-status-error">
        {t("vm.reinstallWarning", {
          defaultValue: "⚠ 重装将清除 VM 内全部数据，包括磁盘、网络配置和已安装软件，无法回滚。",
        })}
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-emphasis text-foreground">
          {t("vm.targetTemplate", { defaultValue: "目标系统镜像" })}
        </label>
        <TemplatePicker
          value={slug}
          onChange={setSlug}
          className="h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-foreground focus:outline-none focus:border-[color:var(--accent)]"
        />
      </div>
      <SheetFooter className="-mx-6 -mb-5 mt-4">
        <Button variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="destructive"
          disabled={mutation.isPending}
          onClick={run}
        >
          {mutation.isPending
            ? t("vm.reinstalling", { defaultValue: "重装中..." })
            : t("vm.reinstallConfirm", { defaultValue: "确认重装" })}
        </Button>
      </SheetFooter>
    </div>
  );
}
