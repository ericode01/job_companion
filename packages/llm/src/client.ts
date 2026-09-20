import Anthropic from "@anthropic-ai/sdk";
import { getSpendStatus, loadEnv, recordUsage } from "@jd/core";

const g = globalThis as unknown as { __jdAnthropic?: Anthropic };

export class LlmUnavailableError extends Error {}
export class BudgetExceededError extends Error {}

export function hasApiKey(): boolean {
  loadEnv();
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function getClient(): Anthropic {
  if (!hasApiKey()) throw new LlmUnavailableError("ANTHROPIC_API_KEY is not set in .env.local");
  g.__jdAnthropic ??= new Anthropic();
  return g.__jdAnthropic;
}

/**
 * Budget gate. With several people on one bill, a cap stops foreground work as well as
 * background work; the single-user app used to let clicks through. `opts` is kept so
 * callers can still say what kind of work it is.
 */
export function assertBudget(_opts: { background: boolean }): void {
  const s = getSpendStatus();
  if (s.overCap) {
    throw new BudgetExceededError(`AI spending reached ${s.reason}. It resets tomorrow, or an admin can raise it.`);
  }
}

export function recordMessageUsage(purpose: string, model: string, usage: Anthropic.Usage): void {
  recordUsage({
    purpose,
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    webSearchRequests: usage.server_tool_use?.web_search_requests ?? 0,
  });
}

/** Transient API failures worth retrying later (rate limits, overload, 5xx, network). */
export function isRetryableLlmError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  return err instanceof Anthropic.APIError && typeof err.status === "number" && (err.status === 429 || err.status >= 500);
}

export function describeLlmError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The Claude API key was rejected.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Claude API.";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ""}: ${err.message}`.trim();
  return err instanceof Error ? err.message : String(err);
}
