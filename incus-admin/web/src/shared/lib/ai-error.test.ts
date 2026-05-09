import { describe, expect, it } from "vitest";
import { classifyAIError } from "./ai-error";

describe("classifyAIError", () => {
  it("503 / disabled", () => {
    expect(classifyAIError("ai disabled", "jobs.ai").category).toBe("disabled");
    expect(classifyAIError("anthropic 503: service unavailable", "jobs.ai").category).toBe("disabled");
  });
  it("429 / rate limit", () => {
    expect(classifyAIError("anthropic 429: rate_limit_exceeded", "jobs.ai").category).toBe("rate_limit");
    expect(classifyAIError("Too many requests", "jobs.ai").category).toBe("rate_limit");
  });
  it("timeout", () => {
    expect(classifyAIError("context deadline exceeded", "jobs.ai").category).toBe("timeout");
    expect(classifyAIError("i/o timeout connecting upstream", "jobs.ai").category).toBe("timeout");
  });
  it("schema", () => {
    expect(classifyAIError("schema validation failed", "jobs.ai").category).toBe("schema");
    expect(classifyAIError("recommended nic not in interfaces (hallucination)", "jobs.ai").category).toBe("schema");
  });
  it("falls back to other", () => {
    expect(classifyAIError("unknown error blah", "jobs.ai").category).toBe("other");
    expect(classifyAIError(undefined, "jobs.ai").category).toBe("other");
  });
  it("emits namespaced i18n key", () => {
    expect(classifyAIError("timeout", "admin.nodes.add.ai").i18nKey).toBe("admin.nodes.add.ai.errorTimeout");
    expect(classifyAIError("disabled", "jobs.ai").i18nKey).toBe("jobs.ai.disabledHint");
  });
  it("retryable flag", () => {
    expect(classifyAIError("disabled", "x").retryable).toBe(false);
    expect(classifyAIError("rate_limit", "x").retryable).toBe(false);
    expect(classifyAIError("timeout", "x").retryable).toBe(true);
  });
});
