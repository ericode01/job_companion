import { getDb, schema } from "@jd/core/db";
import type { AnswerCategory } from "@jd/core/schema";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { DEFAULT_DECLINE, normalizeQuestion } from "./rules";

const { answerBank, userSetting } = schema;
export type BankAnswer = typeof answerBank.$inferSelect;

const DEFAULTS: { category: AnswerCategory; question: string; answer: string; variants: string[] }[] = [
  {
    category: "work_auth",
    question: "Are you legally authorized to work in the United States?",
    answer: "Yes",
    variants: [
      "are you legally authorized to work in the united states",
      "are you legally authorized to work in the country where this job is located",
      "are you authorized to work in the us",
    ],
  },
  {
    category: "sponsorship",
    question: "Will you now or in the future require visa sponsorship?",
    answer: "No",
    variants: [
      "will you now or in the future require sponsorship for employment visa status",
      "do you now or will you ever require employment sponsorship to work in the country where this job is located",
      "will you require visa sponsorship",
    ],
  },
  { category: "eeo", question: "Gender", answer: DEFAULT_DECLINE, variants: ["gender", "gender identity"] },
  { category: "eeo", question: "Race / ethnicity", answer: DEFAULT_DECLINE, variants: ["race", "race ethnicity", "race ethnicity select all that apply", "ethnicity"] },
  { category: "eeo", question: "Are you Hispanic or Latino?", answer: DEFAULT_DECLINE, variants: ["are you hispanic latino", "hispanic latino"] },
  { category: "eeo", question: "Veteran status", answer: DEFAULT_DECLINE, variants: ["veteran status", "protected veteran status"] },
  { category: "eeo", question: "Disability status", answer: DEFAULT_DECLINE, variants: ["disability status", "do you have a disability"] },
];

/** Inserts a person's starting answers once. Deleting them later doesn't bring them back. */
export function ensureDefaultAnswers(userId: number): void {
  const db = getDb();
  const seeded = db
    .select()
    .from(userSetting)
    .where(and(eq(userSetting.userId, userId), eq(userSetting.key, "answers_seeded")))
    .get();
  if (seeded) return;
  db.transaction((tx) => {
    for (const d of DEFAULTS) {
      tx.insert(answerBank).values({ ...d, userId, variants: [normalizeQuestion(d.question), ...d.variants], scope: "global" }).run();
    }
    tx.insert(userSetting).values({ userId, key: "answers_seeded", value: true }).onConflictDoNothing().run();
  });
}

export function listAnswers(userId: number): BankAnswer[] {
  ensureDefaultAnswers(userId);
  return getDb()
    .select()
    .from(answerBank)
    .where(eq(answerBank.userId, userId))
    .orderBy(answerBank.category, desc(answerBank.useCount))
    .all();
}

/** A person's global answers plus their answers scoped to this job. */
export function answersForJob(userId: number, jobId: number | null): BankAnswer[] {
  ensureDefaultAnswers(userId);
  return getDb()
    .select()
    .from(answerBank)
    .where(
      and(
        eq(answerBank.userId, userId),
        or(eq(answerBank.scope, "global"), jobId === null ? isNull(answerBank.jobId) : eq(answerBank.jobId, jobId)),
      ),
    )
    .all();
}

/** Exact match on normalized wording (canonical or a previously seen variant). Job-scoped answers win. */
export function findExactAnswer(userId: number, label: string, jobId: number | null): BankAnswer | null {
  const norm = normalizeQuestion(label);
  if (!norm) return null;
  const hits = answersForJob(userId, jobId).filter((a) => a.variants.includes(norm) || normalizeQuestion(a.question) === norm);
  return hits.find((h) => h.scope === "job") ?? hits[0] ?? null;
}

export interface SaveAnswerInput {
  question: string;
  answer: string;
  category: AnswerCategory;
  scope: "global" | "job";
  jobId?: number | null;
}

/** Creates an answer, or updates the existing one for the same normalized question and scope. */
export function saveAnswer(userId: number, input: SaveAnswerInput): BankAnswer {
  const db = getDb();
  const norm = normalizeQuestion(input.question);
  const jobId = input.scope === "job" ? (input.jobId ?? null) : null;
  const existing = db
    .select()
    .from(answerBank)
    .where(
      and(
        eq(answerBank.userId, userId),
        eq(answerBank.scope, input.scope),
        jobId === null ? isNull(answerBank.jobId) : eq(answerBank.jobId, jobId),
      ),
    )
    .all()
    .find((a) => a.variants.includes(norm) || normalizeQuestion(a.question) === norm);
  if (existing) {
    return db
      .update(answerBank)
      .set({ answer: input.answer, category: input.category, updatedAt: new Date() })
      .where(eq(answerBank.id, existing.id))
      .returning()
      .get();
  }
  return db
    .insert(answerBank)
    .values({ userId, question: input.question.trim(), answer: input.answer, category: input.category, scope: input.scope, jobId, variants: [norm] })
    .returning()
    .get();
}

export function updateAnswer(userId: number, id: number, patch: { question?: string; answer?: string; category?: AnswerCategory }): BankAnswer | null {
  return (
    getDb()
      .update(answerBank)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(answerBank.id, id), eq(answerBank.userId, userId)))
      .returning()
      .get() ?? null
  );
}

export function deleteAnswer(userId: number, id: number): void {
  getDb().delete(answerBank).where(and(eq(answerBank.id, id), eq(answerBank.userId, userId))).run();
}

/** Remembers a new wording for an answer and counts the use. */
export function recordAnswerUse(id: number, label: string): void {
  const db = getDb();
  const row = db.select().from(answerBank).where(eq(answerBank.id, id)).get();
  if (!row) return;
  const norm = normalizeQuestion(label);
  const variants = norm && !row.variants.includes(norm) ? [...row.variants, norm].slice(-50) : row.variants;
  db.update(answerBank)
    .set({ variants, useCount: sql`${answerBank.useCount} + 1`, lastUsedAt: new Date() })
    .where(eq(answerBank.id, id))
    .run();
}
