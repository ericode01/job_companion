import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, one } from "./db";
import { loadEnv } from "./paths";
import { settings, userSetting } from "./db/schema";
import { ATS_TYPES } from "./types";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** OpenRouter's Auto Router: it picks the model per request. Spelled as it spells it. */
export const AUTO_ROUTER = "openrouter:openrouter/auto";
/**
 * The default for extraction: pulling structure out of text, where there is a right answer on the
 * page. Chosen by measurement (DESIGN.md §23) — it filled this app's schemas 27 times out of 27,
 * where the cheaper open-weight models mostly couldn't, and it sorted real email 14/15 the same way
 * Haiku did at a twentieth of the price.
 *
 * Pinned rather than left to the Auto Router: over repeats of one structured call Auto ran
 * 3.2s / 14s / 31.8s against this model's steady 1.3–1.8s, because it lands on a different provider
 * each time. Everything here is either interactive or comparable across calls.
 */
const CHEAP = "openrouter:google/gemini-2.5-flash-lite";

/**
 * System settings, edited in the admin portal. Adding a setting = adding a field here (with a
 * default) plus a field spec in the admin form. Per-person settings are in UserSettingsSchemas.
 */
export const SettingsSchemas = {
  sources: z.object({
    enabledAts: z.array(z.enum(ATS_TYPES)).default([...ATS_TYPES]),
    refreshIntervalHours: z.number().min(1).max(168).default(12),
    concurrency: z.number().int().min(1).max(32).default(8),
    perHostConcurrency: z.number().int().min(1).max(16).default(4),
    /** Safety net for boards with tens of thousands of postings (large Workday tenants). */
    maxJobsPerBoard: z.number().int().min(50).max(20000).default(2000),
    autoGrowCompanies: z.boolean().default(false),
    maxCompaniesPerDiscovery: z.number().int().min(1).max(50).default(15),
    /** While the app is running, refresh stale job boards on a timer. */
    autoRefresh: z.boolean().default(true),
    /** Internal: ATS types this install has already been offered, so a new one is enabled once. */
    knownAts: z.array(z.string()).default([]),
  }),
  ai: z.object({
    /**
     * Each value is "<route>:<model id as that route spells it>", e.g. "anthropic:claude-sonnet-5"
     * or "openrouter:deepseek/deepseek-v4-flash". A value with no colon means Anthropic direct —
     * the spelling used before OpenRouter existed, kept working so stored rows never break.
     */
    models: z
      .object({
        queryParse: z.string().default(CHEAP),
        extraction: z.string().default(CHEAP),
        /**
         * Judgement, not extraction, and the one purpose no cheap model could take. On 12 real
         * postings they drifted 16–18 points from Haiku and changed the verdict band on 9 to 11 of
         * them. Scores are ranked against each other, so that reorders the pipeline. DESIGN.md §23.
         */
        fitScore: z.string().default("anthropic:claude-haiku-4-5"),
        research: z.string().default("anthropic:claude-haiku-4-5"),
        writing: z.string().default("anthropic:claude-sonnet-5"),
        resumeParse: z.string().default("anthropic:claude-sonnet-5"),
        emailClassify: z.string().default(CHEAP),
      })
      .prefault({}),
    /** Settings for OpenRouter's Auto Router, which apply whenever a model is set to it. */
    autoRouter: z
      .object({
        /** Cost-percentile band it may pick from: low = the cheapest 20% of ranked candidates. */
        costTier: z.enum(["low", "medium", "high", "xhigh", "max"]).default("low"),
        /** Hard ceilings, USD per million tokens. Null = no ceiling. */
        maxPromptUsd: z.number().min(0).nullable().default(0.5),
        maxCompletionUsd: z.number().min(0).nullable().default(2),
        /** Model patterns it must not pick, e.g. "openai/*". */
        excludedModels: z.array(z.string()).default([]),
      })
      .prefault({}),
    dailyCapUsd: z.number().min(0).nullable().default(null),
    monthlyCapUsd: z.number().min(0).nullable().default(null),
    /** Each person's own daily limit, on top of the system caps. Admins are exempt. */
    perUserDailyCapUsd: z.number().min(0).nullable().default(null),
    atCap: z.enum(["pause_background", "ask"]).default("pause_background"),
  }),
  research: z.object({
    researchOnOpen: z.boolean().default(true),
    /** Funding and headcount don't change monthly, and each re-research is a fresh search bill. */
    refreshAfterDays: z.number().int().min(1).max(365).default(90),
    /**
     * Each search's results join the context that every later turn re-reads, so this drives the
     * token bill as much as the per-search fee. Three covers the company, its funding and its news.
     */
    maxWebSearches: z.number().int().min(1).max(20).default(3),
    maxWebFetches: z.number().int().min(0).max(10).default(0),
    scoreSearchResults: z.boolean().default(true),
    maxScoredPerSearch: z.number().int().min(1).max(2000).default(200),
  }),
  mail: z.object({
    /** How every digest is sent. Credentials stay in the environment. */
    method: z.enum(["smtp", "resend"]).default("smtp"),
  }),
  /** Reading people's mailboxes (read-only) to keep pipelines up to date. */
  mailSync: z.object({
    enabled: z.boolean().default(true),
    /** Other providers by IMAP app password. Gmail uses Google sign-in (env credentials). */
    allowImap: z.boolean().default(true),
    intervalMinutes: z.number().int().min(5).max(1440).default(10),
    maxBackfillDays: z.number().int().min(7).max(365).default(180),
    /** Emails sent to the AI per check; the rest wait for the next check. */
    maxClassifyPerRun: z.number().int().min(5).max(500).default(100),
    /** Below this, an email's meaning waits for the person to confirm instead of moving a card. */
    autoApplyConfidence: z.number().min(0).max(1).default(0.75),
  }),
} as const;

