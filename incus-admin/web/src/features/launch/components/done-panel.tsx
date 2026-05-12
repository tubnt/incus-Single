import type { VMCredentials } from "@/features/billing/api";
import { CheckCircle2, Download, Info, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PageContent } from "@/shared/components/page/page-shell";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { SecretReveal } from "@/shared/components/ui/secret-reveal";

/** /launch 完成态：凭据 grid + 后续 CTA。
 *
 * UX-007：密码不再"仅一次"——用户关页面后可在 `/vms/<id>` → 「初始凭据」
 * 走 step-up 重看。本面板增加：
 *   - 「下载凭据」一次性 .txt（用户不依赖剪贴板的兜底）
 *   - 底部 hint 文案说明可重看入口
 */
export function DonePanel({
  credentials,
  onCreateAnother,
  onGoVms,
}: {
  credentials: VMCredentials;
  onCreateAnother: () => void;
  onGoVms: () => void;
}) {
  const { t } = useTranslation();

  const download = () => {
    const lines = [
      `# IncusAdmin VM credentials`,
      `# Generated: ${new Date().toISOString()}`,
      `# 提示：保管好此文件，密码可在 VM 详情页 → 初始凭据 重新查看。`,
      ``,
      `VM Name:  ${credentials.vm_name}`,
      `IP:       ${credentials.ip || "(分配中)"}`,
      `Username: ${credentials.username}`,
      `Password: ${credentials.password}`,
      ``,
      `SSH:      ssh ${credentials.username}@${credentials.ip || "<IP>"}`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = `${credentials.vm_name}-credentials.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success(t("launch.credentialsDownloaded", { defaultValue: "凭据已下载" }));
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  return (
    <PageContent>
      <Card className="border-status-success/30 bg-status-success/8">
        <CardContent className="flex flex-col gap-4 p-5">
          <header className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-status-success" aria-hidden="true" />
            <h2 className="text-base font-emphasis text-status-success">
              {t("launch.done", { defaultValue: "云主机创建成功" })}
            </h2>
          </header>
          <p className="text-caption text-text-tertiary">
            {t("billing.saveCredentialsHint", {
              defaultValue: "请保存以下凭据。",
            })}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SecretReveal label={t("vm.name")} value={credentials.vm_name} inline={false} />
            <SecretReveal
              label={t("vm.ip")}
              value={credentials.ip || t("vm.assigning", { defaultValue: "分配中..." })}
              inline={false}
              autoMaskMs={0}
            />
            <SecretReveal label={t("vm.username")} value={credentials.username} inline={false} />
            <SecretReveal label={t("vm.password")} value={credentials.password} inline={false} />
          </div>
          <div className="flex items-start gap-2 rounded-md border border-border bg-surface-1 px-3 py-2 text-caption text-text-secondary">
            <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-status-pending" />
            <span>
              {t("launch.credentialsRecoverableHint", {
                defaultValue: "若关闭页面前未复制，可在 VM 详情页 → 「初始凭据」重新查看（需二次认证）。",
              })}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={download}>
              <Download size={14} aria-hidden="true" />
              {t("launch.downloadCredentials", { defaultValue: "下载凭据" })}
            </Button>
            <Button variant="ghost" onClick={onCreateAnother}>
              <Plus size={14} aria-hidden="true" />
              {t("launch.createAnother", { defaultValue: "再创建一台" })}
            </Button>
            <Button variant="primary" onClick={onGoVms}>
              {t("launch.goVms", { defaultValue: "前往我的云主机" })}
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageContent>
  );
}
