import { getProfile, getSettings } from "@jd/core";
import { getDb, one, schema } from "@jd/core/db";
import { assertBudget, forModel, recordMessageUsage } from "@jd/llm";
import { eq } from "drizzle-orm";
import { getCompanyProfile } from "./company";
import { getJobAnalysis } from "./job";
import { getResume, resumeForPrompt } from "./resume";
import type Anthropic from "@anthropic-ai/sdk";
import { assertUsableStop, NonRetryableError, textOf, unsupportedClaims } from "./util";

const SYSTEM = `You write cover letters for a software engineer applying to a specific job.

Rules:
- 220–320 words, 3–4 short paragraphs, plain text. No placeholders, no markdown, no address block or date.
- Start with "Dear Hiring Team," (or the hiring manager's name if the posting gives one). End with "Sincerely," and the candidate's name.
- Only use experience, numbers, and skills that appear in the resume. Never invent employers, titles, metrics, or technologies.
- Connect 2–3 concrete accomplishments from the resume to the posting's most important requirements.
- Mention something specific about the company or product only if it's in the provided company notes or posting.
- Confident and direct; avoid clichés like "I am writing to express my interest" and "passionate".
- If a writing sample is given, match its voice and sentence rhythm. Don't copy its sentences, and don't reuse its facts unless the resume or "about me" also states them.`;

export async function generateCoverLetter(applicationId: number, opts: { background: boolean }): Promise<string> {
  const db = getDb();
  const app = await one(db.select().from(schema.application).where(eq(schema.application.id, applicationId)));
  if (!app) throw new NonRetryableError(`Application ${applicationId} not found`);
  const jobId = app.jobId;
  if (jobId === null) throw new NonRetryableError("This application isn't linked to a job posting, so there's nothing to write a letter for.");
  const row = await one(
    db
      .select({ job: schema.job, company: schema.company })
      .from(schema.job)
      .innerJoin(schema.company, eq(schema.company.id, schema.job.companyId))
      .where(eq(schema.job.id, jobId)),
  );
  if (!row) throw new NonRetryableError("Job not found");
  const resume = app.resumeId ? await getResume(app.resumeId) : null;
  if (!resume) throw new NonRetryableError("Upload your resume before generating a cover letter.");
  await assertBudget(opts);

  const profile = (await getCompanyProfile(row.company.id))?.data;
  const analysis = (await getJobAnalysis(jobId))?.data;
  const me = app.userId ? await getProfile(app.userId) : null;
  const name = resume.source?.contact.name ?? me?.name ?? "";
  const companyNotes = profile
    ? [profile.overview, ...profile.products.map((p) => `${p.name}: ${p.description}`)].filter(Boolean).join("\n")
    : "none";

  const setting = (await getSettings("ai")).models.writing;
  const { client, model } = forModel(setting);
  const resumeText = resumeForPrompt(resume);
  const today = new Date().toISOString().slice(0, 10);
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        `Candidate name: ${name}`,
        `Today: ${today}`,
        `<resume>\n${resumeText}\n</resume>`,
        me?.about ? `<about_me>\n${me.about.slice(0, 4000)}\n</about_me>` : "",
        me?.writingSample ? `<writing_sample>\n${me.writingSample.slice(0, 6000)}\n</writing_sample>` : "",
        `Company: ${row.company.name}`,
        `<company_notes>\n${companyNotes}\n</company_notes>`,
        `Role: ${row.job.title}`,
        analysis ? `Key requirements: ${[...analysis.mustHave, ...analysis.niceToHave].join("; ")}` : "",
        `<posting>\n${row.job.descriptionText}\n</posting>`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
  // "About me" is the candidate's own statement, so its facts count; the writing sample is voice only.
  const facts = `${resumeText}\n${me?.about ?? ""}\n${companyNotes}\n${row.job.descriptionText}\n${name}`;

  const write = async () => {
    const response = await client.messages.create({ model, max_tokens: 4000, system: SYSTEM, messages });
    await recordMessageUsage("cover_letter", setting, response);
    assertUsableStop(response, "write the cover letter");
    return { response, letter: textOf(response).trim() };
  };

  let { response, letter } = await write();
  let unsupported = unsupportedClaims(letter, facts);
  if (unsupported.length) {
    // One correction pass: name the unsupported claims and ask for a rewrite without them.
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: `These details aren't stated in the resume, company notes, or posting: ${unsupported.join(", ")}. Rewrite the full letter without them (use the resume's exact figures, and don't state years of experience unless the resume says it). Reply with only the letter.`,
    });
    ({ response, letter } = await write());
    unsupported = unsupportedClaims(letter, facts);
  }
  if (letter.length < 200) throw new NonRetryableError("The cover letter came back empty. Try again.");
  await db.update(schema.application)
    .set({ coverLetter: letter, coverLetterWarnings: unsupported, updatedAt: new Date() })
    .where(eq(schema.application.id, applicationId));
  return letter;
}
