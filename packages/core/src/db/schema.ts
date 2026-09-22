import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { ActionType, ApplicationSource, EmailKind, InterviewRound, ReviewState, StatusEventSource } from "../mail-types";
import type { ApplicationStatus, CompanyProfile, FitResult, JobAnalysis, ResumeChange, ResumeSource } from "../research-types";
import type { AtsType, Comp, DiscoveryCandidate, LocationType, SearchFilter } from "../types";

/** Every time is a timestamptz, read back as a Date. */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();

/* ---------- Accounts ---------- */

export type UserRole = "admin" | "member";
export const ONBOARDING_STEPS = ["search", "resume", "about", "answers", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const user = pgTable("user", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  /** Stored lowercased. */
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<UserRole>().notNull().default("member"),
  disabled: boolean("disabled").notNull().default(false),
  /** IANA zone from the browser at sign-up; the digest send time is in this zone. */
  timezone: text("timezone").notNull().default("UTC"),
  /** The onboarding step to resume at; null once onboarding is finished. */
  onboardingStep: text("onboarding_step").$type<OnboardingStep>().default("search"),
  lastSearchId: integer("last_search_id"),
  createdAt: createdAt(),
  lastSeenAt: ts("last_seen_at"),
});

export const session = pgTable(
  "session",
  {
    /** SHA-256 of the cookie token; the token itself is never stored. */
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const invite = pgTable("invite", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  tokenHash: text("token_hash").notNull().unique(),
  /** Optional: when set, only this address can accept it. */
  email: text("email"),
  role: text("role").$type<UserRole>().notNull().default("member"),
  createdBy: integer("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  usedBy: integer("used_by").references(() => user.id, { onDelete: "set null" }),
});

/** Per-person settings (search defaults, digest delivery). System settings stay in `settings`. */
export const userSetting = pgTable(
  "user_setting",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_setting_uq").on(t.userId, t.key)],
);

export const extensionPairing = pgTable("extension_pairing", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  lastSeenAt: ts("last_seen_at"),
  version: text("version"),
});

/** Per-person rows start nullable so pre-accounts data can be claimed by the first account. */
const ownerId = () => integer("user_id").references(() => user.id, { onDelete: "cascade" });

export const profile = pgTable("profile", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  userId: ownerId().unique(),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  location: text("location"),
  links: jsonb("links").$type<{ linkedin?: string; github?: string; site?: string }>(),
  /** Onboarding "about you": goals, what you want next, anything the resume doesn't say. */
  about: text("about"),
  /** A cover letter or other writing of yours, used as a voice reference. */
  writingSample: text("writing_sample"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const company = pgTable(
  "company",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    name: text("name").notNull(),
    domain: text("domain"),
    atsType: text("ats_type").$type<AtsType>().notNull(),
    atsSlug: text("ats_slug").notNull(),
    source: text("source").$type<"seed" | "discovered" | "manual">().notNull(),
    watch: boolean("watch").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    lastCrawledAt: ts("last_crawled_at"),
    crawlStatus: text("crawl_status").$type<"ok" | "not_found" | "error">(),
    crawlError: text("crawl_error"),
    openJobCount: integer("open_job_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("company_ats_uq").on(t.atsType, t.atsSlug)],
);

export const job = pgTable(
  "job",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
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
    locations: jsonb("locations").$type<string[]>().notNull(),
    locationType: text("location_type").$type<LocationType>().notNull(),
    remoteCountries: jsonb("remote_countries").$type<string[]>().notNull(),
    comp: jsonb("comp").$type<Comp>(),
    descriptionHtml: text("description_html").notNull(),
    descriptionText: text("description_text").notNull(),
    postedAt: ts("posted_at"),
    /** Set by boards whose list endpoint omits the description; cleared once hydrated. */
    needsDetail: boolean("needs_detail").notNull().default(false),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    closedAt: ts("closed_at"),
    contentHash: text("content_hash").notNull(),
  },
  (t) => [
    uniqueIndex("job_ext_uq").on(t.atsType, t.companyId, t.externalId),
    index("job_open_idx").on(t.closedAt, t.postedAt),
  ],
);

export const savedSearch = pgTable("saved_search", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  userId: ownerId(),
  /** Dashboard title; falls back to rawQuery. */
  name: text("name"),
  rawQuery: text("raw_query").notNull(),
  filter: jsonb("filter").$type<SearchFilter>().notNull(),
  parsedBy: text("parsed_by").$type<"llm" | "rules">().notNull(),
  /** Include this dashboard's section in the daily email. */
  notify: boolean("notify").notNull().default(false),
  /** Per-dashboard fit threshold for the email; null uses the person's default. */
  digestMinFit: integer("digest_min_fit"),
  lastRunAt: ts("last_run_at"),
  /** New-match counts in the switcher are "first seen since you last opened it". */
  lastViewedAt: ts("last_viewed_at"),
  archivedAt: ts("archived_at"),
  createdAt: createdAt(),
});

export const jobMatch = pgTable(
  "job_match",
  {
    jobId: integer("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    searchId: integer("search_id")
      .notNull()
      .references(() => savedSearch.id, { onDelete: "cascade" }),
    rulePass: boolean("rule_pass").notNull(),
    matchedAt: ts("matched_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("job_match_uq").on(t.jobId, t.searchId)],
);

export const crawlRun = pgTable("crawl_run", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  trigger: text("trigger").$type<"search" | "manual" | "schedule">().notNull(),
  status: text("status").$type<"running" | "done" | "failed">().notNull(),
  total: integer("total").notNull().default(0),
  done: integer("done").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  jobsUpserted: integer("jobs_upserted").notNull().default(0),
  jobsClosed: integer("jobs_closed").notNull().default(0),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  error: text("error"),
});

export const llmUsage = pgTable("llm_usage", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  /** Who the call was for; null for shared work such as company research started by the system. */
  userId: integer("user_id").references(() => user.id, { onDelete: "set null" }),
  ts: ts("ts").notNull().defaultNow(),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  costUsd: doublePrecision("cost_usd").notNull(),
});

/* ---------- M2 ---------- */

export const resume = pgTable("resume", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  userId: ownerId(),
  kind: text("kind").$type<"master" | "tailored">().notNull(),
  baseResumeId: integer("base_resume_id"),
  jobId: integer("job_id").references(() => job.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  /** A key in the file store (storage.ts), e.g. "resumes/3/<uuid>.pdf". */
  filePath: text("file_path").notNull(),
  parsedText: text("parsed_text").notNull(),
  source: jsonb("source").$type<ResumeSource>(),
  /** Hash of `source` (or parsedText when unparsed); fit scores are keyed by it. */
  sourceHash: text("source_hash").notNull(),
  parseStatus: text("parse_status").$type<"pending" | "done" | "failed" | "skipped">().notNull(),
  parseError: text("parse_error"),
  /** Tailored resumes only: what changed vs. the master, and anything the truthfulness check flagged. */
  changeLog: jsonb("change_log").$type<ResumeChange[]>(),
  truthWarnings: jsonb("truth_warnings").$type<string[]>(),
  status: text("status").$type<"draft" | "approved">().notNull().default("approved"),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const companyProfile = pgTable("company_profile", {
  companyId: integer("company_id")
    .primaryKey()
    .references(() => company.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<CompanyProfile>().notNull(),
  /** URLs Claude actually searched/fetched during research. */
  consultedUrls: jsonb("consulted_urls").$type<string[]>().notNull(),
  model: text("model").notNull(),
  enrichedAt: ts("enriched_at").notNull().defaultNow(),
});

export const jobAnalysis = pgTable("job_analysis", {
  jobId: integer("job_id")
    .primaryKey()
    .references(() => job.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<JobAnalysis>().notNull(),
  contentHash: text("content_hash").notNull(),
  model: text("model").notNull(),
  analyzedAt: ts("analyzed_at").notNull().defaultNow(),
});

export const jobFit = pgTable(
  "job_fit",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    jobId: integer("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    resumeHash: text("resume_hash").notNull(),
    score: integer("score").notNull(),
    data: jsonb("data").$type<FitResult>().notNull(),
    model: text("model").notNull(),
    scoredAt: ts("scored_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("job_fit_uq").on(t.jobId, t.resumeHash)],
);

export const application = pgTable(
  "application",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
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
    confirmedAt: ts("confirmed_at"),
    status: text("status").$type<ApplicationStatus>().notNull(),
    notes: text("notes"),
    resumeId: integer("resume_id").references(() => resume.id, { onDelete: "set null" }),
    coverLetterChoice: text("cover_letter_choice").$type<"yes" | "no">(),
    coverLetter: text("cover_letter"),
    /** Numbers or claims in the generated letter that couldn't be matched to the resume or posting. */
    coverLetterWarnings: jsonb("cover_letter_warnings").$type<string[]>(),
    answers: jsonb("answers"),
    appliedAt: ts("applied_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("application_user_job_uq").on(t.userId, t.jobId)],
);

/** Status history: undo, "moved by an email from …", and the rule that a manual move wins. */
export const applicationEvent = pgTable(
  "application_event",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    fromStatus: text("from_status").$type<ApplicationStatus>(),
    toStatus: text("to_status").$type<ApplicationStatus>().notNull(),
    source: text("source").$type<StatusEventSource>().notNull(),
    emailId: integer("email_id").references((): AnyPgColumn => emailMessage.id, { onDelete: "set null" }),
    /** This move filled the applied / confirmed date (dates are only ever filled from empty), so undo clears it. */
    filledAppliedAt: boolean("filled_applied_at").notNull().default(false),
    filledConfirmedAt: boolean("filled_confirmed_at").notNull().default(false),
    revertedAt: ts("reverted_at"),
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
export const mailboxConnection = pgTable(
  "mailbox_connection",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
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
    cursor: jsonb("cursor").$type<MailCursor>().notNull().default({}),
    backfillDays: integer("backfill_days").notNull().default(90),
    backfillDone: boolean("backfill_done").notNull().default(false),
    /** Progress of the current run, for the Mailbox page. */
    progress: jsonb("progress").$type<{ done: number; total: number } | null>(),
    lastSyncAt: ts("last_sync_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mailbox_user_address_uq").on(t.userId, t.address)],
);

/**
 * Job-related emails only: headers, a short snippet and what they mean. Bodies are never
 * stored. Unrelated emails keep only their ids (kind 'unrelated') so they aren't read twice.
 */
export const emailMessage = pgTable(
  "email_message",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
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
    receivedAt: ts("received_at").notNull(),
    snippet: text("snippet"),
    kind: text("kind").$type<EmailKind>().notNull(),
    round: text("round").$type<InterviewRound>(),
    roundLabel: text("round_label"),
    eventAt: ts("event_at"),
    companyName: text("company_name"),
    jobTitle: text("job_title"),
    summary: text("summary"),
    confidence: doublePrecision("confidence"),
    classifiedBy: text("classified_by").$type<"llm" | "rules">(),
    applicationId: integer("application_id").references(() => application.id, { onDelete: "set null" }),
    actionNeeded: boolean("action_needed").notNull().default(false),
    actionType: text("action_type").$type<ActionType>(),
    actionText: text("action_text"),
    actionDueAt: ts("action_due_at"),
    actionDoneAt: ts("action_done_at"),
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

export const task = pgTable(
  "task",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    kind: text("kind").$type<TaskKind>().notNull(),
    /** Dedupe key, e.g. "company:12". Only one queued/running task per (kind, key). */
    key: text("key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<"queued" | "running" | "done" | "failed">().notNull(),
    priority: integer("priority").notNull().default(0),
    background: boolean("background").notNull(),
    attempts: integer("attempts").notNull().default(0),
    runAfter: ts("run_after").notNull().defaultNow(),
    error: text("error"),
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    index("task_claim_idx").on(t.status, t.kind, t.priority),
    index("task_key_idx").on(t.kind, t.key),
    // One live task per (kind, key). Finished tasks keep their keys, so it covers only queued and
    // running ones; enqueueTask relies on it when two callers race to add the same work.
    uniqueIndex("task_live_key_uq").on(t.kind, t.key).where(sql`${t.status} in ('queued', 'running')`),
  ],
);

/* ---------- M3 ---------- */

export type AnswerCategory = "work_auth" | "sponsorship" | "relocation" | "salary" | "eeo" | "logistics" | "custom";

export const answerBank = pgTable("answer_bank", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  userId: ownerId(),
  category: text("category").$type<AnswerCategory>().notNull(),
  /** Canonical wording shown in the Answers page. */
  question: text("question").notNull(),
  /** Normalized wordings this answer has matched on real forms. */
  variants: jsonb("variants").$type<string[]>().notNull(),
  answer: text("answer").notNull(),
  /** job: answer applies only to jobId (e.g. salary for one role). */
  scope: text("scope").$type<"global" | "job">().notNull().default("global"),
  jobId: integer("job_id").references(() => job.id, { onDelete: "cascade" }),
  useCount: integer("use_count").notNull().default(0),
  lastUsedAt: ts("last_used_at"),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const questionInbox = pgTable(
  "question_inbox",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: ownerId(),
    normalized: text("normalized").notNull(),
    question: text("question").notNull(),
    kind: text("kind").notNull(),
    options: jsonb("options").$type<string[]>().notNull(),
    category: text("category").$type<AnswerCategory>().notNull(),
    seenCount: integer("seen_count").notNull().default(1),
    firstJobId: integer("first_job_id").references(() => job.id, { onDelete: "set null" }),
    lastJobId: integer("last_job_id").references(() => job.id, { onDelete: "set null" }),
    suggestedAnswer: text("suggested_answer"),
    status: text("status").$type<"pending" | "answered" | "ignored">().notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("question_inbox_user_norm_uq").on(t.userId, t.normalized)],
);

export const digestRun = pgTable("digest_run", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  userId: ownerId(),
  status: text("status").$type<"sent" | "skipped" | "failed">().notNull(),
  jobIds: jsonb("job_ids").$type<number[]>().notNull(),
  to: text("to"),
  method: text("method"),
  error: text("error"),
  /** Jobs first seen after this point go in the next digest. */
  coveredUntil: ts("covered_until").notNull(),
  sentAt: ts("sent_at").notNull().defaultNow(),
});

/** One run of "find me more companies": the prompt, the candidates, and what happened to each. */
export const discoveryRun = pgTable("discovery_run", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  prompt: text("prompt").notNull(),
  searchId: integer("search_id").references(() => savedSearch.id, { onDelete: "set null" }),
  trigger: text("trigger").$type<"manual" | "schedule">().notNull(),
  startedBy: integer("started_by").references(() => user.id, { onDelete: "set null" }),
  status: text("status").$type<"running" | "done" | "failed">().notNull(),
  candidates: jsonb("candidates").$type<DiscoveryCandidate[]>().notNull(),
  added: integer("added").notNull().default(0),
  error: text("error"),
  createdAt: createdAt(),
  finishedAt: ts("finished_at"),
});
