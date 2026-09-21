import Anthropic from "@anthropic-ai/sdk";
import { appOrigin, getSettings, getSpendStatus, loadEnv, recordUsage } from "@jd/core";
import type { z } from "zod";

const g = globalThis as unknown as { __jdAnthropic?: Anthropic; __jdOpenRouter?: Anthropic };

export class LlmUnavailableError extends Error {}
export class BudgetExceededError extends Error {}
/** The model answered, but not with the structure that was asked for. */
export class LlmOutputError extends Error {}

/* ---------- which provider a model setting names ---------- */

export const ROUTES = ["anthropic", "openrouter"] as const;
export type Route = (typeof ROUTES)[number];
export interface ModelRef {
  route: Route;
  model: string;
}

/** OpenRouter's Anthropic-compatible Messages API. The SDK appends /v1/messages. */
const OPENROUTER_BASE_URL = "https://openrouter.ai/api";
/** OpenRouter's own model that picks a model per request. */
const AUTO_MODEL = "openrouter/auto";

const KEY_VAR: Record<Route, string> = { anthropic: "ANTHROPIC_API_KEY", openrouter: "OPENROUTER_API_KEY" };
export const AI_KEY_HINT = "ANTHROPIC_API_KEY or OPENROUTER_API_KEY";

const isRoute = (s: string): s is Route => (ROUTES as readonly string[]).includes(s);

/**
 * Reads a model setting: "<route>:<model id exactly as that route spells it>", e.g.
 * "openrouter:deepseek/deepseek-v4-flash". The route is a separate token because OpenRouter's own
 * slug for Claude is "anthropic/claude-sonnet-5", so slashes alone can't tell Anthropic direct from
 * Claude-via-OpenRouter. A value with no colon means Anthropic direct — the spelling this app used
 * before OpenRouter existed, still accepted so a stored settings row never breaks.
 */
export function parseModel(setting: string): ModelRef {
  const raw = setting.trim();
  const at = raw.indexOf(":");
  if (at === -1) return { route: "anthropic", model: raw };
  const route = raw.slice(0, at).trim().toLowerCase();
  const model = raw.slice(at + 1).trim();
  if (!isRoute(route)) throw new LlmUnavailableError(`"${setting}" names an unknown provider "${route}". Use ${ROUTES.map((r) => `${r}:`).join(" or ")}.`);
  if (!model) throw new LlmUnavailableError(`"${setting}" names a provider but no model.`);
  return { route, model };
}

function keyFor(route: Route): string | undefined {
  loadEnv();
  if (route === "openrouter") return process.env.OPENROUTER_API_KEY;
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
}

/** Whether any model at all can run: some provider has a key. */
export function hasApiKey(): boolean {
  return ROUTES.some((r) => Boolean(keyFor(r)));
}

/** Whether this particular setting can run — its provider's key is present. */
export function hasKeyFor(setting: string): boolean {
  try {
    return Boolean(keyFor(parseModel(setting).route));
  } catch {
    return false;
  }
}

/* ---------- OpenRouter-only request fields ---------- */

/**
 * Merges the fields OpenRouter understands and the Anthropic SDK doesn't know about, so no call
 * site has to care which provider it is talking to. Exported for tests.
 */
export async function routingPrefs(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { autoRouter } = await getSettings("ai");
  const out = { ...body };
  const maxPrice = {
    ...(autoRouter.maxPromptUsd === null ? {} : { prompt: String(autoRouter.maxPromptUsd) }),
    ...(autoRouter.maxCompletionUsd === null ? {} : { completion: String(autoRouter.maxCompletionUsd) }),
  };
  out.provider = {
    // The privacy decision: only endpoints that don't train on or retain what we send. Resumes and
    // inbox contents go through here. If nothing qualifies, OpenRouter errors rather than routing.
    data_collection: "deny",
    // Never route to an endpoint that would quietly ignore the JSON schema we asked for.
    require_parameters: true,
    allow_fallbacks: true,
    ...(Object.keys(maxPrice).length ? { max_price: maxPrice } : {}),
    ...((body.provider as object | undefined) ?? {}),
  };
  if (body.model === AUTO_MODEL && !body.plugins) {
    out.plugins = [{ id: "auto-router", cost_tier: autoRouter.costTier, ...(autoRouter.excludedModels.length ? { excluded_models: autoRouter.excludedModels } : {}) }];
  }
  // Open-weight models default near temperature 1, which is wrong for filling a schema.
  const wantsSchema = typeof body.output_config === "object" && body.output_config !== null && "format" in body.output_config;
  if (wantsSchema && body.temperature === undefined) out.temperature = 0;
  return out;
}

