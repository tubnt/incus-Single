import type { Invoice, Order } from "./api";
import type { Product } from "@/features/products/api";
import { Dialog } from "@base-ui-components/react/dialog";
import { useTranslation } from "react-i18next";
import { formatCurrency } from "@/shared/lib/utils";

interface Props {
  invoice: Invoice | null;
  orders: Order[];
  products: Product[];
  onClose: () => void;
}

// 发票详情弹窗。不发新请求：借助页面已加载的 orders + products 数据拼接展示。
// Invoice 模型本身无 line_items，所谓「详情」即关联订单 + 产品规格。
export function InvoiceDetailDialog({ invoice, orders, products, onClose }: Props) {
  const { t } = useTranslation();
  const open = invoice !== null;
  const order = invoice ? orders.find((o) => o.id === invoice.order_id) : undefined;
  const product = order ? products.find((p) => p.id === order.product_id) : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card shadow-lg p-5 outline-none data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:scale-95 transition-all">
          <Dialog.Title className="text-base font-[590] text-foreground">
            {t("invoice.detailTitle", { defaultValue: "发票详情" })} #{invoice?.id ?? ""}
          </Dialog.Title>

          {invoice ? (
            <div className="mt-4 space-y-4 text-sm">
              <section>
                <h3 className="font-[510] mb-2">{t("invoice.sectionInvoice", { defaultValue: "发票信息" })}</h3>
                <Row label={t("billing.amount")} value={formatCurrency(invoice.amount, invoice.currency)} mono />
                <Row label={t("billing.status")} value={invoice.status} />
                <Row
                  label={t("billing.paidAt", { defaultValue: "Paid At" })}
                  value={invoice.paid_at ? new Date(invoice.paid_at).toLocaleString() : "—"}
                />
              </section>

              <section>
                <h3 className="font-[510] mb-2">{t("invoice.sectionOrder", { defaultValue: "关联订单" })}</h3>
                {order ? (
                  <>
                    <Row label="#" value={String(order.id)} mono />
                    <Row label={t("billing.status")} value={order.status} />
                    <Row
                      label={t("billing.expires")}
                      value={order.expires_at ? new Date(order.expires_at).toLocaleDateString() : "—"}
                    />
                    <Row label={t("vm.created", { defaultValue: "Created" })} value={new Date(order.created_at).toLocaleString()} />
                  </>
                ) : (
                  <div className="text-muted-foreground text-xs">{t("invoice.orderMissing", { defaultValue: "关联订单记录已清除" })}</div>
                )}
              </section>

              <section>
                <h3 className="font-[510] mb-2">{t("invoice.sectionProduct", { defaultValue: "产品规格" })}</h3>
                {product ? (
                  <>
                    <Row label={t("product.name", { defaultValue: "名称" })} value={product.name} />
                    <Row
                      label={t("product.spec", { defaultValue: "规格" })}
                      value={`${product.cpu}C / ${(product.memory_mb / 1024).toFixed(0)}G RAM / ${product.disk_gb}G SSD`}
                    />
                    <Row
                      label={t("product.priceMonthly", { defaultValue: "月价" })}
                      value={formatCurrency(product.price_monthly, product.currency ?? invoice.currency)}
                      mono
                    />
                  </>
                ) : (
                  <div className="text-muted-foreground text-xs">{t("invoice.productMissing", { defaultValue: "产品记录不存在（可能已下架）" })}</div>
                )}
              </section>
            </div>
          ) : null}

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-sm font-[510] bg-primary text-primary-foreground hover:opacity-90"
              autoFocus
            >
              {t("common.close", { defaultValue: "关闭" })}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-right" : "text-right"}>{value}</span>
    </div>
  );
}
