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

export type ProductFormData = Omit<Product, "id">;

export const productKeys = {
  all: ["product"] as const,
  portalList: () => [...productKeys.all, "list", "portal"] as const,
  adminList: () => [...productKeys.all, "list", "admin"] as const,
};

export function useProductsQuery() {
  return useQuery({
    queryKey: productKeys.portalList(),
    queryFn: () => http.get<{ products: Product[] }>("/portal/products"),
  });
}

export function useAdminProductsQuery() {
  return useQuery({
    queryKey: productKeys.adminList(),
    queryFn: () => http.get<{ products: Product[] }>("/admin/products"),
  });
}

export function useCreateProductMutation() {
  return useMutation({
    mutationFn: (data: ProductFormData) => http.post("/admin/products", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productKeys.all }),
  });
}

export function useUpdateProductMutation(productId: number) {
  return useMutation({
    mutationFn: (data: ProductFormData | Product) =>
      http.put(`/admin/products/${productId}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productKeys.all }),
  });
}
