import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getProfile, getSettings, type FormQuestion, type QuestionAnswer } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import type { AnswerCategory } from "@jd/core/schema";
import { assertBudget, forModel, hasApiKey, parseStructured, recordMessageUsage } from "@jd/llm";
import { getResume, resumeForPrompt } from "@jd/research";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getApplication } from "./application";
import { answersForJob, findExactAnswer, recordAnswerUse, type BankAnswer } from "./bank";
import { addToInbox } from "./inbox";
import { isConsentField, isEeoQuestion, normalizeQuestion, pickOptions, standardCategoryOf } from "./rules";

const CHOICE_KINDS = new Set(["select", "multiselect", "radio", "checkbox", "boolean"]);
const MULTI_KINDS = new Set(["multiselect", "checkbox"]);

function eeoCategoryFor(label: string): string {
  const l = label.toLowerCase();
  if (/hispanic|latin/.test(l)) return "are you hispanic latino";
  if (/race|ethnic/.test(l)) return "race ethnicity";
  if (/veteran/.test(l)) return "veteran status";
  if (/disabilit/.test(l)) return "disability status";
  return "gender";
}

/** Turns a stored answer into a value for this question's control, or null if it can't be mapped. */
function applyAnswer(q: FormQuestion, answer: string): string | string[] | null {
  if (!CHOICE_KINDS.has(q.kind) || q.options.length === 0) return answer;
  const picked = pickOptions(answer, q.options);
  if (picked.length === 0) return null;
  return MULTI_KINDS.has(q.kind) ? picked : picked[0]!;
}

const LlmResolution = z.object({
  items: z.array(
    z.object({
      index: z.number(),
      type: z.enum(["recurring_fact", "job_specific", "consent", "eeo", "unknown"]),
      category: z.enum(["work_auth", "sponsorship", "relocation", "salary", "eeo", "logistics", "custom"]),
      bankId: z.number().nullable().describe("id of a saved answer that answers this same question, else null"),
      answer: z.string().nullable().describe("free-text answer, or null to leave blank"),
      selectedOptions: z.array(z.string()).describe("exact option strings for choice questions; empty otherwise"),
      confidence: z.enum(["high", "medium", "low"]),
      note: z.string().nullable().describe("short reason shown to the user when review is needed"),
    }),
  ),
});

const SYSTEM = `You help a job seeker fill an online job application. For each form question, decide how to answer using ONLY the saved answers, profile, and resume provided.

Types:
- consent: agreements, privacy acknowledgements, attestations, marketing opt-ins, "I certify…". Never answer these: answer null, selectedOptions [].
- eeo: demographic questions (gender, race, veteran, disability, orientation). Use the matching saved answer if any; otherwise answer null.
- recurring_fact: questions many employers ask with the same answer (work authorization, sponsorship, relocation, salary expectations, notice period, how did you hear about us, willingness to work onsite, years of experience with X, current company/title, pronouns, preferred name).
  - If a saved answer covers it (same meaning, even with different wording), set bankId and use that answer.
  - Else, if the profile or resume states the fact directly (current employer, years of experience computed from resume dates, degree), answer it with confidence "medium".
  - Else answer null (it will be asked of the user once and saved). Never guess salary, relocation, start dates, notice period, referral sources, postal codes, language fluency, or anything else not written down. Don't derive one value from another (no ZIP code from a street address).
- job_specific: open-ended questions about this company or role (why us, describe a relevant project, what interests you). Draft 60–150 words in first person using only resume facts; confidence "low" (the user will review).
- unknown: anything else you can't answer from the provided facts: answer null.

For choice questions, selectedOptions must contain exact strings from the options list (several only for multi-select). If none fits, leave it empty and answer null.`;

export interface ResolveResult {
  answers: QuestionAnswer[];
  inboxAdded: number;
}

/**
 * Answers the custom questions on an application form.
 * Order: exact saved answer → rules (consent, EEO) → one Claude call for the rest.
 * Questions that need a recurring fact nobody has provided go to the Answers inbox.
 */