const withRoutingPrefs: typeof fetch = async (input, init) => {
  if (typeof init?.body === "string") {
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      // Not a JSON body we recognise; send it untouched.
    }
    // Outside the try on purpose: reading the preferences is a database query now, and if it fails
    // the request must fail too, not go out without data_collection: "deny".
    if (body) init = { ...init, body: JSON.stringify(await routingPrefs(body)) };
  }
  return fetch(input, init);
};

/* ---------- clients ---------- */

function clientFor(route: Route): Anthropic {
  const key = keyFor(route);
  if (!key) throw new LlmUnavailableError(`${KEY_VAR[route]} is not set in .env.local, so ${route} models can't run.`);
  if (route === "anthropic") return (g.__jdAnthropic ??= new Anthropic());
  return (g.__jdOpenRouter ??= new Anthropic({
    baseURL: OPENROUTER_BASE_URL,
    // Null, or the SDK would also send x-api-key from ANTHROPIC_API_KEY. authToken is the Bearer
    // header OpenRouter wants.
    apiKey: null,
    authToken: key,
    defaultHeaders: { "HTTP-Referer": appOrigin(), "X-Title": "Job Companion" },
    fetch: withRoutingPrefs,
  }));
}

/**
 * The client and the model id to send, together, because a call site always needs both: the
 * setting says where to go, and only the part after the route goes on the wire.
 */
export function forModel(setting: string): { client: Anthropic; model: string; route: Route } {
  const { route, model } = parseModel(setting);
  return { client: clientFor(route), model, route };
}

/**
 * Budget gate. With several people on one bill, a cap stops foreground work as well as
 * background work; the single-user app used to let clicks through. `opts` is kept so
 * callers can still say what kind of work it is.
 */
export async function assertBudget(_opts: { background: boolean }): Promise<void> {
  const s = await getSpendStatus();
  if (s.overCap) {
    throw new BudgetExceededError(`AI spending reached ${s.reason}. It resets tomorrow, or an admin can raise it.`);
  }
}

/* ---------- accounting ---------- */

/** What recordMessageUsage needs from a response. OpenRouter adds `cost`; Anthropic doesn't. */
export interface UsageMessage {
  model?: string;
  usage: Anthropic.Usage & { cost?: number | null };
}

/**
 * Bills a call. The model recorded is the one that **answered**, not the one asked for: with the
 * Auto Router those differ, and the ledger is only useful if it names the real model. OpenRouter
 * reports an exact cost per request, so routed spend is measured rather than modelled.
 */
export async function recordMessageUsage(purpose: string, requested: string, message: UsageMessage): Promise<void> {
  const { usage } = message;
  await recordUsage({
    purpose,
    model: message.model || parseModel(requested).model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    webSearchRequests: usage.server_tool_use?.web_search_requests ?? 0,
    ...(typeof usage.cost === "number" ? { costUsd: usage.cost } : {}),
  });
}

/* ---------- structured output ---------- */

/** A response from messages.parse(): the SDK fills parsed_output when it can. */
export interface ParsedMessage {
  model?: string;
  content: Anthropic.ContentBlock[];
  parsed_output?: unknown;
}

const jsonIn = (text: string): unknown => {
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = trimmed.search(/[[{]/);
  if (start === -1) return undefined;
  const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return undefined;
  }
};

/**
 * The structured result, however the model chose to deliver it. The SDK's `parsed_output` is the
 * happy path; a model that writes the JSON into a text block instead still counts. Anything else
 * throws, naming the model, because a half-read schema is worse than a failed task.
 */
export function parseStructured<T>(message: ParsedMessage, schema: z.ZodType<T>, what: string): T {
  const candidates = [
    message.parsed_output,
    ...message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => jsonIn(b.text)),
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const parsed = schema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  throw new LlmOutputError(`${message.model ?? "The model"} returned no usable ${what}.`);
}

/* ---------- errors ---------- */

/** Transient API failures worth retrying later (rate limits, overload, 5xx, network). */
export function isRetryableLlmError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  return err instanceof Anthropic.APIError && typeof err.status === "number" && (err.status === 429 || err.status >= 500);
}

export function describeLlmError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The AI API key was rejected.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the AI provider.";
  // OpenRouter answers 402 when the account is out of credit. Retrying won't help.
  if (err instanceof Anthropic.APIError && err.status === 402) return "The AI provider is out of credit. Top up, or switch the model to one on a provider that isn't.";
  if (err instanceof Anthropic.APIError) return `AI provider error ${err.status ?? ""}: ${err.message}`.trim();
  return err instanceof Error ? err.message : String(err);
}
