import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ActionType, ApplicationSource, EmailKind, InterviewRound, ReviewState, StatusEventSource } from "../mail-types";
import type { ApplicationStatus, CompanyProfile, FitResult, JobAnalysis, ResumeChange, ResumeSource } from "../research-types";
import type { AtsType, Comp, DiscoveryCandidate, LocationType, SearchFilter } from "../types";

const now = sql`(unixepoch() * 1000)`;
const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull().default(now);

/* ---------- Accounts ---------- */

export type UserRole = "admin" | "member";
export const ONBOARDING_STEPS = ["search", "resume", "about", "answers", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const user = sqliteTable("user", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Stored lowercased. */
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<UserRole>().notNull().default("member"),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  /** IANA zone from the browser at sign-up; the digest send time is in this zone. */
  timezone: text("timezone").notNull().default("UTC"),
  /** The onboarding step to resume at; null once onboarding is finished. */
  onboardingStep: text("onboarding_step").$type<OnboardingStep>().default("search"),
  lastSearchId: integer("last_search_id"),
  createdAt: createdAt(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
});

export const session = sqliteTable(
  "session",
  {
    /** SHA-256 of the cookie token; the token itself is never stored. */
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const invite = sqliteTable("invite", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tokenHash: text("token_hash").notNull().unique(),
  /** Optional: when set, only this address can accept it. */
  email: text("email"),
  role: text("role").$type<UserRole>().notNull().default("member"),
  createdBy: integer("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  usedBy: integer("used_by").references(() => user.id, { onDelete: "set null" }),
});

/** Per-person settings (search defaults, digest delivery). System settings stay in `settings`. */
export const userSetting = sqliteTable(
  "user_setting",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value", { mode: "json" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [uniqueIndex("user_setting_uq").on(t.userId, t.key)],
);

export const extensionPairing = sqliteTable("extension_pairing", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
  version: text("version"),
});

/** Per-person rows start nullable so pre-accounts data can be claimed by the first account. */
const ownerId = () => integer("user_id").references(() => user.id, { onDelete: "cascade" });

export const profile = sqliteTable("profile", {
  id: integer("id").primaryKey(),
  userId: ownerId().unique(),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  location: text("location"),
  links: text("links", { mode: "json" }).$type<{ linkedin?: string; github?: string; site?: string }>(),
  /** Onboarding "about you": goals, what you want next, anything the resume doesn't say. */
  about: text("about"),
  /** A cover letter or other writing of yours, used as a voice reference. */
  writingSample: text("writing_sample"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
});

export const company = sqliteTable(
  "company",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    domain: text("domain"),
    atsType: text("ats_type").$type<AtsType>().notNull(),
    atsSlug: text("ats_slug").notNull(),
    source: text("source").$type<"seed" | "discovered" | "manual">().notNull(),
    watch: integer("watch", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastCrawledAt: integer("last_crawled_at", { mode: "timestamp_ms" }),
    crawlStatus: text("crawl_status").$type<"ok" | "not_found" | "error">(),
    crawlError: text("crawl_error"),
    openJobCount: integer("open_job_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("company_ats_uq").on(t.atsType, t.atsSlug)],
);

export const job = sqliteTable(
  "job",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    atsType: text("ats_type").$type<AtsType>().notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    applyUrl: text("apply_url").notNull(),
    title: text("title").notNull(),
    titleNormalized: text("title_normalized").notNull(),
    department: text("department"),
    locations: text("locations", { mode: "json" }).$type<string[]>().notNull(),
    locationType: text("location_type").$type<LocationType>().notNull(),
    remoteCountries: text("remote_countries", { mode: "json" }).$type<string[]>().notNull(),
    comp: text("comp", { mode: "json" }).$type<Comp>(),
    descriptionHtml: text("description_html").notNull(),
    descriptionText: text("description_text").notNull(),
    postedAt: integer("posted_at", { mode: "timestamp_ms" }),
    /** Set by boards whose list endpoint omits the description; cleared once hydrated. */
    needsDetail: integer("needs_detail", { mode: "boolean" }).notNull().default(false),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull().default(now),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull().default(now),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
    contentHash: text("content_hash").notNull(),
  },
  (t) => [
    uniqueIndex("job_ext_uq").on(t.atsType, t.companyId, t.externalId),
    index("job_open_idx").on(t.closedAt, t.postedAt),
  ],
);

export const savedSearch = sqliteTable("saved_search", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: ownerId(),
  /** Dashboard title; falls back to rawQuery. */
  name: text("name"),
  rawQuery: text("raw_query").notNull(),
  filter: text("filter", { mode: "json" }).$type<SearchFilter>().notNull(),
  parsedBy: text("parsed_by").$type<"llm" | "rules">().notNull(),
  /** Include this dashboard's section in the daily email. */
  notify: integer("notify", { mode: "boolean" }).notNull().default(false),
  /** Per-dashboard fit threshold for the email; null uses the person's default. */
  digestMinFit: integer("digest_min_fit"),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
  /** New-match counts in the switcher are "first seen since you last opened it". */
  lastViewedAt: integer("last_viewed_at", { mode: "timestamp_ms" }),
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export const jobMatch = sqliteTable(
  "job_match",
  {
    jobId: integer("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    searchId: integer("search_id")
      .notNull()
      .references(() => savedSearch.id, { onDelete: "cascade" }),
    rulePass: integer("rule_pass", { mode: "boolean" }).notNull(),
    matchedAt: integer("matched_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [uniqueIndex("job_match_uq").on(t.jobId, t.searchId)],
);

export const crawlRun = sqliteTable("crawl_run", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trigger: text("trigger").$type<"search" | "manual" | "schedule">().notNull(),
  status: text("status").$type<"running" | "done" | "failed">().notNull(),
  total: integer("total").notNull().default(0),
  done: integer("done").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  jobsUpserted: integer("jobs_upserted").notNull().default(0),
  jobsClosed: integer("jobs_closed").notNull().default(0),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().default(now),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  error: text("error"),
});

export const llmUsage = sqliteTable("llm_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Who the call was for; null for shared work such as company research started by the system. */
  userId: integer("user_id").references(() => user.id, { onDelete: "set null" }),
  ts: integer("ts", { mode: "timestamp_ms" }).notNull().default(now),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull(),
});

/* ---------- M2 ---------- */

export const resume = sqliteTable("resume", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: ownerId(),
  kind: text("kind").$type<"master" | "tailored">().notNull(),
  baseResumeId: integer("base_resume_id"),
  jobId: integer("job_id").references(() => job.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  parsedText: text("parsed_text").notNull(),
  source: text("source", { mode: "json" }).$type<ResumeSource>(),
  /** Hash of `source` (or parsedText when unparsed); fit scores are keyed by it. */
  sourceHash: text("source_hash").notNull(),
  parseStatus: text("parse_status").$type<"pending" | "done" | "failed" | "skipped">().notNull(),
  parseError: text("parse_error"),
  /** Tailored resumes only: what changed vs. the master, and anything the truthfulness check flagged. */
  changeLog: text("change_log", { mode: "json" }).$type<ResumeChange[]>(),
  truthWarnings: text("truth_warnings", { mode: "json" }).$type<string[]>(),
  status: text("status").$type<"draft" | "approved">().notNull().default("approved"),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
});

export const companyProfile = sqliteTable("company_profile", {
  companyId: integer("company_id")
    .primaryKey()
    .references(() => company.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" }).$type<CompanyProfile>().notNull(),
  /** URLs Claude actually searched/fetched during research. */
  consultedUrls: text("consulted_urls", { mode: "json" }).$type<string[]>().notNull(),
  model: text("model").notNull(),
  enrichedAt: integer("enriched_at", { mode: "timestamp_ms" }).notNull().default(now),
});

export const jobAnalysis = sqliteTable("job_analysis", {
  jobId: integer("job_id")
    .primaryKey()
    .references(() => job.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" }).$type<JobAnalysis>().notNull(),
  contentHash: text("content_hash").notNull(),
  model: text("model").notNull(),
  analyzedAt: integer("analyzed_at", { mode: "timestamp_ms" }).notNull().default(now),
});

export const jobFit = sqliteTable(
  "job_fit",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    resumeHash: text("resume_hash").notNull(),
    score: integer("score").notNull(),
    data: text("data", { mode: "json" }).$type<FitResult>().notNull(),
    model: text("model").notNull(),
    scoredAt: integer("scored_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [uniqueIndex("job_fit_uq").on(t.jobId, t.resumeHash)],
);

export const application = sqliteTable(
  "application",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: ownerId(),
    /** The dashboard this application is tracked in. */
    searchId: integer("search_id").references(() => savedSearch.id, { onDelete: "set null" }),
    /** Null for applications found in email that don't match a job we know; see companyName/jobTitle. */
    jobId: integer("job_id").references(() => job.id, { onDelete: "cascade" }),
    /** Used when jobId is null. */
    companyName: text("company_name"),
    jobTitle: text("job_title"),
    jobUrl: text("job_url"),
    source: text("source").$type<ApplicationSource>().notNull().default("app"),
    /** When an application-received email arrived. */
    confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
    status: text("status").$type<ApplicationStatus>().notNull(),
    notes: text("notes"),
    resumeId: integer("resume_id").references(() => resume.id, { onDelete: "set null" }),
    coverLetterChoice: text("cover_letter_choice").$type<"yes" | "no">(),
    coverLetter: text("cover_letter"),
    /** Numbers or claims in the generated letter that couldn't be matched to the resume or posting. */
    coverLetterWarnings: text("cover_letter_warnings", { mode: "json" }).$type<string[]>(),
    answers: text("answers", { mode: "json" }),
    appliedAt: integer("applied_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [uniqueIndex("application_user_job_uq").on(t.userId, t.jobId)],
);

/** Status history: undo, "moved by an email from …", and the rule that a manual move wins. */
export const applicationEvent = sqliteTable(
  "application_event",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    fromStatus: text("from_status").$type<ApplicationStatus>(),
    toStatus: text("to_status").$type<ApplicationStatus>().notNull(),
    source: text("source").$type<StatusEventSource>().notNull(),
    emailId: integer("email_id").references((): AnySQLiteColumn => emailMessage.id, { onDelete: "set null" }),
    revertedAt: integer("reverted_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("application_event_app_idx").on(t.applicationId)],
);

/* ---------- Mailbox sync ---------- */

export type MailProvider = "gmail" | "imap";
export type MailboxStatus = "active" | "needs_reauth" | "paused" | "error";
export interface MailCursor {
  /** Gmail: mail up to this time (ms) has been listed; the next check searches after it, with an overlap. */
  checkedUntil?: number;
  /** IMAP: per folder. A UIDVALIDITY change means the folder was rebuilt, so it's read again. */
  folders?: Record<string, { uidValidity: string; lastUid: number }>;
}

/** A person's mailbox, connected read-only. The secret is encrypted with SECRET_KEY. */
export const mailboxConnection = sqliteTable(
  "mailbox_connection",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").$type<MailProvider>().notNull(),
    address: text("address").notNull(),
    status: text("status").$type<MailboxStatus>().notNull().default("active"),
    /** Encrypted: a Gmail refresh token or an IMAP app password. Never sent to the browser. */
    secret: text("secret").notNull(),
    imapHost: text("imap_host"),
    imapPort: integer("imap_port"),
    cursor: text("cursor", { mode: "json" }).$type<MailCursor>().notNull().default({}),
    backfillDays: integer("backfill_days").notNull().default(90),
    backfillDone: integer("backfill_done", { mode: "boolean" }).notNull().default(false),
    /** Progress of the current run, for the Mailbox page. */
    progress: text("progress", { mode: "json" }).$type<{ done: number; total: number } | null>(),
    lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mailbox_user_address_uq").on(t.userId, t.address)],
);

/**
 * Job-related emails only: headers, a short snippet and what they mean. Bodies are never
 * stored. Unrelated emails keep only their ids (kind 'unrelated') so they aren't read twice.
 */
export const emailMessage = sqliteTable(
  "email_message",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => mailboxConnection.id, { onDelete: "cascade" }),
    /** Gmail message id, or "<folder>:<uidValidity>:<uid>" for IMAP. */
    providerId: text("provider_id").notNull(),
    rfcMessageId: text("rfc_message_id"),
    threadId: text("thread_id"),
    webLink: text("web_link"),
    fromName: text("from_name"),
    fromAddress: text("from_address"),
    subject: text("subject"),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
    snippet: text("snippet"),
    kind: text("kind").$type<EmailKind>().notNull(),
    round: text("round").$type<InterviewRound>(),
    roundLabel: text("round_label"),
    eventAt: integer("event_at", { mode: "timestamp_ms" }),
    companyName: text("company_name"),
    jobTitle: text("job_title"),
    summary: text("summary"),
    confidence: real("confidence"),
    classifiedBy: text("classified_by").$type<"llm" | "rules">(),
    applicationId: integer("application_id").references(() => application.id, { onDelete: "set null" }),
    actionNeeded: integer("action_needed", { mode: "boolean" }).notNull().default(false),
    actionType: text("action_type").$type<ActionType>(),
    actionText: text("action_text"),
    actionDueAt: integer("action_due_at", { mode: "timestamp_ms" }),
    actionDoneAt: integer("action_done_at", { mode: "timestamp_ms" }),
    reviewState: text("review_state").$type<ReviewState>().notNull().default("auto"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("email_conn_provider_uq").on(t.connectionId, t.providerId),
    index("email_user_app_idx").on(t.userId, t.applicationId),
    index("email_thread_idx").on(t.userId, t.threadId),
  ],
);

export type TaskKind =
  | "parse_resume"
  | "research_company"
  | "analyze_job"
  | "score_fit"
  | "cover_letter"
  | "tailor_resume"
  | "discover_companies"
  | "sync_mailbox";

export const task = sqliteTable(
  "task",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").$type<TaskKind>().notNull(),
    /** Dedupe key, e.g. "company:12". Only one queued/running task per (kind, key). */
    key: text("key").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<"queued" | "running" | "done" | "failed">().notNull(),
    priority: integer("priority").notNull().default(0),
    background: integer("background", { mode: "boolean" }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    runAfter: integer("run_after", { mode: "timestamp_ms" }).notNull().default(now),
    error: text("error"),
    createdAt: createdAt(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("task_claim_idx").on(t.status, t.kind, t.priority), index("task_key_idx").on(t.kind, t.key)],
);

/* ---------- M3 ---------- */

export type AnswerCategory = "work_auth" | "sponsorship" | "relocation" | "salary" | "eeo" | "logistics" | "custom";

export const answerBank = sqliteTable("answer_bank", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: ownerId(),
  category: text("category").$type<AnswerCategory>().notNull(),
  /** Canonical wording shown in the Answers page. */
  question: text("question").notNull(),
  /** Normalized wordings this answer has matched on real forms. */
  variants: text("variants", { mode: "json" }).$type<string[]>().notNull(),
  answer: text("answer").notNull(),
  /** job: answer applies only to jobId (e.g. salary for one role). */
  scope: text("scope").$type<"global" | "job">().notNull().default("global"),
  jobId: integer("job_id").references(() => job.id, { onDelete: "cascade" }),
  useCount: integer("use_count").notNull().default(0),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
});

export const questionInbox = sqliteTable(
  "question_inbox",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: ownerId(),
    normalized: text("normalized").notNull(),
    question: text("question").notNull(),
    kind: text("kind").notNull(),
    options: text("options", { mode: "json" }).$type<string[]>().notNull(),
    category: text("category").$type<AnswerCategory>().notNull(),
    seenCount: integer("seen_count").notNull().default(1),
    firstJobId: integer("first_job_id").references(() => job.id, { onDelete: "set null" }),
    lastJobId: integer("last_job_id").references(() => job.id, { onDelete: "set null" }),
    suggestedAnswer: text("suggested_answer"),
    status: text("status").$type<"pending" | "answered" | "ignored">().notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [uniqueIndex("question_inbox_user_norm_uq").on(t.userId, t.normalized)],
);

export const digestRun = sqliteTable("digest_run", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: ownerId(),
  status: text("status").$type<"sent" | "skipped" | "failed">().notNull(),
  jobIds: text("job_ids", { mode: "json" }).$type<number[]>().notNull(),
  to: text("to"),
  method: text("method"),
  error: text("error"),
  /** Jobs first seen after this point go in the next digest. */
  coveredUntil: integer("covered_until", { mode: "timestamp_ms" }).notNull(),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull().default(now),
});

/** One run of "find me more companies": the prompt, the candidates, and what happened to each. */
export const discoveryRun = sqliteTable("discovery_run", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  prompt: text("prompt").notNull(),
  searchId: integer("search_id").references(() => savedSearch.id, { onDelete: "set null" }),
  trigger: text("trigger").$type<"manual" | "schedule">().notNull(),
  startedBy: integer("started_by").references(() => user.id, { onDelete: "set null" }),
  status: text("status").$type<"running" | "done" | "failed">().notNull(),
  candidates: text("candidates", { mode: "json" }).$type<DiscoveryCandidate[]>().notNull(),
  added: integer("added").notNull().default(0),
  error: text("error"),
  createdAt: createdAt(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});
