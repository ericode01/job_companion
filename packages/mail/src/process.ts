import { lastManualMoveAt, setStatus } from "@jd/apply";
import { type EmailClassification, getSettings, getUser } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import { and, eq, isNull, lt, ne } from "drizzle-orm";
import { snippetOf } from "./body";
import { gmailThreadLink } from "./gmail";
import { imapWebLink } from "./imap";
import { createExternalApplication, linkEmail, postingUrl, type TrackedApp } from "./link";
import { decide, statusForNew } from "./status";
import type { RawEmail } from "./types";

type Connection = typeof schema.mailboxConnection.$inferSelect;
export type EmailRow = typeof schema.emailMessage.$inferSelect;

/** Milliseconds a zone is ahead of UTC at an instant. */
function zoneOffset(at: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(at))
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - at;
}

function wallClock(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  return new Date(guess - zoneOffset(guess, timeZone));
}

/**
 * Dates from the classifier, read in the person's time zone: a bare date is a deadline at the end
 * of that day ("by Tuesday" shouldn't show as Monday evening), and a time without an offset is
 * their local time.
 */
export function parseEmailDate(s: string | null | undefined, timeZone = "UTC"): Date | null {
  if (!s) return null;
  const tz = (() => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
      return timeZone;
    } catch {
      return "UTC";
    }
  })();
  const day = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) return wallClock(+day[1]!, +day[2]!, +day[3]!, 23, 59, tz);
  const local = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (local) return wallClock(+local[1]!, +local[2]!, +local[3]!, +local[4]!, +local[5]!, tz);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ProcessOutcome {
  row: EmailRow | null;
  created: TrackedApp | null;
  moved: boolean;
}

/**
 * Stores one classified email and applies it: links it to an application (creating one for
 * applications made elsewhere), moves the card when that's safe, and otherwise asks the person.
 * Unrelated emails keep only their ids.
 */
export function processEmail(conn: Connection, email: RawEmail, cls: EmailClassification, by: "llm" | "rules", apps: TrackedApp[]): ProcessOutcome {
  const db = getDb();
  const tz = getUser(conn.userId)?.timezone ?? "UTC";
  if (!cls.jobRelated || cls.kind === "unrelated") {
    db.insert(schema.emailMessage)
      .values({ userId: conn.userId, connectionId: conn.id, providerId: email.providerId, receivedAt: email.receivedAt, kind: "unrelated", classifiedBy: by })
      .onConflictDoNothing()
      .run();
    return { row: null, created: null, moved: false };
  }

  const webLink =
    conn.provider === "gmail" ? (email.threadId ? gmailThreadLink(conn.address, email.threadId) : null) : imapWebLink(conn, email.threadId);
  const row = db
    .insert(schema.emailMessage)
    .values({
      userId: conn.userId,
      connectionId: conn.id,
      providerId: email.providerId,
      rfcMessageId: email.rfcMessageId,
      threadId: email.threadId,
      webLink,
      fromName: email.fromName,
      fromAddress: email.fromAddress,
      subject: email.subject.slice(0, 500),
      receivedAt: email.receivedAt,
      snippet: snippetOf(email.text),
      kind: cls.kind,
      round: cls.round,
      roundLabel: cls.roundLabel?.slice(0, 120) ?? null,
      eventAt: parseEmailDate(cls.eventAt, tz),
      companyName: cls.companyName?.slice(0, 200) ?? null,
      jobTitle: cls.jobTitle?.slice(0, 200) ?? null,
      summary: cls.summary.slice(0, 300),
      confidence: cls.confidence,
      classifiedBy: by,
      actionNeeded: cls.action.needed,
      actionType: cls.action.needed ? cls.action.type : null,
      actionText: cls.action.needed ? (cls.action.text?.slice(0, 200) ?? null) : null,
      actionDueAt: cls.action.needed ? parseEmailDate(cls.action.dueAt, tz) : null,
    })
    .onConflictDoNothing()
    .returning()
    .get();
  if (!row) return { row: null, created: null, moved: false };
  const out = applyToPipeline(row, apps, { links: email.links, applicationRef: cls.applicationRef });
  return { ...out, row: getEmail(row.id) };
}

export function getEmail(id: number): EmailRow | null {
  return getDb().select().from(schema.emailMessage).where(eq(schema.emailMessage.id, id)).get() ?? null;
}

function setReview(id: number, state: EmailRow["reviewState"], applicationId?: number | null) {
  getDb()
    .update(schema.emailMessage)
    .set({ reviewState: state, ...(applicationId !== undefined ? { applicationId } : {}) })
    .where(eq(schema.emailMessage.id, id))
    .run();
}

