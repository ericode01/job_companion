import { and, eq, gte, sql } from "drizzle-orm";
import { currentUserId } from "./actor";
import { getDb, one } from "./db";
import { llmUsage, user } from "./db/schema";
import { dearestPrice, priceFor } from "./prices";
import { getSettings } from "./settings";

/** USD per web search request (Anthropic's server tool). Web fetch has no per-request charge. */
const WEB_SEARCH_USD = 0.01;
/** Anthropic's cache rates as multiples of the input rate, for models the price table doesn't detail. */
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

export interface UsageInput {
  purpose: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  webSearchRequests?: number;
  /** What the provider says it charged. Beats any estimate; OpenRouter returns it per request. */
  costUsd?: number;
}

/**
 * What a call probably cost, from the price snapshot. Only used when the provider didn't say:
 * OpenRouter reports an exact figure, Anthropic doesn't. An unknown model is costed at the
 * dearest price on file, so a mistake shows up as an early cap rather than as free work.
 */
export function estimateCostUsd(u: UsageInput): number {
  const p = priceFor(u.model) ?? dearestPrice();
  const read = u.cacheReadTokens ?? 0;
  const write = u.cacheWriteTokens ?? 0;
  return (
    (u.inputTokens * p.input +
      read * (p.cacheRead ?? p.input * CACHE_READ_MULT) +
      write * (p.cacheWrite ?? p.input * CACHE_WRITE_MULT) +
      u.outputTokens * p.output) /
      1_000_000 +
    (u.webSearchRequests ?? 0) * WEB_SEARCH_USD
  );
}

/** True when nothing on file prices this model, so its cost is a worst-case guess. */
export function isEstimatedModel(model: string): boolean {
  return priceFor(model) === null;
}

export async function recordUsage(u: UsageInput): Promise<void> {
  await getDb()
    .insert(llmUsage)
    .values({
      userId: currentUserId(),
      purpose: u.purpose,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens ?? 0,
      cacheWriteTokens: u.cacheWriteTokens ?? 0,
      costUsd: u.costUsd ?? estimateCostUsd(u),
    });
}

async function spendSince(since: Date, userId?: number): Promise<number> {
  const row = await one(
    getDb()
      .select({ total: sql<number>`coalesce(sum(${llmUsage.costUsd}), 0)`.mapWith(Number) })
      .from(llmUsage)
      .where(and(gte(llmUsage.ts, since), userId === undefined ? undefined : eq(llmUsage.userId, userId))),
  );
  return row?.total ?? 0;
}

export interface SpendStatus {
  /** System-wide. */
  todayUsd: number;
  monthUsd: number;
  dailyCapUsd: number | null;
  monthlyCapUsd: number | null;
  /** The person the work is for, when there is one. */
  userTodayUsd: number | null;
  userDailyCapUsd: number | null;
  overCap: boolean;
  /** Which limit was hit, in words, for error messages. */
  reason: string | null;
}

/**
 * Spend against the system caps and, when the work is for a person, their own daily cap.
 * Admins aren't held to the per-person cap; the system caps still apply to them.
 */
export async function getSpendStatus(now = new Date(), userId: number | null = currentUserId()): Promise<SpendStatus> {
  const { dailyCapUsd, monthlyCapUsd, perUserDailyCapUsd } = await getSettings("ai");
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayUsd = await spendSince(dayStart);
  const monthUsd = await spendSince(new Date(now.getFullYear(), now.getMonth(), 1));
  const isAdmin = userId !== null && (await one(getDb().select({ role: user.role }).from(user).where(eq(user.id, userId))))?.role === "admin";
  const userCap = userId !== null && !isAdmin ? perUserDailyCapUsd : null;
  const userTodayUsd = userId !== null ? await spendSince(dayStart, userId) : null;

  let reason: string | null = null;
  if (dailyCapUsd !== null && todayUsd >= dailyCapUsd) reason = `the daily limit of $${dailyCapUsd.toFixed(2)}`;
  else if (monthlyCapUsd !== null && monthUsd >= monthlyCapUsd) reason = `the monthly limit of $${monthlyCapUsd.toFixed(2)}`;
  else if (userCap !== null && (userTodayUsd ?? 0) >= userCap) reason = `your daily limit of $${userCap.toFixed(2)}`;
  return { todayUsd, monthUsd, dailyCapUsd, monthlyCapUsd, userTodayUsd, userDailyCapUsd: userCap, overCap: reason !== null, reason };
}

/** Spend per person this month, for the admin portal. */
export async function spendByUser(now = new Date()): Promise<{ userId: number | null; usd: number; calls: number }[]> {
  return await getDb()
    .select({ userId: llmUsage.userId, usd: sql<number>`coalesce(sum(${llmUsage.costUsd}), 0)`.mapWith(Number), calls: sql<number>`count(*)`.mapWith(Number) })
    .from(llmUsage)
    .where(gte(llmUsage.ts, new Date(now.getFullYear(), now.getMonth(), 1)))
    .groupBy(llmUsage.userId);
}
