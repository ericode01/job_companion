import { getSettings } from "@jd/core";
import { getDb, one, schema } from "@jd/core/db";
import { getApplicationByJob } from "@jd/apply";
import { hasApiKey } from "@jd/llm";
import { currentMasterResume, getCompanyProfile, getFit, getJobAnalysis, taskStatus } from "@jd/research";
import { eq } from "drizzle-orm";
import { json, notFound, withUser } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export function GET(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const id = Number((await params).id);
    const row = await one(
      getDb()
        .select({ job: schema.job, company: schema.company })
        .from(schema.job)
        .innerJoin(schema.company, eq(schema.company.id, schema.job.companyId))
        .where(eq(schema.job.id, id)),
    );
    if (!row) return notFound();

    const resume = await currentMasterResume(user.id);
    const analysis = await getJobAnalysis(id);
    const fit = resume?.parseStatus === "done" ? await getFit(id, resume.sourceHash) : null;
    const { descriptionText: _t, ...job } = row.job;

    return json({
      job,
      company: row.company,
      companyProfile: await getCompanyProfile(row.company.id),
      analysis: analysis && analysis.contentHash === row.job.contentHash ? analysis : null,
      fit,
      application: await getApplicationByJob(user.id, id),
      resume: resume ? { id: resume.id, parseStatus: resume.parseStatus } : null,
      tasks: {
        analysis: await taskStatus("analyze_job", `job:${id}`),
        research: await taskStatus("research_company", `company:${row.company.id}`),
        fit: resume ? await taskStatus("score_fit", `fit:${id}:${resume.sourceHash}`) : { status: "idle" },
      },
      hasApiKey: hasApiKey(),
      researchOnOpen: (await getSettings("research")).researchOnOpen,
    });
  });
}
