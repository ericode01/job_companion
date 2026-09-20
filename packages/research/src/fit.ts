import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { FitResultSchema, getSettings } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import { assertBudget, getClient, recordMessageUsage } from "@jd/llm";
import { and, eq, inArray } from "drizzle-orm";
import { getResume, resumeForPrompt } from "./resume";
import { assertUsableStop, NonRetryableError } from "./util";

const { job, company, jobFit } = schema;
export type JobFitRow = typeof jobFit.$inferSelect;

const FIT_RUBRIC = `You assess how well a candidate's resume fits a job posting.

Scoring (0–100):
- 85–100 strong: meets essentially all must-haves at the right level, with directly relevant domain or stack experience.
- 70–84 good: meets most must-haves; gaps are learnable or secondary.
- 50–69 stretch: meets some must-haves; notable gaps in level, domain, or core stack.
- 0–49 weak: missing several must-haves or clearly the wrong level or function.

Rules:
- Judge seniority from scope and impact in the resume, not only titles.
- Every strength must cite evidence from the resume. Don't credit experience the resume doesn't show.
- Gaps: must-haves or strong preferences the resume doesn't show. Be specific and brief.
- talkingPoints: 2–4 concrete things from the resume to emphasize for this role.
- verdict must match the score band.`;

export async function scoreFit(jobId: number, resumeId: number, opts: { background: boolean }): Promise<JobFitRow> {
  const db = getDb();
  const resume = getResume(resumeId);
  if (!resume) throw new NonRetryableError(`Resume ${resumeId} not found`);
  const row = db
    .select({ job, companyName: company.name })
    .from(job)
    .innerJoin(company, eq(company.id, job.companyId))
    .where(eq(job.id, jobId))
    .get();
  if (!row) throw new NonRetryableError(`Job ${jobId} not found`);
  assertBudget(opts);

  const model = getSettings("ai").models.fitScore;
  const j = row.job;
  const response = await getClient().messages.parse({
    model,
    max_tokens: 3000,
    // Rubric + resume are identical across every job scored, so they form the cached prefix.
    system: [{ type: "text", text: `${FIT_RUBRIC}\n\n<resume>\n${resumeForPrompt(resume)}\n</resume>`, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Company: ${row.companyName}\nTitle: ${j.title}\nLocations: ${j.locations.join("; ") || "not listed"}\n\n<posting>\n${j.descriptionText}\n</posting>`,
      },
    ],
    output_config: { format: zodOutputFormat(FitResultSchema) },
  });
  recordMessageUsage("fit_score", model, response.usage);
  assertUsableStop(response, "score this job");
  const out = response.parsed_output;
  if (!out) throw new NonRetryableError("Claude returned no fit assessment.");
  const score = Math.max(0, Math.min(100, Math.round(out.score)));
  const values = { jobId, resumeHash: resume.sourceHash, score, data: { ...out, score }, model, scoredAt: new Date() };
  return db
    .insert(jobFit)
    .values(values)
    .onConflictDoUpdate({ target: [jobFit.jobId, jobFit.resumeHash], set: values })
    .returning()
    .get();
}

export function getFit(jobId: number, resumeHash: string): JobFitRow | null {
  return getDb()
    .select()
    .from(jobFit)
    .where(and(eq(jobFit.jobId, jobId), eq(jobFit.resumeHash, resumeHash)))
    .get() ?? null;
}

export function getFitScores(jobIds: number[], resumeHash: string): Map<number, number> {
  if (!jobIds.length) return new Map();
  const rows = getDb()
    .select({ jobId: jobFit.jobId, score: jobFit.score })
    .from(jobFit)
    .where(and(eq(jobFit.resumeHash, resumeHash), inArray(jobFit.jobId, jobIds)))
    .all();
  return new Map(rows.map((r) => [r.jobId, r.score]));
}

