import { decryptSecret, getProfile, getSettings, getUser, loadEnv } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import { BudgetExceededError } from "@jd/llm";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { type ApplicationHint, classifyEmail } from "./classify";
import { type Connection, FAKE_HOST, fakeMailAllowed, updateConnection } from "./connections";
import { fakeSource } from "./fake";
import { gmailSource } from "./gmail";
import { imapSource } from "./imap";
import { trackedApplications } from "./link";
import { type PrefilterContext, prefilter } from "./prefilter";
import { processEmail } from "./process";
import { type EmailHeaders, type MailSource, ReauthRequiredError } from "./types";

export interface SyncSummary {
  listed: number;
  candidates: number;
  processed: number;
  jobEmails: number;
  created: number;
  moved: number;
  remaining: number;
}

/** Leave headroom under the task's 10-minute limit; what's left continues at the next check. */
const TIME_BUDGET_MS = 7 * 60_000;
const PARALLEL = 4;

function sourceFor(conn: Connection, secret: string, companyDomains: string[]): MailSource {
  const save = (cursor: Connection["cursor"]) => updateConnection(conn.id, { cursor });
  if (conn.provider === "gmail") return gmailSource(conn, secret, { companyDomains, save });
  if (conn.imapHost === FAKE_HOST) {
    if (!fakeMailAllowed()) throw new Error("The test mailbox is only available in development.");
    return fakeSource(process.env.MAIL_FAKE_DIR!);
  }
  return imapSource(conn, secret, { save });
}

function prefilterContext(conn: Connection, companyDomains: string[]): PrefilterContext {
  loadEnv();
  const db = getDb();
  const trackedThreads = new Set(
    db
      .selectDistinct({ t: schema.emailMessage.threadId })
      .from(schema.emailMessage)
      .where(and(eq(schema.emailMessage.userId, conn.userId), isNotNull(schema.emailMessage.applicationId), isNotNull(schema.emailMessage.threadId)))
      .all()
      .map((r) => r.t!),
  );
  const user = getUser(conn.userId);
  const profile = getProfile(conn.userId);
  const selfAddresses = new Set([conn.address, user?.email, profile?.email].filter(Boolean).map((a) => a!.toLowerCase()));
  const digestFrom = new Set([process.env.DIGEST_FROM, process.env.SMTP_USER].filter(Boolean).map((a) => a!.toLowerCase().replace(/^.*<([^>]+)>.*$/, "$1")));
  return { companyDomains: new Set(companyDomains), trackedThreads, selfAddresses, digestFrom };
}

/**
 * One check of one mailbox: list what's new (or the look-back window on the first run), drop
 * non-job mail on headers, read and classify the rest oldest first, and update the pipeline.
 * Progress is saved as it goes, so a crash, a timeout or the AI budget loses nothing.
 */
export async function syncConnection(connectionId: number): Promise<SyncSummary | null> {
  const db = getDb();
  const conn = db.select().from(schema.mailboxConnection).where(eq(schema.mailboxConnection.id, connectionId)).get();
  if (!conn || !conn.secret || conn.status === "paused" || !getSettings("mailSync").enabled) return null;

  const summary: SyncSummary = { listed: 0, candidates: 0, processed: 0, jobEmails: 0, created: 0, moved: 0, remaining: 0 };
  const started = Date.now();
  let source: MailSource | null = null;
  try {
    const apps = trackedApplications(conn.userId);
    const companyDomains = [...new Set(apps.map((a) => a.companyDomain).filter((d): d is string => Boolean(d)))];
    source = sourceFor(conn, decryptSecret(conn.secret), companyDomains);
    updateConnection(conn.id, { progress: { done: 0, total: 0 }, lastError: null, status: "active" });

    const headers = (await source.listHeaders()).sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    summary.listed = headers.length;
    const seen = new Set<string>();
    for (let i = 0; i < headers.length; i += 500) {
      const ids = headers.slice(i, i + 500).map((h) => h.providerId);
      for (const r of db
        .select({ p: schema.emailMessage.providerId })
        .from(schema.emailMessage)
        .where(and(eq(schema.emailMessage.connectionId, conn.id), inArray(schema.emailMessage.providerId, ids)))
        .all())
        seen.add(r.p);
    }
    const ctx = prefilterContext(conn, companyDomains);
    const timeZone = getUser(conn.userId)?.timezone ?? "UTC";
    const candidates = headers.filter((h) => !seen.has(h.providerId) && prefilter(h, ctx).keep);
    summary.candidates = candidates.length;
    const cap = getSettings("mailSync").maxClassifyPerRun;
    const batch = candidates.slice(0, cap);
    updateConnection(conn.id, { progress: { done: 0, total: batch.length } });

    const hints = (): ApplicationHint[] =>
      apps.filter((a) => a.status !== "saved").slice(-80).map((a) => ({ id: a.id, company: a.company, title: a.title, status: a.status }));

    let stoppedEarly = false;
    for (let i = 0; i < batch.length; i += PARALLEL) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        stoppedEarly = true;
        break;
      }
      const group = batch.slice(i, i + PARALLEL);
      // Reading and classifying run in parallel; applying runs in order, so moves happen oldest first.
      const classified = await Promise.all(
        group.map(async (h: EmailHeaders) => {
          const email = await source!.fetchEmail(h);
          return email ? { email, ...(await classifyEmail(email, hints(), timeZone)) } : null;
        }),
      );
      for (const c of classified) {
        summary.processed++;
        if (!c) continue;
        const out = processEmail(conn, c.email, c.result, c.by, apps);
        if (out.row) summary.jobEmails++;
        if (out.created) summary.created++;
        if (out.moved) summary.moved++;
      }
      updateConnection(conn.id, { progress: { done: Math.min(i + PARALLEL, batch.length), total: batch.length } });
    }

    summary.remaining = candidates.length - summary.processed;
    const complete = !stoppedEarly && candidates.length <= cap;
    // Only a complete pass moves the cursor; otherwise the next check lists the same window and skips what's done.
    if (complete) await source.commit();
    updateConnection(conn.id, {
      lastSyncAt: new Date(),
      progress: null,
      backfillDone: conn.backfillDone || complete,
      lastError: null,
      status: "active",
    });
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ReauthRequiredError) {
      updateConnection(conn.id, { status: "needs_reauth", lastError: message, progress: null });
      return null;
    }
    if (err instanceof BudgetExceededError) {
      updateConnection(conn.id, { lastError: `Paused: ${message}`, progress: null, lastSyncAt: new Date() });
      throw err;
    }
    updateConnection(conn.id, { status: "error", lastError: message.slice(0, 500), progress: null, lastSyncAt: new Date() });
    throw err;
  } finally {
    await source?.close().catch(() => undefined);
  }
}
