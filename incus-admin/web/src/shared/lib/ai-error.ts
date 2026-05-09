// PLAN-038 / OPS-041 + pma-cr F6：AI 调用错误分类。
//
// 把 raw error message 映射到 i18n key + 友好分类，让 AIExplainSection /
// AIDiagnosePanel 不再原样暴露 "anthropic 429: rate_limit_exceeded" / "context
// deadline exceeded" 这类对运维不友好的串。
//
// 输入：useQuery / useMutation 抛的 Error.message（任意字符串）
// 输出：discriminated category + i18n key（调用方 t(key, {msg: rawMsg})）

export type AIErrorCategory = "disabled" | "timeout" | "rate_limit" | "schema" | "other";

export interface AIErrorView {
  category: AIErrorCategory;
  i18nKey: string;       // 形如 "admin.nodes.add.ai.errorTimeout"
  rawMessage: string;
  /** disabled / rate_limit 应当让 UI 隐藏 retry / 静默；其他类别允许 retry。 */
  retryable: boolean;
}

const reTimeout = /timeout|deadline exceeded|i\/o timeout/i;
const reRateLimit = /\b429\b|rate.?limit|too many requests/i;
const reDisabled = /\b503\b|disabled|not configured|service unavailable/i;
const reSchema = /schema|invalid (?:json|response)|hallucination|tool_use/i;

/**
 * classifyAIError —— 根据 raw error message 给出分类 + i18n key。
 *
 * @param raw  raw error message
 * @param ns   i18n 命名空间前缀，例 "admin.nodes.add.ai" / "jobs.ai"
 */
export function classifyAIError(raw: string | undefined, ns: string): AIErrorView {
  const msg = raw ?? "";
  if (reDisabled.test(msg)) {
    return { category: "disabled", i18nKey: `${ns}.disabledHint`, rawMessage: msg, retryable: false };
  }
  if (reRateLimit.test(msg)) {
    return { category: "rate_limit", i18nKey: `${ns}.errorRateLimit`, rawMessage: msg, retryable: false };
  }
  if (reTimeout.test(msg)) {
    return { category: "timeout", i18nKey: `${ns}.errorTimeout`, rawMessage: msg, retryable: true };
  }
  if (reSchema.test(msg)) {
    return { category: "schema", i18nKey: `${ns}.errorSchema`, rawMessage: msg, retryable: true };
  }
  return { category: "other", i18nKey: `${ns}.errorGeneric`, rawMessage: msg, retryable: true };
}
