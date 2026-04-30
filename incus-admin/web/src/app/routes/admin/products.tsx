import type { Product, ProductFormData } from "@/features/products/api";
import type { PageParams } from "@/shared/lib/pagination";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useAdminProductsQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
} from "@/features/products/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { useConfirm } from "@/shared/components/ui/confirm-dialog";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Pagination } from "@/shared/components/ui/pagination";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { StatusPill } from "@/shared/components/ui/status";
import { Switch } from "@/shared/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { formatCurrency } from "@/shared/lib/utils";

export const Route = createFileRoute("/admin/products")({
  component: ProductsPage,
});

function ProductsPage() {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [page, setPage] = useState<PageParams>({ limit: 50, offset: 0 });

  const { data, isLoading } = useAdminProductsQuery(page);
  const products = data?.products ?? [];
  const total = data?.total ?? products.length;

  const sheetOpen = createOpen || editingProduct !== null;

  return (
    <PageShell>
      <PageHeader
        title={t("admin.products.title", "产品套餐")}
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setEditingProduct(null);
              setCreateOpen(true);
            }}
          >
            <Plus size={14} aria-hidden="true" />
            {t("admin.products.add", "+ 添加套餐")}
          </Button>
        }
      />
      <PageContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : products.length === 0 ? (
          <EmptyState
            title={t(
              "admin.products.empty",
              "暂无产品套餐。添加后用户可以选择购买。",
            )}
          />
        ) : (
          <>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("admin.products.name", "名称")}</TableHead>
                    <TableHead>{t("admin.products.specs", "配置")}</TableHead>
                    <TableHead className="text-right">
                      {t("admin.products.price", "月价")}
                    </TableHead>
                    <TableHead>{t("admin.products.status", "状态")}</TableHead>
                    <TableHead>{t("admin.products.access", "访问")}</TableHead>
                    <TableHead className="text-right">
                      {t("admin.products.actions", "操作")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => (
                    <ProductRow
                      key={p.id}
                      product={p}
                      onEdit={() => {
                        setCreateOpen(false);
                        setEditingProduct(p);
                      }}
                    />
                  ))}
                </TableBody>
              </Table>
            </Card>
            <Pagination
              total={total}
              limit={page.limit}
              offset={page.offset}
              onChange={(limit, offset) => setPage({ limit, offset })}
              className="mt-3"
            />
          </>
        )}

        <Sheet
          open={sheetOpen}
          onOpenChange={(o) => {
            if (!o) {
              setCreateOpen(false);
              setEditingProduct(null);
            }
          }}
        >
          <SheetContent side="right" size="min(96vw, 32rem)">
            {sheetOpen ? (
              <ProductForm
                product={editingProduct ?? undefined}
                onDone={() => {
                  setCreateOpen(false);
                  setEditingProduct(null);
                }}
              />
            ) : null}
          </SheetContent>
        </Sheet>
      </PageContent>
    </PageShell>
  );
}