export async function resolveQuestions(userId: number, applicationId: number, questions: FormQuestion[]): Promise<ResolveResult> {
  const app = getApplication(userId, applicationId);
  if (!app) throw new Error("Application not found");
  // The extension only fills forms for jobs it knows; applications found in email have no form here.
  if (app.jobId === null) throw new Error("This application isn't linked to a job posting");
  const jobId = app.jobId;
  const out = new Map<number, QuestionAnswer>();
  const base = (q: FormQuestion): Omit<QuestionAnswer, "value" | "source" | "status"> => ({
    index: q.index,
    category: "custom",
    note: null,
    bankId: null,
    saveable: true,
  });
  let inboxAdded = 0;
  const remaining: FormQuestion[] = [];

  for (const q of questions) {
    if (q.kind === "file") continue;
    if (isConsentField(q.label, q.options)) {
      out.set(q.index, { ...base(q), value: null, source: "rule", status: "needs_user", note: "Agreements and consents are left for you to decide.", saveable: false });
      continue;
    }
    const standard = standardCategoryOf(q.label);
    const exact =
      findExactAnswer(userId, q.label, jobId) ??
      (isEeoQuestion(q.label) ? findExactAnswer(userId, eeoCategoryFor(q.label), jobId) : null) ??
      (standard ? (answersForJob(userId, jobId).find((a) => a.category === standard && a.scope === "global") ?? null) : null);
    if (exact) {
      const value = applyAnswer(q, exact.answer);
      if (value !== null) {
        recordAnswerUse(exact.id, q.label);
        out.set(q.index, { ...base(q), value, source: "bank", status: "filled", category: exact.category, bankId: exact.id });
        continue;
      }
    }
    if (isEeoQuestion(q.label)) {
      out.set(q.index, { ...base(q), value: null, source: "rule", status: "needs_user", category: "eeo", note: "No matching option for your saved demographic answer." });
      continue;
    }
    remaining.push(q);
  }

  if (remaining.length > 0 && hasApiKey()) {
    try {
      const { items: resolutions, facts } = await askClaude(userId, app.resumeId, jobId, remaining);
      const bank = new Map(answersForJob(userId, jobId).map((b) => [b.id, b]));
      for (const q of remaining) {
        const r = resolutions.find((x) => x.index === q.index);
        const answer = buildFromResolution(q, r, bank, facts);
        if (answer.status === "needs_user" && r && r.type === "recurring_fact") {
          addToInbox(userId, { question: q.label, kind: q.kind, options: q.options, category: r.category as AnswerCategory, jobId });
          inboxAdded++;
        }
        out.set(q.index, answer);
      }
    } catch (err) {
      for (const q of remaining) {
        out.set(q.index, { ...base(q), value: null, source: "none", status: "needs_user", note: `Couldn't get suggestions: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  } else {
    for (const q of remaining) {
      out.set(q.index, { ...base(q), value: null, source: "none", status: "needs_user", note: hasApiKey() ? null : "Add an API key to get suggestions." });
    }
  }

  return { answers: questions.filter((q) => out.has(q.index)).map((q) => out.get(q.index)!), inboxAdded };
}

/**
 * Grounding check for answers "derived" from the resume: every number in the answer must appear in
 * the facts the model was given. Catches invented ZIP codes, years, and salaries.
 */
export function isGrounded(answer: string, facts: string): boolean {
  const haystack = facts.replace(/[,\s]/g, "");
  return (answer.match(/\d[\d,.]*/g) ?? []).every((n) => haystack.includes(n.replace(/[,.]$/, "").replace(/,/g, "")));
}

function buildFromResolution(
  q: FormQuestion,
  r: z.infer<typeof LlmResolution>["items"][number] | undefined,
  bank: Map<number, BankAnswer>,
  facts: string,
): QuestionAnswer {
  const empty = (note: string | null, category: QuestionAnswer["category"] = "custom", saveable = true): QuestionAnswer => ({
    index: q.index,
    value: null,
    source: "none",
    status: "needs_user",
    category,
    note,
    bankId: null,
    saveable,
  });
  if (!r) return empty(null);
  const category = r.category;
  if (r.type === "consent") return { ...empty("Agreements and consents are left for you to decide.", category, false), source: "rule" };

  const saved = r.bankId !== null ? bank.get(r.bankId) : undefined;
  if (saved) {
    const value = applyAnswer(q, saved.answer);
    if (value !== null) {
      recordAnswerUse(saved.id, q.label);
      return { index: q.index, value, source: "bank", status: "filled", category: saved.category, note: `Matched your saved answer to “${saved.question}”.`, bankId: saved.id, saveable: true };
    }
  }

  let value: string | string[] | null = null;
  if (CHOICE_KINDS.has(q.kind) && q.options.length) {
    const valid = r.selectedOptions.filter((o) => q.options.includes(o));
    if (valid.length) value = MULTI_KINDS.has(q.kind) ? valid : valid[0]!;
  } else if (r.answer?.trim()) {
    value = r.answer.trim();
    if (r.type !== "job_specific" && !isGrounded(value, facts)) {
      return empty("Not stated in your profile or resume. Answer it once and it will be reused.", category, true);
    }
  }
  if (value === null) {
    return empty(r.type === "recurring_fact" ? "Answer once in the panel or the Answers inbox; it will be reused." : r.note, category, r.type !== "job_specific");
  }
  const draft = r.type === "job_specific";
  return {
    index: q.index,
    value,
    source: draft ? "ai_draft" : "ai_derived",
    status: "review",
    category,
    note: r.note ?? (draft ? "Draft written from your resume. Edit before submitting." : "Filled from your resume. Please check."),
    bankId: null,
    saveable: !draft,
  };
}

async function askClaude(userId: number, resumeId: number | null, jobId: number, questions: FormQuestion[]) {
  assertBudget({ background: false });
  const db = getDb();
  const resume = resumeId ? getResume(resumeId) : null;
  const profile = getProfile(userId);
  const job = db
    .select({ title: schema.job.title, company: schema.company.name, description: schema.job.descriptionText })
    .from(schema.job)
    .innerJoin(schema.company, eq(schema.company.id, schema.job.companyId))
    .where(eq(schema.job.id, jobId))
    .get();
  const bank = answersForJob(userId, jobId).map((b) => ({ id: b.id, question: b.question, answer: b.answer, category: b.category }));
  const profileFacts = JSON.stringify({ name: profile?.name, location: profile?.location, links: profile?.links, about: profile?.about ?? undefined });
  const resumeText = resume ? resumeForPrompt(resume) : "none";
  const setting = getSettings("ai").models.extraction;
  const { client, model } = forModel(setting);
  const response = await client.messages.create({
    model,
    max_tokens: 6000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `<saved_answers>\n${JSON.stringify(bank)}\n</saved_answers>`,
          `<profile>\n${profileFacts}\n</profile>`,
          `<resume>\n${resumeText}\n</resume>`,
          `<job>\nCompany: ${job?.company}\nTitle: ${job?.title}\n${job?.description.slice(0, 6000) ?? ""}\n</job>`,
          `Today: ${new Date().toISOString().slice(0, 10)}`,
          `<questions>\n${JSON.stringify(questions.map((q) => ({ index: q.index, label: q.label, kind: q.kind, required: q.required, options: q.options, description: q.description ?? undefined })))}\n</questions>`,
        ].join("\n\n"),
      },
    ],
    output_config: { format: zodOutputFormat(LlmResolution) },
  });
  recordMessageUsage("form_answers", setting, response);
  if (response.stop_reason === "refusal") throw new Error("no suggestions returned");
  const suggested = parseStructured(response, LlmResolution, "answer suggestions");
  return { items: suggested.items, facts: `${profileFacts}\n${resumeText}\n${JSON.stringify(bank)}` };
}

export { normalizeQuestion };
