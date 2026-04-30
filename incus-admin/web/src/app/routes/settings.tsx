import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/shared/components/theme-provider";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <PageShell>
      <PageHeader title={t("settings.title", { defaultValue: "设置" })} />
      <PageContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.language", { defaultValue: "语言" })}</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-2 flex-wrap">
              {[
                { code: "zh", label: "中文" },
                { code: "en", label: "English" },
              ].map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => i18n.changeLanguage(lang.code)}
                  className={cn(
                    "h-9 px-4 rounded-md text-sm font-emphasis border transition-colors",
                    i18n.language === lang.code
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-surface-1 hover:bg-surface-2 text-foreground",
                  )}
                >
                  {lang.label}
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.theme", { defaultValue: "主题" })}</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-2 flex-wrap">
              {[
                { value: "system" as const, label: t("settings.system", { defaultValue: "跟随系统" }) },
                { value: "light" as const, label: t("settings.light", { defaultValue: "浅色" }) },
                { value: "dark" as const, label: t("settings.dark", { defaultValue: "深色" }) },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTheme(opt.value)}
                  className={cn(
                    "h-9 px-4 rounded-md text-sm font-emphasis border transition-colors",
                    theme === opt.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-surface-1 hover:bg-surface-2 text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </PageContent>
    </PageShell>
  );
}