/** Per-person settings: account page and onboarding. */
export const UserSettingsSchemas = {
  search: z.object({
    includeRemoteUS: z.boolean().default(true),
    postedWithinDays: z.number().int().min(1).max(365).nullable().default(30),
    excludedCompanies: z.array(z.string()).default([]),
    excludedTitleKeywords: z.array(z.string()).default([]),
  }),
  digest: z.object({
    enabled: z.boolean().default(false),
    to: z.string().default(""),
    sendTime: z.string().regex(HHMM).default("08:00"),
    minFitScore: z.number().min(0).max(100).default(60),
    skipWhenEmpty: z.boolean().default(true),
  }),
} as const;

export type UserSettingsSection = keyof typeof UserSettingsSchemas;
export type UserSettingsOf<S extends UserSettingsSection> = z.infer<(typeof UserSettingsSchemas)[S]>;

export function isUserSettingsSection(s: string): s is UserSettingsSection {
  return s in UserSettingsSchemas;
}

export async function getUserSettings<S extends UserSettingsSection>(userId: number, section: S): Promise<UserSettingsOf<S>> {
  const row = await one(
    getDb()
      .select()
      .from(userSetting)
      .where(and(eq(userSetting.userId, userId), eq(userSetting.key, section))),
  );
  const schema = UserSettingsSchemas[section];
  const parsed = schema.safeParse(row?.value ?? {});
  return (parsed.success ? parsed.data : schema.parse({})) as UserSettingsOf<S>;
}

export async function saveUserSettings<S extends UserSettingsSection>(userId: number, section: S, value: unknown): Promise<UserSettingsOf<S>> {
  const data = UserSettingsSchemas[section].parse(value) as UserSettingsOf<S>;
  await getDb()
    .insert(userSetting)
    .values({ userId, key: section, value: data })
    .onConflictDoUpdate({ target: [userSetting.userId, userSetting.key], set: { value: data, updatedAt: new Date() } });
  return data;
}

export type SettingsSection = keyof typeof SettingsSchemas;
export type SettingsOf<S extends SettingsSection> = z.infer<(typeof SettingsSchemas)[S]>;
export type AllSettings = { [S in SettingsSection]: SettingsOf<S> };

export const SETTINGS_SECTIONS = Object.keys(SettingsSchemas) as SettingsSection[];

export function isSettingsSection(s: string): s is SettingsSection {
  return s in SettingsSchemas;
}

/** Stored values merged over defaults. Invalid stored values fall back to defaults. */
export async function getSettings<S extends SettingsSection>(section: S): Promise<SettingsOf<S>> {
  const row = await one(getDb().select().from(settings).where(eq(settings.key, section)));
  const schema = SettingsSchemas[section];
  const parsed = schema.safeParse(row?.value ?? {});
  return (parsed.success ? parsed.data : schema.parse({})) as SettingsOf<S>;
}

export async function getAllSettings(): Promise<AllSettings> {
  return Object.fromEntries(await Promise.all(SETTINGS_SECTIONS.map(async (s) => [s, await getSettings(s)] as const))) as AllSettings;
}

/** Validates the full section and stores it. Throws ZodError on invalid input. */
export async function saveSettings<S extends SettingsSection>(section: S, value: unknown): Promise<SettingsOf<S>> {
  const data = SettingsSchemas[section].parse(value) as SettingsOf<S>;
  await getDb()
    .insert(settings)
    .values({ key: section, value: data })
    .onConflictDoUpdate({ target: settings.key, set: { value: data, updatedAt: new Date() } });
  return data;
}

/**
 * Rewrites model settings saved before routes existed ("claude-haiku-4-5") into the qualified
 * spelling ("anthropic:claude-haiku-4-5"), once. Both forms work, so this only makes the stored
 * row say out loud where its calls go. Called after migrations, beside reconcileAtsSettings.
 */
export async function reconcileAiSettings(): Promise<void> {
  const stored = await one(getDb().select().from(settings).where(eq(settings.key, "ai")));
  if (!stored) return; // no row: the defaults are already qualified
  const current = await getSettings("ai");
  const entries = Object.entries(current.models);
  if (entries.every(([, v]) => v.includes(":"))) return;

  loadEnv();
  const canRoute = Boolean(process.env.OPENROUTER_API_KEY);
  const chosen = ((stored.value as { models?: Record<string, string> }).models ?? {}) as Record<string, string>;
  const models = Object.fromEntries(
    entries.map(([purpose, fallback]) => {
      const was = chosen[purpose];
      if (was) return [purpose, was.includes(":") ? was : `anthropic:${was}`];
      // A purpose this install never chose gets the new default — unless that default needs a key
      // this server hasn't got, in which case adopting it would quietly turn the feature off.
      if (!canRoute && fallback.startsWith("openrouter:")) return [purpose, "anthropic:claude-haiku-4-5"];
      return [purpose, fallback];
    }),
  );
  await saveSettings("ai", { ...current, models });
}

/**
 * Switches on ATS types added since this install was last run, once each. Recording them in
 * `knownAts` means turning one back off sticks. Called after migrations.
 */
export async function reconcileAtsSettings(): Promise<void> {
  const stored = await one(getDb().select().from(settings).where(eq(settings.key, "sources")));
  const current = await getSettings("sources");
  // No stored row: the defaults already enable everything, so just record what's been offered.
  const added = stored ? ATS_TYPES.filter((t) => !current.knownAts.includes(t)) : [];
  if (stored && added.length === 0) return;
  await saveSettings("sources", {
    ...current,
    enabledAts: [...new Set([...current.enabledAts, ...added])],
    knownAts: [...ATS_TYPES],
  });
}
