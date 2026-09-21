import type { ApplicationStatus, StatusEventSource } from "@jd/core";
import { getDb, one, returned, schema } from "@jd/core/db";
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
export async function setStatus(
  applicationId: number,
  to: ApplicationStatus,
  opts: { source: StatusEventSource; emailId?: number | null; appliedAt?: Date | null },
): Promise<Application> {
  const db = getDb();
  return await db.transaction(async (tx) => {
    const app = await one(tx.select().from(schema.application).where(eq(schema.application.id, applicationId)));
    if (!app) throw new Error(`Application ${applicationId} not found`);
    if (app.status === to) return app;
    const appliedAt = app.appliedAt ?? (to === "applied" ? (opts.appliedAt ?? new Date()) : (opts.appliedAt ?? null));
    const updated = await returned(
      tx
        .update(schema.application)
        .set({ status: to, appliedAt, updatedAt: new Date() })
        .where(eq(schema.application.id, applicationId))
        .returning(),
    );
    await tx
      .insert(schema.applicationEvent)
      .values({ applicationId, fromStatus: app.status, toStatus: to, source: opts.source, emailId: opts.emailId ?? null });
    return updated;
  });
}

/** Records that an application was created (fromStatus null), e.g. from an email. */
export async function recordCreated(applicationId: number, status: ApplicationStatus, source: StatusEventSource, emailId: number | null = null): Promise<void> {
  await getDb().insert(schema.applicationEvent).values({ applicationId, fromStatus: null, toStatus: status, source, emailId });
}

/**
 * When the person last moved this card themselves. Applications from before status history
 * existed fall back to their last update, so an older email never overrides a recent manual move.
 */
export async function lastManualMoveAt(applicationId: number): Promise<Date | null> {
  const db = getDb();
  const events = await db
    .select({ source: schema.applicationEvent.source, fromStatus: schema.applicationEvent.fromStatus, createdAt: schema.applicationEvent.createdAt })
    .from(schema.applicationEvent)
    .where(and(eq(schema.applicationEvent.applicationId, applicationId), isNull(schema.applicationEvent.revertedAt)))
    .orderBy(desc(schema.applicationEvent.id));
  // Adding a card isn't a move: an older confirmation should still mark a just-saved job as applied.
  const manual = events.find((e) => e.source === "manual" && e.fromStatus !== null);
  if (manual) return manual.createdAt;
  if (events.length) return null;
  return (await one(db.select({ at: schema.application.updatedAt }).from(schema.application).where(eq(schema.application.id, applicationId))))?.at ?? null;
}

export async function applicationEvents(applicationId: number): Promise<ApplicationEvent[]> {
  return await getDb()
    .select()
    .from(schema.applicationEvent)
    .where(eq(schema.applicationEvent.applicationId, applicationId))
    .orderBy(desc(schema.applicationEvent.id));
}

/**
 * Undoes an automatic move. A move back only happens if nothing has moved the card since; an
 * application that an email created is removed again, and its emails are set aside.
 */
