import type {VMCredentials} from "@/features/billing/api";
import type {Product} from "@/features/products/api";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useCreateOrderMutation,
  usePayOrderMutation
  
} from "@/features/billing/api";
import { DEFAULT_OS_IMAGE, OsImagePicker } from "@/features/vms/os-image-picker";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
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
import { formatCurrency } from "@/shared/lib/utils";

/** 后端 SafeNameRe 镜像，避免 cryptic 400 */
const VM_NAME_RE = /^[a-z0-9][\w.-]*$/i;

interface PurchaseSheetProps {
  product: Product | null;
  onClose: () => void;
}

/**
 * D4 / B2: 把 ProductCard 的内联 expand 流程搬到右侧抽屉。
 * 整页只一个抽屉，避免布局跳动；提供 SecretReveal 展示新 VM 凭据。
 */
export function PurchaseSheet({ product, onClose }: PurchaseSheetProps) {
  const { t } = useTranslation();
  const [osImage, setOsImage] = useState<string>(DEFAULT_OS_IMAGE);
  const [vmName, setVmName] = useState("");
  const [credentials, setCredentials] = useState<VMCredentials | null>(null);

  const orderMutation = useCreateOrderMutation();
  const payMutation = usePayOrderMutation();

  const isPending = orderMutation.isPending || payMutation.isPending;
  const error = orderMutation.error || payMutation.error;

  const vmNameError =
    vmName !== "" && !VM_NAME_RE.test(vmName)
      ? t("billing.vmNameInvalid", {
          defaultValue: "VM 名称只能包含字母、数字、点 . 横杠 - 和下划线 _，且不能以特殊字符开头",
        })
      : "";

  const submitOrder = () => {
    if (!product || vmNameError) return;
    orderMutation.mutate(
      { product_id: product.id, vm_name: vmName || undefined, os_image: osImage },
      {
        onSuccess: (data) => {
          payMutation.mutate(
            { orderId: data.order.id, vm_name: vmName || undefined, os_image: osImage },
            {
              onSuccess: (res) => {
                if (res.password) setCredentials(res);
              },
            },
          );
        },
      },
    );
  };

  const handleClose = () => {
    setOsImage(DEFAULT_OS_IMAGE);
    setVmName("");
    setCredentials(null);
    onClose();
  };

  return (
    <Sheet open={!!product} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <SheetContent side="right" size="min(96vw, 32rem)">
        {product ? (
          <>
            <SheetHeader>
              <SheetTitle>
                {credentials
                  ? t("billing.purchaseDone", { defaultValue: "购买成功" })
                  : t("billing.purchase", { defaultValue: "购买" })}
                {" · "}
                <span className="font-mono text-text-tertiary">{product.name}</span>
              </SheetTitle>
              <SheetDescription>
                {credentials
                  ? t("billing.saveCredentialsHint", {
                      defaultValue: "请保存以下凭据 —— 密码仅显示一次，关闭后无法再次查看。",
                    })
                  : t("billing.purchaseHint", {
                      defaultValue: "选择系统镜像和 VM 名称（可选），下单后立即扣款并 provision。",
                    })}
              </SheetDescription>
            </SheetHeader>

            <SheetBody>
              {credentials ? (
                <div className="space-y-3">
                  <SecretReveal label={t("vm.name", { defaultValue: "Name" })} value={credentials.vm_name} inline={false} />
                  <SecretReveal
                    label={t("vm.ip", { defaultValue: "IP" })}
                    value={credentials.ip || t("vm.assigning", { defaultValue: "分配中..." })}
                    inline={false}
                    autoMaskMs={0}
                  />
                  <SecretReveal label={t("vm.username", { defaultValue: "Username" })} value={credentials.username} inline={false} />
                  <SecretReveal label={t("vm.password", { defaultValue: "Password" })} value={credentials.password} inline={false} />
                </div>
              ) : (
                <div className="space-y-4">
                  <SpecRow product={product} />

                  <div className="space-y-1.5">
                    <Label>{t("billing.osImage", { defaultValue: "系统镜像" })}</Label>
                    <OsImagePicker value={osImage} onChange={setOsImage} />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="vm-name">
                      {t("billing.vmName", { defaultValue: "VM 名称（可选）" })}
                    </Label>
                    <Input
                      id="vm-name"
                      type="text"
                      value={vmName}
                      onChange={(e) => setVmName(e.target.value)}
                      placeholder={t("billing.vmNamePlaceholder", { defaultValue: "留空自动生成" })}
                      aria-invalid={!!vmNameError}
                    />
                    {vmNameError ? (
                      <div className="text-status-error text-caption">{vmNameError}</div>
                    ) : null}
                  </div>

                  {error ? (
                    <div className="rounded-md border border-status-error/30 bg-status-error/8 p-3 text-sm text-status-error">
                      {(error as Error).message}
                    </div>
                  ) : null}
                </div>
              )}
            </SheetBody>

            {credentials ? (
              <SheetFooter>
                <Button variant="primary" onClick={handleClose}>
                  {t("common.ok", { defaultValue: "好的" })}
                </Button>
              </SheetFooter>
            ) : (
              <SheetFooter>
                <Button variant="ghost" onClick={handleClose}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="primary"
                  disabled={isPending || !!vmNameError}
                  onClick={submitOrder}
                >
                  {isPending
                    ? t("common.processing", { defaultValue: "处理中..." })
                    : t("billing.payAndProvision", {
                        defaultValue: "支付并创建（{{price}}）",
                        price: formatCurrency(product.price_monthly, product.currency),
                      })}
                </Button>
              </SheetFooter>
            )}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SpecRow({ product }: { product: Product }) {
  const { t } = useTranslation();
  const cells = [
    { label: "CPU", value: `${product.cpu} 核` },
    { label: t("vm.memory", { defaultValue: "内存" }), value: `${(product.memory_mb / 1024).toFixed(0)} GB` },
    { label: t("vm.disk", { defaultValue: "磁盘" }), value: `${product.disk_gb} GB SSD` },
  ];
  return (
    <div className="rounded-md border border-border bg-surface-1 p-3 grid grid-cols-3 gap-2">
      {cells.map((c) => (
        <div key={c.label}>
          <div className="text-caption text-text-tertiary">{c.label}</div>
          <div className="font-emphasis tabular-nums">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
