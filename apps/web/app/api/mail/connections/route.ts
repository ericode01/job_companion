import { getSettings } from "@jd/core";
import {
  connectionStats,
  domainOf,
  emailChangesSince,
  fakeMailAllowed,
  googleConfigured,
  listConnections,
  LOOKBACK_CHOICES,
  reviewQueue,
  saveImapConnection,
  toPublic,
  trackedApplications,
  UNSUPPORTED_DOMAINS,
} from "@jd/mail";
import { z } from "zod";
import { json, readJson, withUser } from "@/lib/api";
import { allowAttempt } from "@/lib/rate-limit";

/** Your mailboxes, what they've found, and what's waiting for you to check. */
export function GET(req: Request) {
  return withUser(req, async (user) => {
    const s = await getSettings("mailSync");
    return json({
      enabled: s.enabled,
      google: googleConfigured(),
      allowImap: s.allowImap,
      testMailbox: fakeMailAllowed(),
      connections: await Promise.all((await listConnections(user.id)).map(async (c) => ({ ...toPublic(c), stats: await connectionStats(user.id, c.id) }))),
      review: await reviewQueue(user.id),
      // "Is it still working?" is answered better by what it just did than by a status pill.
      changes: (await emailChangesSince(user.id, new Date(Date.now() - 7 * 86_400_000))).slice(0, 5),
      applications: (await trackedApplications(user.id)).map((a) => ({ id: a.id, label: `${a.company} · ${a.title}` })),
    });
  });
}

const Imap = z.object({
  address: z.string().trim().email("Enter the email address you sign in with.").max(200),
  host: z.string().trim().min(3, "Enter the IMAP server, e.g. imap.mail.me.com.").max(200),
  port: z.number().int(),
  password: z.string().min(1, "Enter the app password.").max(200),
  backfillDays: z.number().int().refine((d) => (LOOKBACK_CHOICES as readonly number[]).includes(d)),
});

/** Connects a mailbox by IMAP with an app password, after checking that it signs in. */
export function POST(req: Request) {
  return withUser(req, async (user) => {
    const s = await getSettings("mailSync");
    if (!s.enabled || !s.allowImap) return json({ error: "Connecting by app password is turned off on this server." }, { status: 403 });
    const body = Imap.parse(await readJson(req));
    if (UNSUPPORTED_DOMAINS.includes(domainOf(body.address))) {
      return json({ error: "Outlook and Hotmail no longer accept app passwords for IMAP, so they can't be connected yet." }, { status: 400 });
    }
    if (!allowAttempt(`imap-connect:${user.id}`, 6, 15 * 60_000)) {
      return json({ error: "Too many attempts. Wait 15 minutes and try again." }, { status: 429 });
    }
    try {
      const conn = await saveImapConnection(user.id, body);
      return json(toPublic(conn), { status: 201 });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "Couldn't connect." }, { status: 400 });
    }
  });
}
