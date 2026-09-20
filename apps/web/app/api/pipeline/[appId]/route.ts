import { applicationEvents, getApplication, matchJobByUrl, setStatus } from "@jd/apply";
import { APPLICATION_STATUSES } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import { roundsFrom, timeline } from "@jd/mail";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { json, notFound, readJson, withUser } from "@/lib/api";
import { getDashboard, listDashboards } from "@/lib/dashboards";

type Ctx = { params: Promise<{ appId: string }> };

/** One application with its emails, interview rounds and status history (the pipeline panel). */
export function GET(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const app = getApplication(user.id, Number((await params).appId));
    if (!app) return notFound();
    const db = getDb();
    const linked = app.jobId
      ? db
          .select({ title: schema.job.title, url: schema.job.url, locations: schema.job.locations, comp: schema.job.comp, closedAt: schema.job.closedAt, companyName: schema.company.name })
          .from(schema.job)
          .innerJoin(schema.company, eq(schema.company.id, schema.job.companyId))
          .where(eq(schema.job.id, app.jobId))
          .get()
      : null;
    const emails = timeline(user.id, app.id);
    const events = applicationEvents(app.id);
    return json({
      app: {
        id: app.id,
        status: app.status,
        source: app.source,
        jobId: app.jobId,
        searchId: app.searchId,
        title: linked?.title ?? app.jobTitle ?? "Unknown role",
        companyName: linked?.companyName ?? app.companyName ?? "Unknown company",
        postingUrl: linked?.url ?? app.jobUrl,
        locations: linked?.locations ?? [],
        comp: linked?.comp ?? null,
        closedAt: linked?.closedAt ?? null,
        appliedAt: app.appliedAt,
        confirmedAt: app.confirmedAt,
        notes: app.notes,
      },
      emails,
      rounds: roundsFrom(emails),
      events,
      dashboards: listDashboards(user.id).map(({ id, name }) => ({ id, name })),
    });
  });
}

const Patch = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  searchId: z.number().int().optional(),
  notes: z.string().max(5000).optional(),
  /** "Link to a job posting": a job board URL. */
  postingUrl: z.string().trim().url("Paste the job posting's full address.").max(2000).optional(),
});

export function PATCH(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const app = getApplication(user.id, Number((await params).appId));
    if (!app) return notFound();
    const body = Patch.parse(await readJson(req));
    const db = getDb();
    const set: Partial<typeof schema.application.$inferInsert> = {};
    if (body.searchId !== undefined) {
      if (!getDashboard(user.id, body.searchId)) return notFound();
      set.searchId = body.searchId;
    }
    if (body.notes !== undefined) set.notes = body.notes;
    let linked: "job" | "url" | undefined;
    if (body.postingUrl) {
      const hit = matchJobByUrl(body.postingUrl);
      const taken =
        hit &&
        db
          .select({ id: schema.application.id })
          .from(schema.application)
          .where(and(eq(schema.application.userId, user.id), eq(schema.application.jobId, hit.jobId)))
          .get();
      if (hit && (!taken || taken.id === app.id)) {
        set.jobId = hit.jobId;
        linked = "job";
      } else if (taken) {
        return json({ error: "That job is already another card in your pipeline." }, { status: 409 });
      } else {
        set.jobUrl = body.postingUrl;
        linked = "url";
      }
    }
    if (Object.keys(set).length) db.update(schema.application).set({ ...set, updatedAt: new Date() }).where(eq(schema.application.id, app.id)).run();
    if (body.status && body.status !== app.status) setStatus(app.id, body.status, { source: "manual" });
    return json({ ok: true, linked });
  });
}

/** Stops tracking it. Its emails stay in your mailbox, and here they're set aside. */
export function DELETE(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const app = getApplication(user.id, Number((await params).appId));
    if (!app) return notFound();
    getDb().delete(schema.application).where(eq(schema.application.id, app.id)).run();
    return json({ ok: true });
  });
}
