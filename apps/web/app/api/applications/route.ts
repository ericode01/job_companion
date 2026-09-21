import { recordCreated, setStatus } from "@jd/apply";
import { APPLICATION_STATUSES } from "@jd/core";
import { getDb, one, returned, schema } from "@jd/core/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { json, readJson, withUser } from "@/lib/api";
import { getDashboard } from "@/lib/dashboards";

const Body = z.object({
  jobId: z.number().int(),
  status: z.enum(APPLICATION_STATUSES).nullable().describe("null removes the job from the tracker"),
  notes: z.string().max(5000).optional(),
  /** The dashboard you're in; a new tracker entry lands in its pipeline. */
  searchId: z.number().int().nullable().optional(),
});

/** Moves a job through your pipeline (or adds/removes it). */
export function PUT(req: Request) {
  return withUser(req, async (user) => {
    const { jobId, status, notes, searchId } = Body.parse(await readJson(req));
    const db = getDb();
    const mine = and(eq(schema.application.userId, user.id), eq(schema.application.jobId, jobId));
    if (status === null) {
      await db.delete(schema.application).where(mine);
      return json(null);
    }
    const existing = await one(db.select().from(schema.application).where(mine));
    if (existing) {
      if (notes !== undefined) await db.update(schema.application).set({ notes, updatedAt: new Date() }).where(eq(schema.application.id, existing.id));
      return json(await setStatus(existing.id, status, { source: "manual" }));
    }
    const dashboard = searchId ? await getDashboard(user.id, searchId) : null;
    const row = await returned(
      db
        .insert(schema.application)
        .values({
          userId: user.id,
          jobId,
          searchId: dashboard?.id ?? null,
          status,
          source: "app",
          appliedAt: status === "applied" ? new Date() : null,
          notes: notes ?? null,
        })
        .returning(),
    );
    await recordCreated(row.id, status, "manual");
    return json(row);
  });
}
