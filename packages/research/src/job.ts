import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getSettings, JobAnalysisSchema } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import { assertBudget, forModel, parseStructured, recordMessageUsage } from "@jd/llm";
import { eq } from "drizzle-orm";
import { assertUsableStop, NonRetryableError } from "./util";

const { job, company, jobAnalysis } = schema;
export type JobAnalysisRow = typeof jobAnalysis.$inferSelect;

const ANALYZE_SYSTEM = `You extract key facts from a job posting for a job seeker.

Rules:
- Only use what the posting says. Use null or empty lists when it doesn't say.
- mustHave / niceToHave: short phrases (under 12 words each), in the posting's order.
- techStack: specific technologies only (e.g. "Go", "Kubernetes", "PostgreSQL"), not generic skills.
- visaSponsorship: "offered" or "not_offered" only if the posting states it; otherwise "unspecified".
- compensation: only if the posting states a range; annual USD figures as plain numbers (230000, not "230k").`;

export async function analyzeJob(jobId: number, opts: { background: boolean }): Promise<JobAnalysisRow> {
  const db = getDb();
  const row = db
    .select({ job, companyName: company.name })
    .from(job)
    .innerJoin(company, eq(company.id, job.companyId))
    .where(eq(job.id, jobId))
    .get();
  if (!row) throw new NonRetryableError(`Job ${jobId} not found`);
  assertBudget(opts);
  const setting = getSettings("ai").models.extraction;
  const { client, model } = forModel(setting);
  const j = row.job;
  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    system: ANALYZE_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Company: ${row.companyName}\nTitle: ${j.title}\nLocations: ${j.locations.join("; ") || "not listed"}\n\n<posting>\n${j.descriptionText}\n</posting>`,
      },
    ],
    output_config: { format: zodOutputFormat(JobAnalysisSchema) },
  });
  recordMessageUsage("job_analysis", setting, response);
  assertUsableStop(response, "analyze this job posting");
  const analysis = parseStructured(response, JobAnalysisSchema, "job analysis");
  const values = { jobId, data: analysis, contentHash: j.contentHash, model, analyzedAt: new Date() };
  return db.insert(jobAnalysis).values(values).onConflictDoUpdate({ target: jobAnalysis.jobId, set: values }).returning().get();
}

export function getJobAnalysis(jobId: number): JobAnalysisRow | null {
  return getDb().select().from(jobAnalysis).where(eq(jobAnalysis.jobId, jobId)).get() ?? null;
}