export async function undoEvent(userId: number, eventId: number): Promise<{ ok: boolean; removed?: boolean; reason?: string }> {
  const db = getDb();
  const row = await one(
    db
      .select({ event: schema.applicationEvent, app: schema.application })
      .from(schema.applicationEvent)
      .innerJoin(schema.application, eq(schema.application.id, schema.applicationEvent.applicationId))
      .where(and(eq(schema.applicationEvent.id, eventId), eq(schema.application.userId, userId))),
  );
  if (!row || row.event.revertedAt) return { ok: false, reason: "Nothing to undo." };
  const { event, app } = row;
  if (event.fromStatus === null) {
    await db.transaction(async (tx) => {
      await tx.update(schema.emailMessage)
        .set({ reviewState: "dismissed", applicationId: null })
        .where(eq(schema.emailMessage.applicationId, app.id));
      await tx.delete(schema.application).where(eq(schema.application.id, app.id));
    });
    return { ok: true, removed: true };
  }
  if (app.status !== event.toStatus) return { ok: false, reason: "The card has moved since, so this can't be undone." };
  await db.transaction(async (tx) => {
    await tx.update(schema.application).set({ status: event.fromStatus!, updatedAt: new Date() }).where(eq(schema.application.id, app.id));
    await tx.update(schema.applicationEvent).set({ revertedAt: new Date() }).where(eq(schema.applicationEvent.id, event.id));
    // The email stays, but it no longer counts as having decided this card.
    if (event.emailId) await tx.update(schema.emailMessage).set({ reviewState: "confirmed" }).where(eq(schema.emailMessage.id, event.emailId));
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
  const row = await one(
    getDb()
      .select({ atsType: schema.job.atsType, externalId: schema.job.externalId, slug: schema.company.atsSlug })
      .from(schema.job)
      .innerJoin(schema.company, eq(schema.company.id, schema.job.companyId))
      .where(eq(schema.job.id, jobId)),
  );
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

export async function getApplicationByJob(userId: number, jobId: number): Promise<Application | null> {
  return (
    await one(
      getDb()
        .select()
        .from(schema.application)
        .where(and(eq(schema.application.userId, userId), eq(schema.application.jobId, jobId))),
    ) ?? null
  );
}

/** An application only if it belongs to this person. */
export async function getApplication(userId: number, id: number): Promise<Application | null> {
  return (
    await one(
      getDb()
        .select()
        .from(schema.application)
        .where(and(eq(schema.application.id, id), eq(schema.application.userId, userId))),
    ) ?? null
  );
}

/**
 * Called from the Apply dialog. Records your choices, moves the job to "Applying",
 * and queues a cover letter if you asked for one.
 */
export async function prepareApplication(
  userId: number,
  jobId: number,
  opts: { coverLetter: "yes" | "no"; resume?: "master" | "tailored"; regenerate?: boolean; searchId?: number | null },
): Promise<Application> {
  const db = getDb();
  const tailored = opts.resume === "tailored" ? await tailoredResumeFor(userId, jobId) : null;
  const resume = tailored ?? await currentMasterResume(userId);
  const existing = await getApplicationByJob(userId, jobId);
  const values = { resumeId: resume?.id ?? null, coverLetterChoice: opts.coverLetter, updatedAt: new Date() } as const;
  let app = existing
    ? await returned(db.update(schema.application).set(values).where(eq(schema.application.id, existing.id)).returning())
    : await returned(
        db
          .insert(schema.application)
          .values({ userId, jobId, searchId: opts.searchId ?? null, status: "applying", source: "app", ...values })
          .returning(),
      );
  if (!existing) await recordCreated(app.id, "applying", "manual");
  else if (existing.status === "saved") app = await setStatus(app.id, "applying", { source: "manual" });
  // Keep the dashboard it was first tracked in; only fill it if it was never set.
  if (!app.searchId && opts.searchId) {
    await db.update(schema.application).set({ searchId: opts.searchId }).where(eq(schema.application.id, app.id));
  }
  if (opts.coverLetter === "yes" && (!app.coverLetter || opts.regenerate)) await enqueueCoverLetter(userId, app.id);
  return app;
}

export async function coverLetterStatus(applicationId: number) {
  return await taskStatus("cover_letter", `application:${applicationId}`);
}

export async function tailorStatus(userId: number, jobId: number) {
  return await taskStatus("tailor_resume", tailorKey(userId, jobId));
}

export async function startTailoring(userId: number, jobId: number) {
  return await enqueueTailorResume(userId, jobId);
}

export async function updateCoverLetter(userId: number, applicationId: number, text: string): Promise<void> {
  // Your edits are yours: clear the automatic warnings.
  await getDb()
    .update(schema.application)
    .set({ coverLetter: text, coverLetterWarnings: [], updatedAt: new Date() })
    .where(and(eq(schema.application.id, applicationId), eq(schema.application.userId, userId)));
}

export async function markSubmitted(userId: number, applicationId: number, answers: unknown): Promise<Application | null> {
  const db = getDb();
  const app = await getApplication(userId, applicationId);
  if (!app) return null;
  await db.update(schema.application).set({ answers, source: app.source === "app" ? "extension" : app.source }).where(eq(schema.application.id, applicationId));
  // An email may already have moved it further along (confirmation, interview); never move it back.
  if (STAGE_RANK[app.status] >= STAGE_RANK.applied) return await getApplication(userId, applicationId);
  return await setStatus(applicationId, "applied", { source: "extension" });
}
