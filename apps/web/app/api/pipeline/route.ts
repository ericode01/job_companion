import { impliesApplied, matchJobByUrl, recordCreated } from "@jd/apply";
import { APPLICATION_STATUSES } from "@jd/core";
import { getDb, one, returned, schema } from "@jd/core/db";
import { activeConnections, chooseDashboard, emailChangesSince, openActions, reviewQueue } from "@jd/mail";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { json, readJson, withUser } from "@/lib/api";
import { pipelineFor, pipelineSearches } from "@/lib/dashboards";

/**
 * The pipeline: every application you're tracking, what email asks of you, what it changed this
 * week, and what to check. One board for the person; the search is a filter the browser applies.
 */
export function GET(req: Request) {
  return withUser(req, async (user) => {
    const mailboxes = await activeConnections(user.id);
    return json({
      cards: await pipelineFor(user.id),
      searches: await pipelineSearches(user.id),
      actions: await openActions(user.id),
      review: await reviewQueue(user.id),
      changes: await emailChangesSince(user.id, new Date(Date.now() - 7 * 86_400_000)),
      mailbox: mailboxes.length ? { connected: true, needsReauth: mailboxes.some((c) => c.status === "needs_reauth") } : { connected: false, needsReauth: false },
    });
  });
}

const NewApplication = z.object({
  companyName: z.string().trim().min(1, "Which company is this?").max(120),
  jobTitle: z.string().trim().max(200).optional(),
  jobUrl: z.string().trim().url("Paste the job posting's full address.").max(2000).optional().or(z.literal("")),
  status: z.enum(APPLICATION_STATUSES).default("applied"),
});

/**
 * An application you're tracking that nothing else knows about: applied somewhere that sent no
 * confirmation, or before you used Job Companion. Linked to a job we know when the URL matches.
 */
export function POST(req: Request) {
  return withUser(req, async (user) => {
    const body = NewApplication.parse(await readJson(req));
    const db = getDb();
    const hit = body.jobUrl ? await matchJobByUrl(body.jobUrl) : null;
    if (hit) {
      const taken = await one(
        db
          .select({ id: schema.application.id })
          .from(schema.application)
          .where(and(eq(schema.application.userId, user.id), eq(schema.application.jobId, hit.jobId))),
      );
      if (taken) return json({ error: "That job is already on your board." }, { status: 409 });
    }
    const row = await returned(
      db
        .insert(schema.application)
        .values({
          userId: user.id,
          jobId: hit?.jobId ?? null,
          searchId: await chooseDashboard(user.id, hit?.jobId ?? null, body.jobTitle ?? null),
          companyName: body.companyName,
          jobTitle: body.jobTitle || null,
          jobUrl: hit ? null : body.jobUrl || null,
          source: "manual",
          status: body.status,
          appliedAt: impliesApplied(body.status, "manual") ? new Date() : null,
        })
        .returning(),
    );
    await recordCreated(row.id, row.status, "manual");
    return json({ id: row.id, linkedJob: Boolean(hit) });
  });
}
