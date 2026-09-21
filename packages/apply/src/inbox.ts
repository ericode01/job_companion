import { getDb, one, returned, schema } from "@jd/core/db";
import type { AnswerCategory } from "@jd/core/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { saveAnswer } from "./bank";
import { normalizeQuestion } from "./rules";

const { questionInbox } = schema;
export type InboxItem = typeof questionInbox.$inferSelect;

export async function addToInbox(userId: number, input: {
  question: string;
  kind: string;
  options: string[];
  category: AnswerCategory;
  jobId: number | null;
  suggestedAnswer?: string | null;
}): Promise<InboxItem> {
  const db = getDb();
  const normalized = normalizeQuestion(input.question);
  return await returned(
    db
      .insert(questionInbox)
      .values({
        userId,
        normalized,
        question: input.question.trim(),
        kind: input.kind,
        options: input.options,
        category: input.category,
        firstJobId: input.jobId,
        lastJobId: input.jobId,
        suggestedAnswer: input.suggestedAnswer ?? null,
      })
      .onConflictDoUpdate({
        target: [questionInbox.userId, questionInbox.normalized],
        set: {
          seenCount: sql`${questionInbox.seenCount} + 1`,
          lastJobId: input.jobId,
          options: input.options,
          // Answered questions reappear only if they come back unanswered (e.g. answer deleted).
          status: sql`case when ${questionInbox.status} = 'ignored' then 'ignored' else 'pending' end`,
          updatedAt: new Date(),
        },
      })
      .returning(),
  );
}

export async function listInbox(userId: number, status: InboxItem["status"] = "pending"): Promise<InboxItem[]> {
  return await getDb()
    .select()
    .from(questionInbox)
    .where(and(eq(questionInbox.userId, userId), eq(questionInbox.status, status)))
    .orderBy(desc(questionInbox.seenCount), desc(questionInbox.updatedAt));
}

export async function pendingInboxCount(userId: number): Promise<number> {
  return (
    (
      await one(
        getDb()
          .select({ n: sql<number>`count(*)`.mapWith(Number) })
          .from(questionInbox)
          .where(and(eq(questionInbox.userId, userId), eq(questionInbox.status, "pending"))),
      )
    )?.n ?? 0
  );
}

/** Answers an inbox question: saves it to the bank and closes the inbox item. */
export async function answerInboxItem(userId: number, id: number, answer: string, scope: "global" | "job") {
  const db = getDb();
  const item = await one(
    db
      .select()
      .from(questionInbox)
      .where(and(eq(questionInbox.id, id), eq(questionInbox.userId, userId))),
  );
  if (!item) return null;
  const saved = await saveAnswer(userId, { question: item.question, answer, category: item.category, scope, jobId: scope === "job" ? item.lastJobId : null });
  await db.update(questionInbox).set({ status: "answered", updatedAt: new Date() }).where(eq(questionInbox.id, id));
  return saved;
}

export async function setInboxStatus(userId: number, id: number, status: InboxItem["status"]): Promise<void> {
  await getDb()
    .update(questionInbox)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(questionInbox.id, id), eq(questionInbox.userId, userId)));
}

export async function resolveInboxByQuestion(userId: number, question: string): Promise<void> {
  await getDb()
    .update(questionInbox)
    .set({ status: "answered", updatedAt: new Date() })
    .where(and(eq(questionInbox.userId, userId), eq(questionInbox.normalized, normalizeQuestion(question))));
}