function ProductRow({
  product,
  onEdit,
}: {
  product: Product;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const toggleMutation = useUpdateProductMutation(product.id);

  const onToggle = async () => {
    if (product.active) {
      const ok = await confirm({
        title: t("admin.products.deactivateTitle", "下架产品"),
        message: t("admin.products.deactivateMessage", {
          defaultValue: `确认下架「${product.name}」?`,
          name: product.name,
        }),
        destructive: true,
      });
      if (!ok) return;
    }
    toggleMutation.mutate(
      { active: !product.active },
      {
        onError: (err) => toast.error((err as Error).message),
      },
    );
  };

  return (
    <TableRow>
      <TableCell>
        <div className="font-[510]">{product.name}</div>
        <div className="text-xs text-muted-foreground">{product.slug}</div>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {product.cpu}C / {(product.memory_mb / 1024).toFixed(0)}G RAM /{" "}
        {product.disk_gb}G SSD
        {product.bandwidth_tb > 0 && ` / ${product.bandwidth_tb}TB`}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatCurrency(product.price_monthly, product.currency)}
      </TableCell>
      <TableCell>
        <StatusPill status={product.active ? "success" : "disabled"}>
          {product.active
            ? t("admin.products.active", "上架")
            : t("admin.products.inactive", "下架")}
        </StatusPill>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {product.access}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            {t("common.edit", "编辑")}
          </Button>
          <Button
            variant={product.active ? "destructive" : "ghost"}
            size="sm"
            onClick={onToggle}
            disabled={toggleMutation.isPending}
            aria-label={
              product.active
                ? `Deactivate product ${product.slug}`
                : `Activate product ${product.slug}`
            }
            data-testid={
              product.active
                ? `deactivate-product-${product.slug}`
                : `activate-product-${product.slug}`
            }
          >
            {product.active
              ? t("admin.products.deactivate", "下架")
              : t("admin.products.activate", "上架")}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function ProductForm({
  product,
  onDone,
}: {
  product?: Product;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = !!product;

  const [form, setForm] = useState<ProductFormData>({
    name: product?.name ?? "",
    slug: product?.slug ?? "",
    cpu: product?.cpu ?? 1,
    memory_mb: product?.memory_mb ?? 1024,
    disk_gb: product?.disk_gb ?? 25,
    bandwidth_tb: product?.bandwidth_tb ?? 1,
    price_monthly: product?.price_monthly ?? 0,
    access: product?.access ?? "public",
    active: product?.active ?? true,
    sort_order: product?.sort_order ?? 0,
  });

  const createMutation = useCreateProductMutation();
  const updateMutation = useUpdateProductMutation(product?.id ?? 0);
  const mutation = isEdit ? updateMutation : createMutation;

  const onSubmit = () => mutation.mutate(form, { onSuccess: onDone });

  const set = (k: keyof ProductFormData, v: string | number | boolean) =>
    setForm({ ...form, [k]: v });

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {isEdit
            ? t("admin.products.editTitle", "编辑产品套餐")
            : t("admin.products.createTitle", "添加产品套餐")}
        </SheetTitle>
      </SheetHeader>
      <SheetBody>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5 col-span-2">
            <Label htmlFor="product-name">
              {t("admin.products.name", "名称")}
            </Label>
            <Input
              id="product-name"
              placeholder={t("admin.products.namePlaceholder", "名称")}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5 col-span-2">
            <Label htmlFor="product-slug">Slug</Label>
            <Input
              id="product-slug"
              placeholder="Slug"
              value={form.slug}
              onChange={(e) => set("slug", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-cpu">CPU</Label>
            <Input
              id="product-cpu"
              type="number"
              placeholder="CPU"
              value={form.cpu}
              onChange={(e) => set("cpu", +e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-mem">
              {t("admin.products.memoryMB", "内存MB")}
            </Label>
            <Input
              id="product-mem"
              type="number"
              placeholder={t("admin.products.memoryMB", "内存MB")}
              value={form.memory_mb}
              onChange={(e) => set("memory_mb", +e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-disk">
              {t("admin.products.diskGB", "磁盘GB")}
            </Label>
            <Input
              id="product-disk"
              type="number"
              placeholder={t("admin.products.diskGB", "磁盘GB")}
              value={form.disk_gb}
              onChange={(e) => set("disk_gb", +e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-bw">
              {t("admin.products.bandwidthTB", "带宽TB")}
            </Label>
            <Input
              id="product-bw"
              type="number"
              placeholder={t("admin.products.bandwidthTB", "带宽TB")}
              value={form.bandwidth_tb}
              onChange={(e) => set("bandwidth_tb", +e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-price">
              {t("admin.products.monthlyPrice", "月价")}
            </Label>
            <Input
              id="product-price"
              type="number"
              step="0.01"
              placeholder={t("admin.products.monthlyPrice", "月价")}
              value={form.price_monthly}
              onChange={(e) => set("price_monthly", +e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-sort">
              {t("admin.products.sortOrder", "排序")}
            </Label>
            <Input
              id="product-sort"
              type="number"
              placeholder={t("admin.products.sortOrder", "排序")}
              value={form.sort_order}
              onChange={(e) => set("sort_order", +e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 col-span-2 pt-1">
            <Switch
              id="product-active"
              checked={form.active}
              onCheckedChange={(checked) => set("active", checked)}
            />
            <Label htmlFor="product-active">
              {t("admin.products.active", "上架")}
            </Label>
          </div>
        </div>
        {mutation.isError ? (
          <Alert variant="error" className="mt-3">
            <AlertDescription>
              {(mutation.error as Error).message}
            </AlertDescription>
          </Alert>
        ) : null}
      </SheetBody>
      <SheetFooter>
        <Button variant="ghost" onClick={onDone}>
          {t("common.cancel", "取消")}
        </Button>
        <Button
          variant="primary"
          onClick={onSubmit}
          disabled={mutation.isPending || !form.name}
        >
          {mutation.isPending
            ? t("common.saving", "保存中...")
            : isEdit
              ? t("common.save", "保存")
              : t("admin.products.create", "创建套餐")}
        </Button>
      </SheetFooter>
    </>
  );
}
