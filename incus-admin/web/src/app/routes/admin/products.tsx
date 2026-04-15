import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

export const Route = createFileRoute("/admin/products")({
  component: ProductsPage,
});

interface Product {
  id: number;
  name: string;
  slug: string;
  cpu: number;
  memory_mb: number;
  disk_gb: number;
  bandwidth_tb: number;
  price_monthly: number;
  access: string;
  active: boolean;
  sort_order: number;
}

function ProductsPage() {
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["adminProducts"],
    queryFn: () => http.get<{ products: Product[] }>("/admin/products"),
  });

  const products = data?.products ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">产品套餐</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
        >
          {showCreate ? "取消" : "+ 添加套餐"}
        </button>
      </div>

      {showCreate && <ProductForm onDone={() => setShowCreate(false)} />}

      {isLoading ? (
        <div className="text-muted-foreground">加载中...</div>
      ) : products.length === 0 ? (
        <div className="border border-border rounded-lg p-6 text-center text-muted-foreground">
          暂无产品套餐。添加后用户可以选择购买。
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2 font-medium">名称</th>
                <th className="text-left px-4 py-2 font-medium">配置</th>
                <th className="text-right px-4 py-2 font-medium">月价</th>
                <th className="text-left px-4 py-2 font-medium">状态</th>
                <th className="text-left px-4 py-2 font-medium">访问</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.slug}</div>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {p.cpu}C / {(p.memory_mb / 1024).toFixed(0)}G RAM / {p.disk_gb}G SSD
                    {p.bandwidth_tb > 0 && ` / ${p.bandwidth_tb}TB`}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    ¥{p.price_monthly.toFixed(2)}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.active ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"}`}>
                      {p.active ? "上架" : "下架"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{p.access}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProductForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    name: "", slug: "", cpu: 1, memory_mb: 1024, disk_gb: 25,
    bandwidth_tb: 1, price_monthly: 0, access: "public",
  });

  const mutation = useMutation({
    mutationFn: () => http.post("/admin/products", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminProducts"] });
      onDone();
    },
  });

  const set = (k: string, v: string | number) => setForm({ ...form, [k]: v });

  return (
    <div className="border border-border rounded-lg bg-card p-4 mb-6">
      <h3 className="font-semibold mb-3">添加产品套餐</h3>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <input placeholder="名称" value={form.name} onChange={(e) => set("name", e.target.value)}
          className="px-3 py-2 rounded border border-border bg-card text-sm" />
        <input placeholder="Slug" value={form.slug} onChange={(e) => set("slug", e.target.value)}
          className="px-3 py-2 rounded border border-border bg-card text-sm" />
        <div className="flex gap-2">
          <input type="number" placeholder="CPU" value={form.cpu} onChange={(e) => set("cpu", +e.target.value)}
            className="w-20 px-3 py-2 rounded border border-border bg-card text-sm" />
          <input type="number" placeholder="内存MB" value={form.memory_mb} onChange={(e) => set("memory_mb", +e.target.value)}
            className="w-28 px-3 py-2 rounded border border-border bg-card text-sm" />
          <input type="number" placeholder="磁盘GB" value={form.disk_gb} onChange={(e) => set("disk_gb", +e.target.value)}
            className="w-28 px-3 py-2 rounded border border-border bg-card text-sm" />
        </div>
        <div className="flex gap-2">
          <input type="number" step="0.01" placeholder="月价" value={form.price_monthly}
            onChange={(e) => set("price_monthly", +e.target.value)}
            className="w-32 px-3 py-2 rounded border border-border bg-card text-sm" />
          <input type="number" placeholder="带宽TB" value={form.bandwidth_tb}
            onChange={(e) => set("bandwidth_tb", +e.target.value)}
            className="w-28 px-3 py-2 rounded border border-border bg-card text-sm" />
        </div>
      </div>
      {mutation.isError && (
        <div className="text-destructive text-sm mb-2">{(mutation.error as Error).message}</div>
      )}
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || !form.name}
        className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50"
      >
        {mutation.isPending ? "创建中..." : "创建套餐"}
      </button>
    </div>
  );
}
