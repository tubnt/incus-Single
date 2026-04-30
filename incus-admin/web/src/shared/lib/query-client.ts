import { QueryClient } from "@tanstack/react-query";

/**
 * 全局 QueryClient 默认值。
 *
 * D1: `refetchIntervalInBackground: false` —— hidden tab 时停止周期 fetch，
 *      避免后台大量无人看的请求消耗带宽和后端资源。
 * `refetchOnWindowFocus: "always"` —— tab 回到前台立即拉一次新鲜数据。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: "always",
      refetchIntervalInBackground: false,
    },
  },
});
