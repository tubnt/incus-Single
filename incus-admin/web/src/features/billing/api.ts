import { useMutation, useQuery } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";

export interface Product {
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

export interface Order {
  id: number;
  user_id: number;
  product_id: number;
  cluster_id: number;
  status: string;
  amount: number;
  expires_at: string | null;
  created_at: string;
}

export interface Invoice {
  id: number;
  order_id: number;
  amount: number;
  status: string;
  paid_at: string | null;
  created_at: string;
}

export function useProductsQuery(base: "/portal" | "/admin" = "/portal") {
  return useQuery({
    queryKey: ["products", base],
    queryFn: () => http.get<{ products: Product[] }>(`${base}/products`),
  });
}

export function useOrdersQuery(base: "/portal" | "/admin" = "/portal") {
  return useQuery({
    queryKey: [base === "/admin" ? "adminOrders" : "myOrders"],
    queryFn: () => http.get<{ orders: Order[] }>(`${base}/orders`),
  });
}

export function useInvoicesQuery() {
  return useQuery({
    queryKey: ["myInvoices"],
    queryFn: () => http.get<{ invoices: Invoice[] }>("/portal/invoices"),
  });
}

export function useCreateOrderMutation() {
  return useMutation({
    mutationFn: (params: { product_id: number; vm_name?: string; os_image?: string }) =>
      http.post("/portal/orders", params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["myOrders"] }),
  });
}

export function usePayOrderMutation() {
  return useMutation({
    mutationFn: (orderId: number) => http.post(`/portal/orders/${orderId}/pay`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myOrders"] });
      queryClient.invalidateQueries({ queryKey: ["myInvoices"] });
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
    },
  });
}

export function useCreateProductMutation() {
  return useMutation({
    mutationFn: (data: Partial<Product>) => http.post("/admin/products", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}
