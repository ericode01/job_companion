import { and, eq, gte, sql } from "drizzle-orm";
import { currentUserId } from "./actor";
import { getDb } from "./db";
import { llmUsage, user } from "./db/schema";
import { getSettings } from "./settings";

/** USD per million tokens. Estimates for the spend view; update when pricing changes. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5": { input: 5, output: 25 },
};
/** USD per web search request (server tool). Web fetch has no per-request charge. */
const WEB_SEARCH_USD = 0.01;
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
}

export function estimateCostUsd(u: UsageInput): number {
  const p = PRICING[u.model] ?? PRICING["claude-opus-5"]!;
  const read = u.cacheReadTokens ?? 0;
  const write = u.cacheWriteTokens ?? 0;
  return (
    (u.inputTokens * p.input +
      read * p.input * CACHE_READ_MULT +
      write * p.input * CACHE_WRITE_MULT +
      u.outputTokens * p.output) /
      1_000_000 +
    (u.webSearchRequests ?? 0) * WEB_SEARCH_USD
  );
}

export function recordUsage(u: UsageInput): void {
  getDb()
    .insert(llmUsage)
    .values({
      userId: currentUserId(),
      purpose: u.purpose,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens ?? 0,
      cacheWriteTokens: u.cacheWriteTokens ?? 0,
      costUsd: estimateCostUsd(u),
    })
    .run();
}

function spendSince(since: Date, userId?: number): number {
  const row = getDb()
    .select({ total: sql<number>`coalesce(sum(${llmUsage.costUsd}), 0)` })
    .from(llmUsage)
    .where(and(gte(llmUsage.ts, since), userId === undefined ? undefined : eq(llmUsage.userId, userId)))
    .get();
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
export function getSpendStatus(now = new Date(), userId: number | null = currentUserId()): SpendStatus {
  const { dailyCapUsd, monthlyCapUsd, perUserDailyCapUsd } = getSettings("ai");
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayUsd = spendSince(dayStart);
  const monthUsd = spendSince(new Date(now.getFullYear(), now.getMonth(), 1));
  const isAdmin = userId !== null && getDb().select({ role: user.role }).from(user).where(eq(user.id, userId)).get()?.role === "admin";
  const userCap = userId !== null && !isAdmin ? perUserDailyCapUsd : null;
  const userTodayUsd = userId !== null ? spendSince(dayStart, userId) : null;

  let reason: string | null = null;
  if (dailyCapUsd !== null && todayUsd >= dailyCapUsd) reason = `the daily limit of $${dailyCapUsd.toFixed(2)}`;
  else if (monthlyCapUsd !== null && monthUsd >= monthlyCapUsd) reason = `the monthly limit of $${monthlyCapUsd.toFixed(2)}`;
  else if (userCap !== null && (userTodayUsd ?? 0) >= userCap) reason = `your daily limit of $${userCap.toFixed(2)}`;
  return { todayUsd, monthUsd, dailyCapUsd, monthlyCapUsd, userTodayUsd, userDailyCapUsd: userCap, overCap: reason !== null, reason };
}

/** Spend per person this month, for the admin portal. */
export function spendByUser(now = new Date()): { userId: number | null; usd: number; calls: number }[] {
  return getDb()
    .select({ userId: llmUsage.userId, usd: sql<number>`coalesce(sum(${llmUsage.costUsd}), 0)`, calls: sql<number>`count(*)` })
    .from(llmUsage)
    .where(gte(llmUsage.ts, new Date(now.getFullYear(), now.getMonth(), 1)))
    .groupBy(llmUsage.userId)
    .all();
}
