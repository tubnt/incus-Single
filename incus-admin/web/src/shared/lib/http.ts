import { savePendingIntent } from "./pending-intent";

const BASE_URL = "/api";

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
  /**
   * step-up 意图：可选元信息。如果调用方传了，且后端返回 step_up_required，
   * 我们会先 saveIntent 再跳 OIDC；OIDC 回来后由 <AppShell> 触发 replay 提示。
   */
  intent?: {
    action: string;
    args: Record<string, unknown>;
    description: string;
  };
}

class HttpError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: unknown,
  ) {
    super(`HTTP ${status}: ${formatHttpErrorBody(status, statusText, body)}`);
    this.name = "HttpError";
  }
}

function formatHttpErrorBody(status: number, statusText: string, body: unknown): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.error === "string" && b.error.length > 0) {
      if (Array.isArray(b.details) && b.details.length > 0) {
        return `${b.error} (${(b.details as unknown[]).join(", ")})`;
      }
      return b.error;
    }
    if (typeof b.message === "string" && b.message.length > 0) return b.message;
  }
  if (typeof body === "string" && body.length > 0) return body;
  return statusText || String(status);
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { params, intent, ...fetchOptions } = options;

  let url = `${BASE_URL}${path}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers as Record<string, string>),
  };

  const response = await fetch(url, { ...fetchOptions, headers });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    // Sensitive admin operations return 401 with { error, redirect } when the
    // user hasn't completed a recent step-up re-authentication. Bouncing the
    // browser to the redirect kicks off the Logto OIDC round-trip; the server
    // records auth_time on callback and the retried request passes through.
    //
    // Only accept same-origin relative paths under the step-up prefix so a
    // compromised server can't pivot the client to an external host via this
    // channel (protocol-relative //evil.com, absolute https://…, etc).
    if (response.status === 401 && isStepUpRequired(body) && isSafeStepUpRedirect(body.redirect)) {
      // A1: 跳转前持久化用户操作意图，OIDC 回来 <AppShell> mount 时弹 confirm 让用户决定是否 replay。
      const returnPath = `${window.location.pathname}${window.location.search}`;
      if (intent) {
        savePendingIntent({
          action: intent.action,
          args: intent.args,
          description: intent.description,
          returnPath,
        });
      }
      // PLAN-034 B3：后端 middleware 把 rd 设为 API endpoint URL（如 POST
      // /api/admin/users/1/balance），OIDC 回跳时浏览器走 GET → 405 method not allowed。
      // 这里前端把 rd 替换成当前 *页面* 路径，回跳后 PendingIntent confirm 重放原 mutation。
      const redirectURL = rewriteStepUpRD(body.redirect, returnPath);
      window.location.href = redirectURL;
    }
    throw new HttpError(response.status, response.statusText, body);
  }

  return response.json();
}

interface StepUpRequired {
  error: "step_up_required";
  redirect: string;
}

function isStepUpRequired(body: unknown): body is StepUpRequired {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return b.error === "step_up_required" && typeof b.redirect === "string";
}

// isSafeStepUpRedirect rejects anything that isn't an absolute path on our own
// origin pointing into the step-up prefix. Protocol-relative (`//…`), absolute
// (`https://…`), and paths outside `/api/auth/stepup/` are all refused.
function isSafeStepUpRedirect(url: string): boolean {
  return url.startsWith("/api/auth/stepup/") && !url.startsWith("//");
}

// rewriteStepUpRD swaps the `rd` query param in a step-up redirect URL with the
// page path the user is currently on. Without this, the backend default `rd`
// (the original API endpoint URL) bounces the browser back via GET → 405.
// pageReturnPath is constrained to a relative path; reject anything else.
function rewriteStepUpRD(redirectURL: string, pageReturnPath: string): string {
  if (!pageReturnPath.startsWith("/") || pageReturnPath.startsWith("//")) {
    return redirectURL;
  }
  // Use a fake base since we know redirectURL is relative.
  const u = new URL(redirectURL, "https://x");
  u.searchParams.set("rd", pageReturnPath);
  return u.pathname + u.search;
}

export const http = {
  get: <T>(path: string, params?: Record<string, string>) =>
    request<T>(path, { method: "GET", params }),

  post: <T>(path: string, body?: unknown, opts?: Pick<RequestOptions, "intent">) =>
    request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
      ...opts,
    }),

  put: <T>(path: string, body?: unknown, opts?: Pick<RequestOptions, "intent">) =>
    request<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
      ...opts,
    }),

  delete: <T>(path: string, params?: Record<string, string>, opts?: Pick<RequestOptions, "intent">) =>
    request<T>(path, { method: "DELETE", params, ...opts }),
};

export { HttpError };

/**
 * formatError —— 把任意 mutation/query error 转成用户友好的短文案。
 *
 * - HttpError：取后端 `body.error` 字符串（不带 "HTTP 4xx:" 前缀）
 * - 普通 Error：取 `.message`
 * - 字符串：原样
 * - 其它：fallback "Unknown error"
 *
 * 用于 `toast.error(formatError(e))`，避免把 "HTTP 403: admin cannot top up own balance"
 * 这种噪音前缀展示给用户。
 */
export function formatError(err: unknown, fallback = "Unknown error"): string {
  if (err instanceof HttpError) {
    if (err.body && typeof err.body === "object") {
      const b = err.body as Record<string, unknown>;
      if (typeof b.error === "string" && b.error.length > 0) return b.error;
      if (typeof b.message === "string" && b.message.length > 0) return b.message;
    }
    return err.statusText || fallback;
  }
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === "string") return err;
  return fallback;
}
