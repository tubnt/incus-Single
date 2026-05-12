import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Providers } from "@/app/providers";
import { routeTree } from "@/app/routeTree.gen";
import "./index.css";

// Session-3 🟡-1 / PLAN-051 §2-J：fontsource @font-face 异步注入，
// 不阻塞 FCP。每个 @import 是独立的 @font-face 集合（含 unicode-range
// 切片），浏览器仅在命中字符时才下载实际 woff2 文件。
//
// 注：原 index.css 同步 @import 会让 vite 打成 render-blocking CSS。
// 改 dynamic import 后变成 async preload-style，主 HTML/CSS 已经 paint
// 后字体才生效（FOUT；font-display: swap 已配，闪烁短）。
// @ts-expect-error fontsource css 没有 .d.ts，运行时由 vite 处理
void import("@fontsource-variable/inter/wght.css");
// @ts-expect-error fontsource css 没有 .d.ts，运行时由 vite 处理
void import("@fontsource-variable/jetbrains-mono/wght.css");
// @ts-expect-error fontsource css 没有 .d.ts，运行时由 vite 处理
void import("@fontsource-variable/noto-sans-sc/wght.css");

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