/**
 * A later round, an offer or a rejection means the earlier rounds' requests (book a recruiter
 * call, finish the take-home) are behind you, so they stop showing as "needs your reply".
 */
export function closeSupersededActions(applicationId: number, row: EmailRow): void {
  const decisive = row.kind === "rejection" || row.kind === "offer";
  if (!decisive && !row.round) return;
  const db = getDb();
  const open = db
    .select({ id: schema.emailMessage.id, round: schema.emailMessage.round })
    .from(schema.emailMessage)
    .where(
      and(
        eq(schema.emailMessage.applicationId, applicationId),
        eq(schema.emailMessage.actionNeeded, true),
        isNull(schema.emailMessage.actionDoneAt),
        lt(schema.emailMessage.receivedAt, row.receivedAt),
        ne(schema.emailMessage.id, row.id),
      ),
    )
    .all();
  for (const e of open) {
    if (decisive || (e.round && e.round !== row.round)) {
      db.update(schema.emailMessage).set({ actionDoneAt: row.receivedAt }).where(eq(schema.emailMessage.id, e.id)).run();
    }
  }
}

/**
 * Links a stored email and applies what it means. Also used when the person corrects an email
 * (confirmedByPerson: act on it regardless of confidence).
 */
export function applyToPipeline(
  row: EmailRow,
  apps: TrackedApp[],
  opts: { links?: string[]; applicationRef?: number | null; confirmedByPerson?: boolean; forceApplicationId?: number; createIfMissing?: boolean } = {},
): { created: TrackedApp | null; moved: boolean } {
  const threshold = getSettings("mailSync").autoApplyConfidence;
  const trusted = opts.confirmedByPerson || (row.classifiedBy === "llm" && (row.confidence ?? 0) >= threshold);
  const outcome = opts.forceApplicationId
    ? ({ kind: "linked", applicationId: opts.forceApplicationId, via: "ref" } as const)
    : linkEmail(
        row.userId,
        { threadId: row.threadId, links: opts.links ?? [], companyName: row.companyName, jobTitle: row.jobTitle, fromAddress: row.fromAddress, applicationRef: opts.applicationRef ?? null },
        apps,
      );

  if (outcome.kind === "ambiguous") {
    setReview(row.id, "needs_review");
    return { created: null, moved: false };
  }

  if (outcome.kind === "none") {
    // Asked to add it, a general update still means "I applied there".
    const status = statusForNew(row.kind) ?? (opts.createIfMissing ? "applied" : null);
    const create = status && row.companyName && (trusted || opts.createIfMissing);
    if (!create) {
      // Nothing to attach it to; worth a look only if it asks something of you or implies an application.
      if (status || row.actionNeeded) setReview(row.id, "needs_review");
      return { created: null, moved: false };
    }
    const app = createExternalApplication(row.userId, {
      companyName: row.companyName!,
      jobTitle: row.jobTitle,
      jobUrl: postingUrl(opts.links ?? []),
      jobId: outcome.jobId,
      status: status!,
      appliedAt: row.kind === "application_received" ? row.receivedAt : null,
      confirmedAt: row.kind === "application_received" ? row.receivedAt : null,
      emailId: row.id,
    });
    apps.push(app);
    setReview(row.id, opts.confirmedByPerson ? "confirmed" : "auto", app.id);
    return { created: app, moved: true };
  }

  const app = apps.find((a) => a.id === outcome.applicationId);
  if (!app) return { created: null, moved: false };
  getDb().update(schema.emailMessage).set({ applicationId: app.id }).where(eq(schema.emailMessage.id, row.id)).run();
  closeSupersededActions(app.id, row);
  const d = decide(
    app,
    { kind: row.kind, receivedAt: row.receivedAt, confidence: row.confidence ?? 0, classifiedBy: row.classifiedBy ?? "rules" },
    { lastManualMove: lastManualMoveAt(app.id), threshold, confirmedByPerson: opts.confirmedByPerson },
  );
  if (d.review) {
    setReview(row.id, "needs_review");
    return { created: null, moved: false };
  }
  if (d.confirm && !app.confirmedAt) {
    getDb().update(schema.application).set({ confirmedAt: row.receivedAt }).where(eq(schema.application.id, app.id)).run();
    app.confirmedAt = row.receivedAt;
  }
  if (opts.confirmedByPerson) setReview(row.id, "confirmed");
  if (!d.move) return { created: null, moved: false };
  const updated = setStatus(app.id, d.move, { source: "email", emailId: row.id, appliedAt: row.kind === "application_received" ? row.receivedAt : undefined });
  app.status = updated.status;
  return { created: null, moved: true };
}
