import { SearchFilterSchema } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { json, notFound, readJson, withUser } from "@/lib/api";
import { latestCrawl } from "@/lib/crawl-runner";
import { dashboardName, dashboardResults, getDashboard } from "@/lib/dashboards";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The Jobs tab. `?view=1` counts as opening the dashboard (resets its "new" count for next
 * time); `?since=` keeps the same "new" cut-off across the polls that follow.
 */
export function GET(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const d = await getDashboard(user.id, Number((await params).id));
    if (!d) return notFound();
    const q = new URL(req.url).searchParams;
    const sinceParam = q.get("since");
    const since = sinceParam && !Number.isNaN(Date.parse(sinceParam)) ? new Date(sinceParam) : null;
    const { results, newSince, fit } = await dashboardResults(user, d, { markViewed: q.get("view") === "1", since });
    return json({ search: { ...d, name: dashboardName(d) }, results, newSince, fit, crawl: await latestCrawl() });
  });
}

const Patch = z.object({
  name: z.string().trim().max(80).nullable().optional(),
  filter: SearchFilterSchema.optional(),
  notify: z.boolean().optional(),
  digestMinFit: z.number().int().min(0).max(100).nullable().optional(),
  archived: z.boolean().optional(),
});

export function PATCH(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const id = Number((await params).id);
    if (!await getDashboard(user.id, id)) return notFound();
    const { archived, ...rest } = Patch.parse(await readJson(req));
    const set = { ...rest, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }) };
    if (Object.keys(set).length) await getDb().update(schema.savedSearch).set(set).where(eq(schema.savedSearch.id, id));
    return json({ ok: true });
  });
}

/** Deletes the dashboard. Its applications stay in your account and move to another dashboard. */
export function DELETE(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const id = Number((await params).id);
    if (!await getDashboard(user.id, id)) return notFound();
    const db = getDb();
    await db.update(schema.application).set({ searchId: null }).where(eq(schema.application.searchId, id));
    await db.delete(schema.savedSearch).where(eq(schema.savedSearch.id, id));
    return json({ ok: true });
  });
}
