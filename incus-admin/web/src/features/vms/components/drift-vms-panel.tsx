import type {GoneVM} from "@/features/vms/api";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useForceDeleteGoneVMMutation, useGoneVMsQuery } from "@/features/vms/api";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/shared/components/ui/table";
import { formatDateTime } from "@/shared/lib/utils";

/** Drift（PLAN-020 reconciler 标 status=gone）的 VM 列表 + 强制清理。 */
export function DriftVMsPanel() {
  const { t } = useTranslation();
  const { data, isLoading } = useGoneVMsQuery();
  const forceDelete = useForceDeleteGoneVMMutation();
  const confirm = useConfirm();

  if (isLoading) return null;
  const goneVMs = data?.vms ?? [];
  if (goneVMs.length === 0) return null;

  const cleanup = async (vm: GoneVM) => {
    const ok = await confirm({
      title: t("vm.forceDeleteTitle", { defaultValue: "清理 Drift VM？" }),
      message: t("vm.forceDeleteMessage", {
        defaultValue: "将物理删除 DB 行并释放 IP {{ip}}。此操作不可撤销（原 VM 在 Incus 端已消失）。",
        ip: vm.ip ?? t("common.none", { defaultValue: "(无)" }),
      }),
      destructive: true,
      typeToConfirm: vm.name,
      typeToConfirmLabel: t("confirmDialog.typeVmName", {
        defaultValue: "请输入 VM 名称 {{name}} 以确认",
        name: vm.name,
      }),
    });
    if (!ok) return;
    forceDelete.mutate(vm.id, {
      onSuccess: () =>
        toast.success(`${t("vm.forceDeleted", { defaultValue: "已清理" })} ${vm.name}`),
      onError: (err) => toast.error((err as Error).message),
    });
  };

  return (
    <Alert variant="warning">
      <AlertTitle>
        {t("vm.driftTitle", {
          defaultValue: "Drift VMs（{{count}}）",
          count: goneVMs.length,
        })}
      </AlertTitle>
      <AlertDescription className="mt-1 mb-3">
        {t("vm.driftHint", {
          defaultValue: "Incus 端实例已消失，DB 残留；审计后可清理。",
        })}
      </AlertDescription>
      <div className="overflow-x-auto rounded-md border border-status-warning/30 bg-surface-1">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>ID</TableHead>
              <TableHead>{t("vm.name")}</TableHead>
              <TableHead>{t("vm.ip")}</TableHead>
              <TableHead>{t("vm.node")}</TableHead>
              <TableHead>
                {t("vm.markedGoneAt", { defaultValue: "标记时间" })}
              </TableHead>
              <TableHead className="text-right">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {goneVMs.map((vm) => (
              <TableRow key={vm.id}>
                <TableCell className="text-caption text-text-tertiary">{vm.id}</TableCell>
                <TableCell className="font-mono">{vm.name}</TableCell>
                <TableCell className="font-mono text-caption">{vm.ip ?? "—"}</TableCell>
                <TableCell className="text-text-tertiary">{vm.node || "—"}</TableCell>
                <TableCell className="text-caption text-text-tertiary">
                  {formatDateTime(vm.updated_at)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={forceDelete.isPending}
                    onClick={() => cleanup(vm)}
                  >
                    {forceDelete.isPending
                      ? t("common.loading")
                      : t("vm.cleanup", { defaultValue: "清理" })}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Alert>
  );
}
