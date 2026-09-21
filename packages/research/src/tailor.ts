import crypto from "node:crypto";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { fileStore, getSettings, TailoredResumeSchema, type ResumeChange, type ResumeSource, type TailoredResume } from "@jd/core";
import { getDb, one, returned, schema } from "@jd/core/db";
import { assertBudget, forModel, parseStructured, recordMessageUsage } from "@jd/llm";
import { and, desc, eq } from "drizzle-orm";
import { getJobAnalysis } from "./job";
import { currentMasterResume, getResume, resumeForPrompt, type Resume } from "./resume";
import { renderResumePdf, resumeToText } from "./resume-pdf";
import { assertUsableStop, NonRetryableError, sha1, unsupportedClaims } from "./util";

const SYSTEM = `You tailor an existing resume to one job posting.

Hard rules — the resume must stay true:
- Every bullet must come from a bullet in the master resume. Give its sourceId and keep the same facts: same employer, same project, same metrics, same technologies.
- You may reword for clarity and the posting's vocabulary, reorder bullets, and drop bullets that don't help. You may not invent work, skills, tools, numbers, dates, or scope.
- Never change a number, and never add one that isn't in the source bullet.
- Only use a technology name if it appears in that bullet or elsewhere in the master resume.
- Don't state a total number of years of experience unless the master resume states it.
- Keep every role. If a role has no relevant bullets, keep its single strongest bullet.

What to aim for:
- Lead each role with the bullets closest to the posting's must-haves.
- Mirror the posting's wording when it means the same thing as the resume's wording (e.g. "distributed storage" vs "storage platform"), without claiming new experience.
- Rewrite the summary for this role in 2–3 lines, using only facts from the resume. Return null to drop it.
- Re-order skills so the ones this job asks for come first. Only skills already listed.
- changes: at most 15 entries for the edits that matter (rewritten summary, reworded bullet, dropped bullet, reordered skills). Give the bullet's sourceId and the new text only — never repeat the original text.`;

export interface TailorResult {
  resume: Resume;
  warnings: string[];
}

const contentWords = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9+#/ ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );

/** Share of the reworded bullet's words that also appear in its source bullet. */
export function overlapRatio(after: string, before: string): number {
  const a = contentWords(after);
  const b = contentWords(before);
  if (a.size === 0) return 1;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / a.size;
}

/**
 * Rebuilds a full resume from the tailored parts, keeping everything the model wasn't allowed to touch.
 * Anything that fails the truthfulness checks is reverted to the master text and reported.
 */
export function applyTailoring(master: ResumeSource, tailored: TailoredResume): { source: ResumeSource; warnings: string[]; changes: ResumeChange[] } {
  const warnings: string[] = [];
  const masterText = resumeToText(master);
  const bulletById = new Map(master.experience.flatMap((e) => e.bullets.map((b) => [b.id, { text: b.text, role: `${e.title}, ${e.company}` }])));

  const experience = master.experience.map((role) => {
    const t = tailored.experience.find((x) => x.id === role.id);
    if (!t) return role;
    const bullets = t.bullets.flatMap((b, i) => {
      const src = bulletById.get(b.sourceId);
      if (!src) {
        warnings.push(`Dropped a bullet in “${role.title}, ${role.company}” that didn't come from your resume: “${b.text.slice(0, 80)}…”`);
        return [];
      }
      const invented = unsupportedClaims(b.text, `${src.text}\n${masterText}`);
      const drifted = overlapRatio(b.text, src.text) < 0.4;
      if (invented.length || drifted) {
        warnings.push(
          invented.length
            ? `Kept your original wording in “${role.title}, ${role.company}”: the rewrite added ${invented.join(", ")}.`
            : `Kept your original wording in “${role.title}, ${role.company}”: the rewrite drifted too far from “${src.text.slice(0, 60)}…”.`,
        );
        return [{ id: `${role.id}b${i + 1}`, text: src.text }];
      }
      return [{ id: `${role.id}b${i + 1}`, text: b.text }];
    });
    if (bullets.length === 0) {
      warnings.push(`“${role.title}, ${role.company}” kept its first bullet because the tailored version had none.`);
      return { ...role, bullets: role.bullets.slice(0, 1) };
    }
    return { ...role, bullets };
  });

  const known = new Set(master.skills.flatMap((k) => k.items.map((i) => i.toLowerCase())));
  const skills = tailored.skills
    .map((k) => {
      const items = k.items.filter((i) => {
        if (known.has(i.toLowerCase())) return true;
        warnings.push(`Removed the skill “${i}”, which isn't on your master resume.`);
        return false;
      });
      return { category: k.category, items };
    })
    .filter((k) => k.items.length > 0);
  const missing = master.skills.flatMap((k) => k.items).filter((i) => !skills.some((k) => k.items.some((x) => x.toLowerCase() === i.toLowerCase())));
  if (missing.length) skills.push({ category: "Also", items: missing });

  let summary = tailored.summary;
  if (summary) {
    const invented = unsupportedClaims(summary, masterText);
    if (invented.length) {
      warnings.push(`Kept your original summary: the rewrite added ${invented.join(", ")}.`);
      summary = master.summary;
    }
  }

  // Fill in the original text from the master resume so the review shows before and after.
  const changes: ResumeChange[] = tailored.changes.map((c) => ({
    section: c.section,
    before: c.sourceId ? (bulletById.get(c.sourceId)?.text ?? null) : c.section.toLowerCase() === "summary" ? master.summary : null,
    after: c.after,
    reason: c.reason,
  }));
  return { source: { ...master, summary, experience, skills: skills.length ? skills : master.skills }, warnings, changes };
}

