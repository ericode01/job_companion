import { getDb, schema } from "@jd/core/db";
import { getCompanyProfile, taskStatus } from "@jd/research";
import { and, desc, eq, isNull } from "drizzle-orm";
import { json, notFound, withUser } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export function GET(req: Request, { params }: Ctx) {
  return withUser(req, async () => {
    const id = Number((await params).id);
    const db = getDb();
    const company = db.select().from(schema.company).where(eq(schema.company.id, id)).get();
    if (!company) return notFound();
    const jobs = db
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
      .orderBy(desc(schema.job.postedAt))
      .all();
    return json({ company, profile: getCompanyProfile(id), research: taskStatus("research_company", `company:${id}`), jobs });
  });
}
