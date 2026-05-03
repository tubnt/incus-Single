import { Link } from "@tanstack/react-router";
import { ExternalLink, KeyRound, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * SSHKeyHint —— `/launch` 认证段。
 * 已绑：success 提示 + "管理"链接；未绑：warning 提示 + "去添加"链接。
 */
export function SSHKeyHint({ count, loading }: { count: number; loading: boolean }) {
  const { t } = useTranslation();
  if (loading) return null;
  if (count > 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-2 text-caption text-text-secondary">
        <ShieldCheck size={14} className="text-status-success" aria-hidden="true" />
        <span>
          {t("billing.sshKeyAutoInjectHint", {
            defaultValue: "已绑定 {{n}} 把 SSH Key，将自动注入到 authorized_keys。",
            n: count,
          })}
        </span>
        <Link
          to="/ssh-keys"
          className="ml-auto inline-flex items-center gap-1 text-accent hover:text-accent-hover"
        >
          {t("common.manage", { defaultValue: "管理" })}
          <ExternalLink size={12} aria-hidden="true" />
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-status-warning/30 bg-status-warning/8 px-3 py-2 text-caption text-text-secondary">
      <KeyRound size={14} className="text-status-warning" aria-hidden="true" />
      <span>
        {t("billing.sshKeyMissingHint", {
          defaultValue: "尚未上传 SSH Key —— VM 创建后只能用一次性密码登录。",
        })}
      </span>
      <Link
        to="/ssh-keys"
        className="ml-auto inline-flex items-center gap-1 text-accent hover:text-accent-hover"
      >
        {t("common.add", { defaultValue: "去添加" })}
        <ExternalLink size={12} aria-hidden="true" />
      </Link>
    </div>
  );
}