/** A cut-off response fails JSON parsing inside the SDK; say what actually happened. */
/** Writes a tailored resume for one job and renders its PDF. */
export async function tailorResume(userId: number, jobId: number, opts: { background: boolean }): Promise<TailorResult> {
  const db = getDb();
  const master = await currentMasterResume(userId);
  if (!master?.source) throw new NonRetryableError("Upload and parse your master resume first.");
  const row = await one(
    db
      .select({ job: schema.job, company: schema.company })
      .from(schema.job)
      .innerJoin(schema.company, eq(schema.company.id, schema.job.companyId))
      .where(eq(schema.job.id, jobId)),
  );
  if (!row) throw new NonRetryableError(`Job ${jobId} not found`);
  await assertBudget(opts);

  const masterSource = master.source;
  const analysis = (await getJobAnalysis(jobId))?.data;
  const setting = (await getSettings("ai")).models.writing;
  const { client, model } = forModel(setting);
  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `<master_resume>\n${JSON.stringify({ summary: masterSource.summary, experience: masterSource.experience, skills: masterSource.skills })}\n</master_resume>`,
          `Company: ${row.company.name}`,
          `Role: ${row.job.title}`,
          analysis ? `Must have: ${analysis.mustHave.join("; ")}\nNice to have: ${analysis.niceToHave.join("; ")}\nTech: ${analysis.techStack.join(", ")}` : "",
          `<posting>\n${row.job.descriptionText.slice(0, 12000)}\n</posting>`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    output_config: { format: zodOutputFormat(TailoredResumeSchema) },
  });
  await recordMessageUsage("tailor_resume", setting, response);
  assertUsableStop(response, "tailor the resume");
  let tailored: TailoredResume;
  try {
    tailored = parseStructured(response, TailoredResumeSchema, "tailored resume");
  } catch {
    // Overwhelmingly this is the JSON being cut off at max_tokens on a long resume.
    throw new NonRetryableError("The tailored resume came back incomplete (too long). Try again; if it keeps failing, shorten your master resume.");
  }

  const { source, warnings, changes } = applyTailoring(masterSource, tailored);
  const filePath = `resumes/${userId}/tailored-${jobId}-${crypto.randomUUID()}.pdf`;
  await fileStore().put(filePath, await renderResumePdf(source), "application/pdf");

  const name = (source.contact.name ?? "Resume").replace(/[^\w .-]+/g, "").trim();
  const values = {
    userId,
    kind: "tailored" as const,
    baseResumeId: master.id,
    jobId,
    fileName: `${name} - ${row.company.name}.pdf`.replace(/\s+/g, " "),
    filePath,
    parsedText: resumeToText(source),
    source,
    sourceHash: sha1(source),
    parseStatus: "done" as const,
    status: "draft" as const,
    changeLog: changes,
    truthWarnings: warnings,
    updatedAt: new Date(),
  };
  const existing = await one(
    db
      .select()
      .from(schema.resume)
      .where(and(eq(schema.resume.userId, userId), eq(schema.resume.kind, "tailored"), eq(schema.resume.jobId, jobId)))
      .orderBy(desc(schema.resume.id)),
  );
  const resume = existing
    ? await returned(db.update(schema.resume).set(values).where(eq(schema.resume.id, existing.id)).returning())
    : await returned(db.insert(schema.resume).values(values).returning());
  if (existing && existing.filePath !== filePath) await fileStore().remove(existing.filePath);
  return { resume, warnings };
}

export async function tailoredResumeFor(userId: number, jobId: number): Promise<Resume | null> {
  return (
    await one(
      getDb()
        .select()
        .from(schema.resume)
        .where(and(eq(schema.resume.userId, userId), eq(schema.resume.kind, "tailored"), eq(schema.resume.jobId, jobId)))
        .orderBy(desc(schema.resume.id)),
    ) ?? null
  );
}

/** Re-renders the PDF after you edit a tailored resume by hand. */
export async function rerenderResume(resumeId: number): Promise<void> {
  const r = await getResume(resumeId);
  if (!r?.source || r.kind !== "tailored") return;
  await fileStore().put(r.filePath, await renderResumePdf(r.source), "application/pdf");
  await getDb().update(schema.resume).set({ parsedText: resumeToText(r.source), status: "approved", updatedAt: new Date() }).where(eq(schema.resume.id, resumeId));
}

export { resumeForPrompt };
