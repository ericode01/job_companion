import crypto from "node:crypto";
import path from "node:path";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { fileStore, getProfile, getSettings, ResumeSourceSchema, saveProfile, type ResumeSource } from "@jd/core";
import { getDb, one, returned, schema } from "@jd/core/db";
import { AI_KEY_HINT, assertBudget, forModel, hasApiKey, parseStructured, recordMessageUsage } from "@jd/llm";
import { and, desc, eq } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { assertUsableStop, NonRetryableError, sha1 } from "./util";

const { resume } = schema;
export type Resume = typeof resume.$inferSelect;

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.replace(/[ \t]+\n/g, "\n").trim();
}

export class ResumeUploadError extends Error {}

/** Stores a new master resume PDF and extracts its text. Parsing into sections is queued separately. */
export async function saveMasterResume(userId: number, bytes: Uint8Array, fileName: string): Promise<Resume> {
  if (bytes.byteLength > MAX_RESUME_BYTES) throw new ResumeUploadError("PDF is larger than 10 MB.");
  if (Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new ResumeUploadError("That file isn't a PDF.");
  let text: string;
  try {
    text = await extractPdfText(bytes);
  } catch {
    throw new ResumeUploadError("Couldn't read that PDF. Is it password-protected or corrupted?");
  }
  const filePath = `resumes/${userId}/${crypto.randomUUID()}.pdf`;
  await fileStore().put(filePath, bytes, "application/pdf");
  return await returned(
    getDb()
      .insert(resume)
      .values({
        userId,
        kind: "master",
        fileName: path.basename(fileName).slice(0, 200),
        filePath,
        parsedText: text,
        sourceHash: sha1(text),
        parseStatus: hasApiKey() ? "pending" : "skipped",
        parseError: hasApiKey() ? null : `No API key: add ${AI_KEY_HINT} to .env.local, then parse again.`,
      })
      .returning(),
  );
}

export async function currentMasterResume(userId: number): Promise<Resume | null> {
  return (
    await one(
      getDb()
        .select()
        .from(resume)
        .where(and(eq(resume.userId, userId), eq(resume.kind, "master")))
        .orderBy(desc(resume.id))
        .limit(1),
    ) ?? null
  );
}

export async function listMasterResumes(userId: number): Promise<Resume[]> {
  return await getDb()
    .select()
    .from(resume)
    .where(and(eq(resume.userId, userId), eq(resume.kind, "master")))
    .orderBy(desc(resume.id));
}

/** Internal lookup (worker tasks). Request handlers use ownedResume. */
export async function getResume(id: number): Promise<Resume | null> {
  return await one(getDb().select().from(resume).where(eq(resume.id, id))) ?? null;
}

/** A resume only if it belongs to this person. */
export async function ownedResume(userId: number, id: number): Promise<Resume | null> {
  return await one(getDb().select().from(resume).where(and(eq(resume.id, id), eq(resume.userId, userId)))) ?? null;
}

/** Saves your corrections to the parsed resume. Changing it invalidates fit scores (they are keyed by hash). */
export async function updateResumeSource(id: number, source: ResumeSource): Promise<Resume> {
  const parsed = ResumeSourceSchema.parse(source);
  const row = await one(
    getDb()
      .update(resume)
      .set({ source: parsed, sourceHash: sha1(parsed), parseStatus: "done", parseError: null, updatedAt: new Date() })
      .where(and(eq(resume.id, id)))
      .returning(),
  );
  if (!row) throw new NonRetryableError("Resume not found");
  return row;
}

const PARSE_SYSTEM = `You convert a resume PDF into structured JSON.

Rules:
- Copy text exactly as written. Do not rephrase, summarize, fix grammar, or add anything that isn't on the page.
- Keep bullets in their original order. Give each experience an id "e1", "e2", … in order, and each bullet "e1b1", "e1b2", …; project bullets "p1b1", ….
- Use null for anything not present. Dates stay as written ("Mar 2021", "2019", "Present").
- For two-column layouts, attach sidebar content (skills, education, links) to the right sections rather than mixing it into experience bullets.
- Nothing may be dropped. Every line on the page must land in some field: GPA, minors, and activities under education details; sections that fit nowhere else (entrepreneurial experience, awards, publications, volunteering, languages) go in "additional" with their original heading. Multi-line items stay as one item.`;

export async function parseResume(resumeId: number, opts: { background: boolean }): Promise<Resume> {
  const row = await getResume(resumeId);
  if (!row) throw new NonRetryableError(`Resume ${resumeId} not found`);
  await assertBudget(opts);
  const setting = (await getSettings("ai")).models.resumeParse;
  const { client, model } = forModel(setting);
  const pdf = await fileStore().get(row.filePath);
  if (!pdf) throw new NonRetryableError(`The PDF for resume ${resumeId} is missing. Upload it again.`);
  const data = pdf.toString("base64");
  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    system: PARSE_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
          { type: "text", text: "Extract this resume." },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(ResumeSourceSchema) },
  });
  await recordMessageUsage("resume_parse", setting, response);
  assertUsableStop(response, "parse the resume");
  const parsed = parseStructured(response, ResumeSourceSchema, "resume structure");
  const updated = await updateResumeSource(resumeId, parsed);
  if (row.userId) await prefillProfile(row.userId, parsed);
  return updated;
}

