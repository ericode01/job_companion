import { getSettings, getSpendStatus, getUser, getUserSettings, runAs } from "@jd/core";
import { getDb, one, schema } from "@jd/core/db";
import { hydrateForFilter } from "@jd/sources";
import { and, desc, eq } from "drizzle-orm";
import { buildDigest, followedSearches, type Digest } from "./build";
import { renderHtml, renderText, subjectFor } from "./render";
import { MailConfigError, sendMail } from "./send";

export interface DigestOutcome {
  status: "sent" | "skipped" | "failed";
  reason?: string;
  digest: Digest;
  subject: string;
}

async function lastRunAt(userId: number): Promise<Date | null> {
  return (
    (
      await one(
        getDb()
          .select()
          .from(schema.digestRun)
          .where(eq(schema.digestRun.userId, userId))
          .orderBy(desc(schema.digestRun.id))
          .limit(1),
      )
    )?.sentAt ?? null
  );
}

/** Wall-clock hour and minute in a time zone, e.g. { h: 8, m: 5 } for 08:05 in New York. */
export function clockIn(timeZone: string, at: Date): { h: number; m: number; ymd: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { h: Number(parts.hour), m: Number(parts.minute), ymd: `${parts.year}-${parts.month}-${parts.day}` };
}

/**
 * True when the person's send time has passed today — in their own time zone, since the server
 * may be anywhere — and today's digest hasn't run yet.
 */
export async function digestDue(userId: number, now = new Date()): Promise<boolean> {
  const { enabled, sendTime } = await getUserSettings(userId, "digest");
  if (!enabled) return false;
  const tz = (await getUser(userId))?.timezone ?? "UTC";
  const [h = 8, m = 0] = sendTime.split(":").map(Number);
  const nowLocal = clockIn(tz, now);
  if (nowLocal.h * 60 + nowLocal.m < h * 60 + m) return false;
  const last = await lastRunAt(userId);
  return !last || clockIn(tz, last).ymd !== nowLocal.ymd;
}

/** Everyone whose digest is due now. */
export async function dueDigestUsers(now = new Date()): Promise<number[]> {
  const users = await getDb().select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.disabled, false));
  const due: number[] = [];
  for (const { id } of users) if (await digestDue(id, now)) due.push(id);
  return due;
}

export async function runDigest(
  userId: number,
  opts: { dryRun?: boolean; force?: boolean; now?: Date } = {},
): Promise<DigestOutcome> {
  return runAs(userId, async () => {
    const now = opts.now ?? new Date();
    const settings = await getUserSettings(userId, "digest");
    const { method } = await getSettings("mail");
    // Boards that only list titles need their detail fetched before locations can be matched.
    for (const search of await followedSearches(userId)) await hydrateForFilter(search.filter, userId);
    const digest = await buildDigest(userId, now);
    const subject = subjectFor(digest);
    const record = async (status: DigestOutcome["status"], error?: string) => {
      if (opts.dryRun) return;
      await getDb()
        .insert(schema.digestRun)
        .values({
          userId,
          status,
          jobIds: digest.sections.flatMap((s) => s.jobs.map((j) => j.jobId)),
          to: settings.to || null,
          method,
          error: error ?? null,
          coveredUntil: now,
          sentAt: now,
        });
    };

    if (!settings.enabled && !opts.force) return { status: "skipped", reason: "The digest is turned off.", digest, subject };
    if (!settings.to && !opts.dryRun) {
      await record("failed", "No address set");
      return { status: "failed", reason: "Set an address in Account → Email digest.", digest, subject };
    }
    if (digest.total === 0 && digest.actions.length === 0 && digest.changes.length === 0 && settings.skipWhenEmpty && !opts.force) {
      // Still move the window forward so tomorrow's digest doesn't repeat today's jobs.
      await record("skipped", "Nothing new");
      return { status: "skipped", reason: "No new matches or email updates.", digest, subject };
    }
    const spend = await getSpendStatus(now, userId);
    if (spend.overCap) {
      await record("skipped", "AI spend cap reached");
      return { status: "skipped", reason: "AI spend cap reached; fit scores may be missing.", digest, subject };
    }
    if (opts.dryRun) return { status: "skipped", reason: "Dry run.", digest, subject };

    try {
      await sendMail(method, { to: settings.to, subject, html: renderHtml(digest), text: renderText(digest) });
      await record("sent");
      return { status: "sent", digest, subject };
    } catch (err) {
      const message = err instanceof MailConfigError ? err.message : `Couldn't send the email: ${err instanceof Error ? err.message : String(err)}`;
      await record("failed", message);
      return { status: "failed", reason: message, digest, subject };
    }
  });
}

export async function lastDigestRun(userId: number) {
  return (
    await one(
      getDb()
        .select()
        .from(schema.digestRun)
        .where(and(eq(schema.digestRun.userId, userId)))
        .orderBy(desc(schema.digestRun.id))
        .limit(1),
    ) ?? null
  );
}
