import type { ApplicationStatus, EmailKind, InterviewRound } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, ne, notInArray, sql } from "drizzle-orm";

const { emailMessage: em, application: app, job, company } = schema;

/** Company and role for an application, whether or not it's linked to a job we know. */
const companyExpr = sql<string>`coalesce(${company.name}, ${app.companyName}, 'Unknown company')`;
const titleExpr = sql<string>`coalesce(${job.title}, ${app.jobTitle}, 'Unknown role')`;

export interface ActionItem {
  emailId: number;
  applicationId: number;
  searchId: number | null;
  company: string;
  title: string;
  actionType: string | null;
  actionText: string;
  actionDueAt: Date | null;
  receivedAt: Date;
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
  webLink: string | null;
  rfcMessageId: string | null;
}

const OPEN_ACTION = and(
  eq(em.actionNeeded, true),
  isNull(em.actionDoneAt),
  inArray(em.reviewState, ["auto", "confirmed"]),
  isNotNull(em.applicationId),
  notInArray(app.status, ["rejected", "withdrawn"]),
);

/** Emails asking you to do something, due soonest first. Yours, across every search. */
export function openActions(userId: number): ActionItem[] {
  const rows = getDb()
    .select({
      emailId: em.id,
      applicationId: app.id,
      searchId: app.searchId,
      company: companyExpr,
      title: titleExpr,
      actionType: em.actionType,
      actionText: em.actionText,
      actionDueAt: em.actionDueAt,
      receivedAt: em.receivedAt,
      subject: em.subject,
      fromName: em.fromName,
      fromAddress: em.fromAddress,
      webLink: em.webLink,
      rfcMessageId: em.rfcMessageId,
    })
    .from(em)
    .innerJoin(app, eq(app.id, em.applicationId))
    .leftJoin(job, eq(job.id, app.jobId))
    .leftJoin(company, eq(company.id, job.companyId))
    .where(and(eq(em.userId, userId), OPEN_ACTION))
    .all();
  return rows
    .map((r) => ({ ...r, actionText: r.actionText ?? "Reply to this email" }))
    .sort((a, b) => (a.actionDueAt?.getTime() ?? Infinity) - (b.actionDueAt?.getTime() ?? Infinity) || a.receivedAt.getTime() - b.receivedAt.getTime());
}

export interface ReviewItem {
  emailId: number;
  kind: EmailKind;
  round: InterviewRound | null;
  companyName: string | null;
  jobTitle: string | null;
  summary: string | null;
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: Date;
  webLink: string | null;
  rfcMessageId: string | null;
  applicationId: number | null;
  searchId: number | null;
  classifiedBy: "llm" | "rules" | null;
  actionText: string | null;
}

/** Emails I wasn't sure about: they wait here instead of moving cards. */
export function reviewQueue(userId: number): ReviewItem[] {
  return getDb()
    .select({
      emailId: em.id,
      kind: em.kind,
      round: em.round,
      companyName: em.companyName,
      jobTitle: em.jobTitle,
      summary: em.summary,
      subject: em.subject,
      fromName: em.fromName,
      fromAddress: em.fromAddress,
      receivedAt: em.receivedAt,
      webLink: em.webLink,
      rfcMessageId: em.rfcMessageId,
      applicationId: em.applicationId,
      searchId: app.searchId,
      classifiedBy: em.classifiedBy,
      actionText: em.actionText,
    })
    .from(em)
    .leftJoin(app, eq(app.id, em.applicationId))
    .where(and(eq(em.userId, userId), eq(em.reviewState, "needs_review")))
    .orderBy(desc(em.receivedAt))
    .all();
}

export type EmailView = Omit<typeof schema.emailMessage.$inferSelect, "providerId" | "connectionId" | "userId" | "createdAt">;

/** Every job email on one application, oldest first. */
export function timeline(userId: number, applicationId: number): EmailView[] {
  return getDb()
    .select()
    .from(em)
    .where(and(eq(em.userId, userId), eq(em.applicationId, applicationId), ne(em.reviewState, "dismissed")))
    .orderBy(asc(em.receivedAt))
    .all()
    .map(({ providerId: _p, connectionId: _c, userId: _u, createdAt: _t, ...rest }) => rest);
}

/* ---------- interview rounds ---------- */

export type RoundState = "scheduling" | "scheduled" | "done";
export interface RoundInfo {
  round: InterviewRound;
  label: string | null;
  state: RoundState;
  eventAt: Date | null;
  emailIds: number[];
}

/**
 * Rounds in the order they happened. A round is done once a later round or a decision
 * arrives, or its interview time has passed; scheduled once a time is confirmed.
 */
