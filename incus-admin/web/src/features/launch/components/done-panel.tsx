import type { VMCredentials } from "@/features/billing/api";
import { CheckCircle2, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageContent } from "@/shared/components/page/page-shell";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { SecretReveal } from "@/shared/components/ui/secret-reveal";

/** /launch 完成态：凭据 grid + 后续 CTA。密码仅展示一次。 */
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
              defaultValue: "请保存以下凭据 —— 密码仅显示一次。",
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
          <div className="flex flex-wrap items-center justify-end gap-2">
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