export async function markResumeParseFailed(resumeId: number, error: string): Promise<void> {
  await getDb().update(resume).set({ parseStatus: "failed", parseError: error }).where(eq(resume.id, resumeId));
}

/** Fills empty profile fields from the resume's contact block. Never overwrites what you've entered. */
async function prefillProfile(userId: number, source: ResumeSource): Promise<void> {
  const current = await getProfile(userId);
  const c = source.contact;
  const findLink = (re: RegExp) => c.links.find((l) => re.test(l));
  const links = { ...(current?.links ?? {}) };
  links.linkedin ||= findLink(/linkedin\.com/i);
  links.github ||= findLink(/github\.com/i);
  links.site ||= c.links.find((l) => !/linkedin\.com|github\.com/i.test(l) && /\./.test(l));
  const values = {
    name: current?.name || c.name,
    email: current?.email || c.email,
    phone: current?.phone || c.phone,
    location: current?.location || c.location,
    links,
  };
  await saveProfile(userId, values);
}

/** Compact plain-text rendering used in prompts. */
export function resumeForPrompt(r: Pick<Resume, "source" | "parsedText">): string {
  const s = r.source;
  if (!s) return r.parsedText;
  const lines: string[] = [];
  if (s.summary) lines.push(`SUMMARY\n${s.summary}`);
  if (s.experience.length) {
    lines.push("EXPERIENCE");
    for (const e of s.experience) {
      lines.push(`${e.title}, ${e.company}${e.location ? ` (${e.location})` : ""} ${[e.start, e.end].filter(Boolean).join(" – ")}`);
      for (const b of e.bullets) lines.push(`- ${b.text}`);
    }
  }
  if (s.projects.length) {
    lines.push("PROJECTS");
    for (const p of s.projects) {
      lines.push(`${p.name}${p.description ? `: ${p.description}` : ""}`);
      for (const b of p.bullets) lines.push(`- ${b.text}`);
    }
  }
  if (s.skills.length) lines.push(`SKILLS\n${s.skills.map((k) => `${k.category ? `${k.category}: ` : ""}${k.items.join(", ")}`).join("\n")}`);
  if (s.education.length) {
    lines.push("EDUCATION");
    for (const e of s.education) {
      lines.push([e.degree, e.field, e.school, e.end].filter(Boolean).join(", "));
      for (const d of e.details ?? []) lines.push(`- ${d}`);
    }
  }
  if (s.certifications.length) lines.push(`CERTIFICATIONS\n${s.certifications.join("\n")}`);
  for (const a of s.additional ?? []) lines.push(`${a.heading.toUpperCase()}\n${a.items.map((i) => `- ${i}`).join("\n")}`);
  return lines.join("\n");
}
