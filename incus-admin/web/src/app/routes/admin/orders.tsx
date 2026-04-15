import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";

export const Route = createFileRoute("/admin/orders")({
  component: AdminOrdersPage,
});

interface Order {
  id: number;
  user_id: number;
  product_id: number;
  cluster_id: number;
  status: string;
  amount: number;
  expires_at: string | null;
  created_at: string;
}

function AdminOrdersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["adminOrders"],
    queryFn: () => http.get<{ orders: Order[] }>("/admin/orders"),
    refetchInterval: 15_000,
  });

  const orders = data?.orders ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">订单管理</h1>

      {isLoading ? (
        <div className="text-muted-foreground">加载中...</div>
      ) : orders.length === 0 ? (
        <div className="border border-border rounded-lg p-6 text-center text-muted-foreground">
          暂无订单。
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2 font-medium">#</th>
                <th className="text-left px-4 py-2 font-medium">用户</th>
                <th className="text-left px-4 py-2 font-medium">产品</th>
                <th className="text-right px-4 py-2 font-medium">金额</th>
                <th className="text-left px-4 py-2 font-medium">状态</th>
                <th className="text-left px-4 py-2 font-medium">到期</th>
                <th className="text-left px-4 py-2 font-medium">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-border">
                  <td className="px-4 py-2">{o.id}</td>
                  <td className="px-4 py-2 text-xs">#{o.user_id}</td>
                  <td className="px-4 py-2 text-xs">#{o.product_id}</td>
                  <td className="px-4 py-2 text-right font-mono">¥{o.amount.toFixed(2)}</td>
                  <td className="px-4 py-2">
                    <OrderStatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {o.expires_at ? new Date(o.expires_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {new Date(o.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OrderStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-600",
    paid: "bg-primary/20 text-primary",
    active: "bg-success/20 text-success",
    expired: "bg-muted text-muted-foreground",
    cancelled: "bg-destructive/20 text-destructive",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}
