import { useTranslation } from "react-i18next";
import { PageContent } from "@/shared/components/page/page-shell";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";

/** /launch 失败态：错误文案 + retry CTA。后端已在 SSE 流内自动退款。 */
export function FailedPanel({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <PageContent>
      <Card className="border-status-error/30 bg-status-error/8">
        <CardContent className="flex flex-col gap-4 p-5">
          <header>
            <h2 className="text-base font-emphasis text-status-error">
              {t("launch.failed", { defaultValue: "创建失败" })}
            </h2>
          </header>
          <p className="text-sm text-text-secondary">{error}</p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onRetry}>
              {t("common.retry", { defaultValue: "重试" })}
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageContent>
  );
}
