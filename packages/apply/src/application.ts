import type { ApplicationStatus, StatusEventSource } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import { currentMasterResume, enqueueCoverLetter, enqueueTailorResume, tailoredResumeFor, tailorKey, taskStatus } from "@jd/research";
import { and, desc, eq, isNull } from "drizzle-orm";

export type Application = typeof schema.application.$inferSelect;
export type ApplicationEvent = typeof schema.applicationEvent.$inferSelect;

/** Pipeline order. Rejected and withdrawn end an application at any stage. */
export const STAGE_RANK: Record<ApplicationStatus, number> = {
  saved: 0,
  applying: 1,
  applied: 2,
  interview: 3,
  offer: 4,
  rejected: 5,
  withdrawn: 5,
};

/**
 * The one way an application's status changes: sets appliedAt the first time it reaches
 * Applied and records the move, so it can be undone and shown ("moved by an email from …").
 */
export function setStatus(
  applicationId: number,
  to: ApplicationStatus,
  opts: { source: StatusEventSource; emailId?: number | null; appliedAt?: Date | null },
): Application {
  const db = getDb();
  return db.transaction((tx) => {
    const app = tx.select().from(schema.application).where(eq(schema.application.id, applicationId)).get();
    if (!app) throw new Error(`Application ${applicationId} not found`);
    if (app.status === to) return app;
    const appliedAt = app.appliedAt ?? (to === "applied" ? (opts.appliedAt ?? new Date()) : (opts.appliedAt ?? null));
    const updated = tx
      .update(schema.application)
      .set({ status: to, appliedAt, updatedAt: new Date() })
      .where(eq(schema.application.id, applicationId))
      .returning()
      .get();
    tx.insert(schema.applicationEvent)
      .values({ applicationId, fromStatus: app.status, toStatus: to, source: opts.source, emailId: opts.emailId ?? null })
      .run();
    return updated;
  });
}

/** Records that an application was created (fromStatus null), e.g. from an email. */
export function recordCreated(applicationId: number, status: ApplicationStatus, source: StatusEventSource, emailId: number | null = null): void {
  getDb().insert(schema.applicationEvent).values({ applicationId, fromStatus: null, toStatus: status, source, emailId }).run();
}

/**
 * When the person last moved this card themselves. Applications from before status history
 * existed fall back to their last update, so an older email never overrides a recent manual move.
 */
export function lastManualMoveAt(applicationId: number): Date | null {
  const db = getDb();
  const events = db
    .select({ source: schema.applicationEvent.source, fromStatus: schema.applicationEvent.fromStatus, createdAt: schema.applicationEvent.createdAt })
    .from(schema.applicationEvent)
    .where(and(eq(schema.applicationEvent.applicationId, applicationId), isNull(schema.applicationEvent.revertedAt)))
    .orderBy(desc(schema.applicationEvent.id))
    .all();
  // Adding a card isn't a move: an older confirmation should still mark a just-saved job as applied.
  const manual = events.find((e) => e.source === "manual" && e.fromStatus !== null);
  if (manual) return manual.createdAt;
  if (events.length) return null;
  return db.select({ at: schema.application.updatedAt }).from(schema.application).where(eq(schema.application.id, applicationId)).get()?.at ?? null;
}

export function applicationEvents(applicationId: number): ApplicationEvent[] {
  return getDb()
    .select()
    .from(schema.applicationEvent)
    .where(eq(schema.applicationEvent.applicationId, applicationId))
    .orderBy(desc(schema.applicationEvent.id))
    .all();
}

/**
 * Undoes an automatic move. A move back only happens if nothing has moved the card since; an
 * application that an email created is removed again, and its emails are set aside.
 */
export function undoEvent(userId: number, eventId: number): { ok: boolean; removed?: boolean; reason?: string } {
  const db = getDb();
  const row = db
    .select({ event: schema.applicationEvent, app: schema.application })
    .from(schema.applicationEvent)
    .innerJoin(schema.application, eq(schema.application.id, schema.applicationEvent.applicationId))
    .where(and(eq(schema.applicationEvent.id, eventId), eq(schema.application.userId, userId)))
    .get();
  if (!row || row.event.revertedAt) return { ok: false, reason: "Nothing to undo." };
  const { event, app } = row;
  if (event.fromStatus === null) {
    db.transaction((tx) => {
      tx.update(schema.emailMessage)
        .set({ reviewState: "dismissed", applicationId: null })
        .where(eq(schema.emailMessage.applicationId, app.id))
        .run();
      tx.delete(schema.application).where(eq(schema.application.id, app.id)).run();
    });
    return { ok: true, removed: true };
  }
  if (app.status !== event.toStatus) return { ok: false, reason: "The card has moved since, so this can't be undone." };
  db.transaction((tx) => {
    tx.update(schema.application).set({ status: event.fromStatus!, updatedAt: new Date() }).where(eq(schema.application.id, app.id)).run();
    tx.update(schema.applicationEvent).set({ revertedAt: new Date() }).where(eq(schema.applicationEvent.id, event.id)).run();
    // The email stays, but it no longer counts as having decided this card.
    if (event.emailId) tx.update(schema.emailMessage).set({ reviewState: "confirmed" }).where(eq(schema.emailMessage.id, event.emailId)).run();
  });
  return { ok: true };
}

