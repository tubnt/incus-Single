import { QueryClient } from "@tanstack/react-query";

/**
 * 全局 QueryClient 默认值。
 *
 * D1: `refetchIntervalInBackground: false` —— hidden tab 时停止周期 fetch，
 *      避免后台大量无人看的请求消耗带宽和后端资源。
 * Session-3 §1🟡-3 / §1🔵-10：默认 `refetchOnWindowFocus: true`（受 staleTime
 *      gate 保护），避免每次切 tab 一次性 invalidate 14+ 条 polling query 撞主线程。
 *      若某个 query 必须切 tab 即刷新，单独写 `refetchOnWindowFocus: "always"`。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
    },
  },
});
