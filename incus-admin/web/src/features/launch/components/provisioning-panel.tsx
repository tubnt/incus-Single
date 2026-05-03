import type { useJobStream } from "@/features/jobs/use-job-stream";
import { Rocket } from "lucide-react";
import { useTranslation } from "react-i18next";
import { JobProgress } from "@/features/jobs/components/job-progress";
import { PageContent } from "@/shared/components/page/page-shell";
import { Card, CardContent } from "@/shared/components/ui/card";

/** /launch 中间态：SSE 进度流展示。 */
export function ProvisioningPanel({
  steps,
  ip,
}: {
  steps: ReturnType<typeof useJobStream>["steps"];
  ip: string | null;
}) {
  const { t } = useTranslation();
  return (
    <PageContent>
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <header className="flex items-center gap-2">
            <Rocket size={18} className="text-accent" aria-hidden="true" />
            <h2 className="text-base font-emphasis text-foreground">
              {t("launch.provisioning", { defaultValue: "正在创建云主机" })}
            </h2>
          </header>
          <p className="text-caption text-text-tertiary">
            {t("launch.provisioningHint", {
              defaultValue: "进度实时更新中，可离开本页稍后到「我的云主机」继续查看。",
            })}
          </p>
          <JobProgress steps={steps} />
          {ip ? (
            <div className="text-caption text-text-tertiary">
              {t("billing.allocatedIP", { defaultValue: "已分配 IP" })}
              {": "}
              <span className="font-mono text-foreground">{ip}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </PageContent>
  );
}
