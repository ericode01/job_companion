import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import { settings, userSetting } from "./db/schema";
import { ATS_TYPES } from "./types";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

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
    models: z
      .object({
        queryParse: z.string().default("claude-haiku-4-5"),
        extraction: z.string().default("claude-haiku-4-5"),
        fitScore: z.string().default("claude-haiku-4-5"),
        research: z.string().default("claude-sonnet-5"),
        writing: z.string().default("claude-sonnet-5"),
        resumeParse: z.string().default("claude-sonnet-5"),
        emailClassify: z.string().default("claude-haiku-4-5"),
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
    refreshAfterDays: z.number().int().min(1).max(365).default(30),
    maxWebSearches: z.number().int().min(1).max(20).default(5),
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

export function getUserSettings<S extends UserSettingsSection>(userId: number, section: S): UserSettingsOf<S> {
  const row = getDb()
    .select()
    .from(userSetting)
    .where(and(eq(userSetting.userId, userId), eq(userSetting.key, section)))
    .get();
  const schema = UserSettingsSchemas[section];
  const parsed = schema.safeParse(row?.value ?? {});
  return (parsed.success ? parsed.data : schema.parse({})) as UserSettingsOf<S>;
}

export function saveUserSettings<S extends UserSettingsSection>(userId: number, section: S, value: unknown): UserSettingsOf<S> {
  const data = UserSettingsSchemas[section].parse(value) as UserSettingsOf<S>;
  getDb()
    .insert(userSetting)
    .values({ userId, key: section, value: data })
    .onConflictDoUpdate({ target: [userSetting.userId, userSetting.key], set: { value: data, updatedAt: new Date() } })
    .run();
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
export function getSettings<S extends SettingsSection>(section: S): SettingsOf<S> {
  const row = getDb().select().from(settings).where(eq(settings.key, section)).get();
  const schema = SettingsSchemas[section];
  const parsed = schema.safeParse(row?.value ?? {});
  return (parsed.success ? parsed.data : schema.parse({})) as SettingsOf<S>;
}

export function getAllSettings(): AllSettings {
  return Object.fromEntries(SETTINGS_SECTIONS.map((s) => [s, getSettings(s)])) as AllSettings;
}

/** Validates the full section and stores it. Throws ZodError on invalid input. */
export function saveSettings<S extends SettingsSection>(section: S, value: unknown): SettingsOf<S> {
  const data = SettingsSchemas[section].parse(value) as SettingsOf<S>;
  getDb()
    .insert(settings)
    .values({ key: section, value: data })
    .onConflictDoUpdate({ target: settings.key, set: { value: data, updatedAt: new Date() } })
    .run();
  return data;
}

/**
 * Switches on ATS types added since this install was last run, once each. Recording them in
 * `knownAts` means turning one back off sticks. Called after migrations.
 */
export function reconcileAtsSettings(): void {
  const stored = getDb().select().from(settings).where(eq(settings.key, "sources")).get();
  const current = getSettings("sources");
  // No stored row: the defaults already enable everything, so just record what's been offered.
  const added = stored ? ATS_TYPES.filter((t) => !current.knownAts.includes(t)) : [];
  if (stored && added.length === 0) return;
  saveSettings("sources", {
    ...current,
    enabledAts: [...new Set([...current.enabledAts, ...added])],
    knownAts: [...ATS_TYPES],
  });
}
