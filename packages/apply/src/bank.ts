import { getDb, one, returned, schema } from "@jd/core/db";
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
export async function ensureDefaultAnswers(userId: number): Promise<void> {
  const db = getDb();
  const seeded = await one(
    db
      .select()
      .from(userSetting)
      .where(and(eq(userSetting.userId, userId), eq(userSetting.key, "answers_seeded"))),
  );
  if (seeded) return;
  await db.transaction(async (tx) => {
    for (const d of DEFAULTS) {
      await tx.insert(answerBank).values({ ...d, userId, variants: [normalizeQuestion(d.question), ...d.variants], scope: "global" });
    }
    await tx.insert(userSetting).values({ userId, key: "answers_seeded", value: true }).onConflictDoNothing();
  });
}

export async function listAnswers(userId: number): Promise<BankAnswer[]> {
  await ensureDefaultAnswers(userId);
  return await getDb()
    .select()
    .from(answerBank)
    .where(eq(answerBank.userId, userId))
    .orderBy(answerBank.category, desc(answerBank.useCount));
}

/** A person's global answers plus their answers scoped to this job. */
export async function answersForJob(userId: number, jobId: number | null): Promise<BankAnswer[]> {
  await ensureDefaultAnswers(userId);
  return await getDb()
    .select()
    .from(answerBank)
    .where(
      and(
        eq(answerBank.userId, userId),
        or(eq(answerBank.scope, "global"), jobId === null ? isNull(answerBank.jobId) : eq(answerBank.jobId, jobId)),
      ),
    );
}

/** Exact match on normalized wording (canonical or a previously seen variant). Job-scoped answers win. */
export async function findExactAnswer(userId: number, label: string, jobId: number | null): Promise<BankAnswer | null> {
  const norm = normalizeQuestion(label);
  if (!norm) return null;
  const hits = (await answersForJob(userId, jobId)).filter((a) => a.variants.includes(norm) || normalizeQuestion(a.question) === norm);
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
export async function saveAnswer(userId: number, input: SaveAnswerInput): Promise<BankAnswer> {
  const db = getDb();
  const norm = normalizeQuestion(input.question);
  const jobId = input.scope === "job" ? (input.jobId ?? null) : null;
  const existing = (
    await db
      .select()
      .from(answerBank)
      .where(
        and(
          eq(answerBank.userId, userId),
          eq(answerBank.scope, input.scope),
          jobId === null ? isNull(answerBank.jobId) : eq(answerBank.jobId, jobId),
        ),
      )
  ).find((a) => a.variants.includes(norm) || normalizeQuestion(a.question) === norm);
  if (existing) {
    return await returned(
      db
        .update(answerBank)
        .set({ answer: input.answer, category: input.category, updatedAt: new Date() })
        .where(eq(answerBank.id, existing.id))
        .returning(),
    );
  }
  return await returned(
    db
      .insert(answerBank)
      .values({ userId, question: input.question.trim(), answer: input.answer, category: input.category, scope: input.scope, jobId, variants: [norm] })
      .returning(),
  );
}

export async function updateAnswer(userId: number, id: number, patch: { question?: string; answer?: string; category?: AnswerCategory }): Promise<BankAnswer | null> {
  return (
    await one(
      getDb()
        .update(answerBank)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(answerBank.id, id), eq(answerBank.userId, userId)))
        .returning(),
    ) ?? null
  );
}

export async function deleteAnswer(userId: number, id: number): Promise<void> {
  await getDb().delete(answerBank).where(and(eq(answerBank.id, id), eq(answerBank.userId, userId)));
}

/** Remembers a new wording for an answer and counts the use. */
export async function recordAnswerUse(id: number, label: string): Promise<void> {
  const db = getDb();
  const row = await one(db.select().from(answerBank).where(eq(answerBank.id, id)));
  if (!row) return;
  const norm = normalizeQuestion(label);
  const variants = norm && !row.variants.includes(norm) ? [...row.variants, norm].slice(-50) : row.variants;
  await db.update(answerBank)
    .set({ variants, useCount: sql`${answerBank.useCount} + 1`, lastUsedAt: new Date() })
    .where(eq(answerBank.id, id));
}
