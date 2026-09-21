import { getDb, one, schema } from "@jd/core/db";
import { getCompanyProfile, taskStatus } from "@jd/research";
import { and, eq, isNull, sql } from "drizzle-orm";
import { json, notFound, withUser } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export function GET(req: Request, { params }: Ctx) {
  return withUser(req, async () => {
    const id = Number((await params).id);
    const db = getDb();
    const company = await one(db.select().from(schema.company).where(eq(schema.company.id, id)));
    if (!company) return notFound();
    const jobs = await db
      .select({
        id: schema.job.id,
        title: schema.job.title,
        locations: schema.job.locations,
        locationType: schema.job.locationType,
        comp: schema.job.comp,
        postedAt: schema.job.postedAt,
        department: schema.job.department,
      })
      .from(schema.job)
      .where(and(eq(schema.job.companyId, id), isNull(schema.job.closedAt)))
      // Undated postings last, as SQLite sorted them; Postgres puts nulls first when descending.
      .orderBy(sql`${schema.job.postedAt} desc nulls last`);
    return json({ company, profile: await getCompanyProfile(id), research: await taskStatus("research_company", `company:${id}`), jobs });
  });
}