export function roundsFrom(
  emails: { id: number; kind: EmailKind; round: InterviewRound | null; roundLabel: string | null; eventAt: Date | null; receivedAt: Date }[],
  now = new Date(),
): RoundInfo[] {
  const rounds: RoundInfo[] = [];
  const sorted = [...emails].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  for (const e of sorted) {
    if (e.kind === "rejection" || e.kind === "offer") {
      for (const r of rounds) r.state = "done";
      continue;
    }
    if (!e.round) continue;
    const key = e.round === "other" ? `other:${(e.roundLabel ?? "").toLowerCase()}` : e.round;
    let r = rounds.find((x) => (x.round === "other" ? `other:${(x.label ?? "").toLowerCase()}` : x.round) === key);
    if (!r) {
      for (const prev of rounds) prev.state = "done";
      r = { round: e.round, label: e.roundLabel, state: "scheduling", eventAt: null, emailIds: [] };
      rounds.push(r);
    }
    r.emailIds.push(e.id);
    r.label ??= e.roundLabel;
    if (e.eventAt) r.eventAt = e.eventAt;
    if (r.state !== "done" && (e.kind === "interview_scheduled" || e.eventAt)) r.state = "scheduled";
  }
  for (const r of rounds) if (r.state === "scheduled" && r.eventAt && r.eventAt < now) r.state = "done";
  return rounds;
}

export interface CardMail {
  emailCount: number;
  openActions: number;
  rounds: RoundInfo[];
  lastEmailAt: Date | null;
}

/** What the pipeline cards show about email, for many applications at once. */
export function mailForCards(userId: number, applicationIds: number[]): Map<number, CardMail> {
  const out = new Map<number, CardMail>();
  if (!applicationIds.length) return out;
  const rows = getDb()
    .select({
      id: em.id,
      applicationId: em.applicationId,
      kind: em.kind,
      round: em.round,
      roundLabel: em.roundLabel,
      eventAt: em.eventAt,
      receivedAt: em.receivedAt,
      actionNeeded: em.actionNeeded,
      actionDoneAt: em.actionDoneAt,
      reviewState: em.reviewState,
    })
    .from(em)
    .where(and(eq(em.userId, userId), inArray(em.applicationId, applicationIds), ne(em.reviewState, "dismissed")))
    .all();
  const byApp = new Map<number, typeof rows>();
  for (const r of rows) byApp.set(r.applicationId!, [...(byApp.get(r.applicationId!) ?? []), r]);
  for (const [id, list] of byApp) {
    out.set(id, {
      emailCount: list.length,
      openActions: list.filter((r) => r.actionNeeded && !r.actionDoneAt && r.reviewState !== "needs_review").length,
      rounds: roundsFrom(list),
      lastEmailAt: list.reduce<Date | null>((m, r) => (!m || r.receivedAt > m ? r.receivedAt : m), null),
    });
  }
  return out;
}

/* ---------- what email changed ---------- */

export interface EmailChange {
  eventId: number;
  applicationId: number;
  searchId: number | null;
  company: string;
  title: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  createdAt: Date;
}

/** Pipeline moves made by email since a point in time (not undone). */
export function emailChangesSince(userId: number, since: Date): EmailChange[] {
  const ev = schema.applicationEvent;
  return getDb()
    .select({
      eventId: ev.id,
      applicationId: app.id,
      searchId: app.searchId,
      company: companyExpr,
      title: titleExpr,
      fromStatus: ev.fromStatus,
      toStatus: ev.toStatus,
      createdAt: ev.createdAt,
    })
    .from(ev)
    .innerJoin(app, eq(app.id, ev.applicationId))
    .leftJoin(job, eq(job.id, app.jobId))
    .leftJoin(company, eq(company.id, job.companyId))
    .where(and(eq(app.userId, userId), eq(ev.source, "email"), isNull(ev.revertedAt), gt(ev.createdAt, since)))
    .orderBy(desc(ev.id))
    .all();
}

/** Counts by kind for the Mailbox page's summary. */
export function connectionStats(userId: number, connectionId: number) {
  const db = getDb();
  const byKind = db
    .select({ kind: em.kind, n: count() })
    .from(em)
    .where(and(eq(em.userId, userId), eq(em.connectionId, connectionId), ne(em.kind, "unrelated")))
    .groupBy(em.kind)
    .all();
  const created =
    db
      .select({ n: count() })
      .from(app)
      .where(and(eq(app.userId, userId), eq(app.source, "email")))
      .get()?.n ?? 0;
  return { byKind: Object.fromEntries(byKind.map((r) => [r.kind, r.n])) as Partial<Record<EmailKind, number>>, createdApplications: created };
}

/** What a stored email looked like going in, for re-classifying it on another model. */
export interface ClassifiedEmail {
  subject: string;
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: Date;
  snippet: string;
  kind: string;
  companyName: string | null;
}

/**
 * Recently sorted emails with the label they were given. The body isn't kept, so a re-run sees
 * subject and snippet only — fine for comparing two models against each other on equal footing,
 * not for judging either against the original decision.
 */
export function recentlyClassified(userId: number, limit: number): ClassifiedEmail[] {
  return getDb()
    .select({
      subject: em.subject,
      fromName: em.fromName,
      fromAddress: em.fromAddress,
      receivedAt: em.receivedAt,
      snippet: em.snippet,
      kind: em.kind,
      companyName: em.companyName,
    })
    .from(em)
    .where(and(eq(em.userId, userId), eq(em.classifiedBy, "llm")))
    .orderBy(desc(em.receivedAt))
    .limit(limit)
    .all()
    .map((r) => ({ ...r, subject: r.subject ?? "", snippet: r.snippet ?? "" }));
}