export interface FormInfo {
  /** true/false when the job board tells us; null when unknown (Lever, Ashby). */
  coverLetterRequired: boolean | null;
  hasCoverLetterField: boolean | null;
  questionCount: number | null;
}

/** Greenhouse publishes the application form; the other boards don't without an employer key. */
export async function fetchFormInfo(jobId: number): Promise<FormInfo> {
  const row = getDb()
    .select({ atsType: schema.job.atsType, externalId: schema.job.externalId, slug: schema.company.atsSlug })
    .from(schema.job)
    .innerJoin(schema.company, eq(schema.company.id, schema.job.companyId))
    .where(eq(schema.job.id, jobId))
    .get();
  if (!row || row.atsType !== "greenhouse") return { coverLetterRequired: null, hasCoverLetterField: null, questionCount: null };
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${row.slug}/jobs/${row.externalId}?questions=true`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { coverLetterRequired: null, hasCoverLetterField: null, questionCount: null };
    const body = (await res.json()) as { questions?: { label: string; required: boolean; fields: { name: string }[] }[] };
    const qs = body.questions ?? [];
    const cl = qs.find((q) => q.fields.some((f) => f.name.startsWith("cover_letter")));
    return { coverLetterRequired: cl ? cl.required : false, hasCoverLetterField: Boolean(cl), questionCount: qs.length };
  } catch {
    return { coverLetterRequired: null, hasCoverLetterField: null, questionCount: null };
  }
}

export function getApplicationByJob(userId: number, jobId: number): Application | null {
  return (
    getDb()
      .select()
      .from(schema.application)
      .where(and(eq(schema.application.userId, userId), eq(schema.application.jobId, jobId)))
      .get() ?? null
  );
}

/** An application only if it belongs to this person. */
export function getApplication(userId: number, id: number): Application | null {
  return (
    getDb()
      .select()
      .from(schema.application)
      .where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
      .get() ?? null
  );
}

/**
 * Called from the Apply dialog. Records your choices, moves the job to "Applying",
 * and queues a cover letter if you asked for one.
 */
export function prepareApplication(
  userId: number,
  jobId: number,
  opts: { coverLetter: "yes" | "no"; resume?: "master" | "tailored"; regenerate?: boolean; searchId?: number | null },
): Application {
  const db = getDb();
  const tailored = opts.resume === "tailored" ? tailoredResumeFor(userId, jobId) : null;
  const resume = tailored ?? currentMasterResume(userId);
  const existing = getApplicationByJob(userId, jobId);
  const values = { resumeId: resume?.id ?? null, coverLetterChoice: opts.coverLetter, updatedAt: new Date() } as const;
  let app = existing
    ? db.update(schema.application).set(values).where(eq(schema.application.id, existing.id)).returning().get()
    : db
        .insert(schema.application)
        .values({ userId, jobId, searchId: opts.searchId ?? null, status: "applying", source: "app", ...values })
        .returning()
        .get();
  if (!existing) recordCreated(app.id, "applying", "manual");
  else if (existing.status === "saved") app = setStatus(app.id, "applying", { source: "manual" });
  // Keep the dashboard it was first tracked in; only fill it if it was never set.
  if (!app.searchId && opts.searchId) {
    db.update(schema.application).set({ searchId: opts.searchId }).where(eq(schema.application.id, app.id)).run();
  }
  if (opts.coverLetter === "yes" && (!app.coverLetter || opts.regenerate)) enqueueCoverLetter(userId, app.id);
  return app;
}

export function coverLetterStatus(applicationId: number) {
  return taskStatus("cover_letter", `application:${applicationId}`);
}

export function tailorStatus(userId: number, jobId: number) {
  return taskStatus("tailor_resume", tailorKey(userId, jobId));
}

export function startTailoring(userId: number, jobId: number) {
  return enqueueTailorResume(userId, jobId);
}

export function updateCoverLetter(userId: number, applicationId: number, text: string): void {
  // Your edits are yours: clear the automatic warnings.
  getDb()
    .update(schema.application)
    .set({ coverLetter: text, coverLetterWarnings: [], updatedAt: new Date() })
    .where(and(eq(schema.application.id, applicationId), eq(schema.application.userId, userId)))
    .run();
}

export function markSubmitted(userId: number, applicationId: number, answers: unknown): Application | null {
  const db = getDb();
  const app = getApplication(userId, applicationId);
  if (!app) return null;
  db.update(schema.application).set({ answers, source: app.source === "app" ? "extension" : app.source }).where(eq(schema.application.id, applicationId)).run();
  // An email may already have moved it further along (confirmation, interview); never move it back.
  if (STAGE_RANK[app.status] >= STAGE_RANK.applied) return getApplication(userId, applicationId);
  return setStatus(applicationId, "applied", { source: "extension" });
}
