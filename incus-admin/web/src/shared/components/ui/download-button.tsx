import type {AnchorHTMLAttributes, ReactNode} from "react";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "@/shared/lib/utils";
import { buttonVariants } from "./button";

/**
 * DownloadButton —— F2 文件下载（CSV 等）+ toast 反馈。
 * 用浏览器原生下载（<a download>），但点击瞬间出 toast，给用户即时反馈。
 */
interface DownloadButtonProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children"> {
  href: string;
  children: ReactNode;
  /** toast 文案，默认 "正在导出..."，下载是浏览器原生行为，无法精确感知完成 */
  toastMessage?: string;
}

export function DownloadButton({
  href,
  children,
  toastMessage,
  className,
  onClick,
  ...props
}: DownloadButtonProps) {
  const { t } = useTranslation();
  return (
    <a
      href={href}
      download
      onClick={(e) => {
        toast.success(
          toastMessage ?? t("common.exporting", { defaultValue: "正在导出..." }),
          { duration: 4000 },
        );
        onClick?.(e);
      }}
      className={cn(buttonVariants({ variant: "primary", size: "md" }), className)}
      {...props}
    >
      <Download size={14} aria-hidden="true" />
      {children}
    </a>
  );
}
