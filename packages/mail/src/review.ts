import { type EmailKind, type InterviewRound } from "@jd/core";
import { getDb, one, schema } from "@jd/core/db";
import { and, eq } from "drizzle-orm";
import { companyFromSender } from "./classify";
import { trackedApplications } from "./link";
import { applyToPipeline, getEmail } from "./process";

export type EmailAction =
  | { type: "done"; done: boolean }
  /** "Yes, that's right": act on it as classified, creating the application if there isn't one. */
  | { type: "confirm" }
  /** It's about this application (or: add it to the pipeline as a new one). */
  | { type: "assign"; applicationId: number | "new" }
  /** Correct what the email is. */
  | { type: "correct"; kind?: EmailKind; round?: InterviewRound | null }
  /** Not a job email, or not worth acting on. */
  | { type: "dismiss" };

export async function ownEmail(userId: number, emailId: number) {
  const row = await getEmail(emailId);
  return row && row.userId === userId ? row : null;
}

/** Applies a person's decision about an email. Returns false if it isn't theirs. */
export async function reviewEmail(userId: number, emailId: number, action: EmailAction): Promise<boolean> {
  const row = await ownEmail(userId, emailId);
  if (!row) return false;
  const db = getDb();
  const set = async (patch: Partial<typeof schema.emailMessage.$inferInsert>) => await db.update(schema.emailMessage).set(patch).where(eq(schema.emailMessage.id, emailId));

  switch (action.type) {
    case "done":
      await set({ actionDoneAt: action.done ? new Date() : null });
      return true;
    case "dismiss":
      await set({ reviewState: "dismissed" });
      return true;
    case "confirm": {
      const companyName = row.companyName ?? (row.applicationId ? null : companyFromSender(row.fromName, row.fromAddress));
      if (companyName !== row.companyName) await set({ companyName });
      await applyToPipeline({ ...row, companyName }, await trackedApplications(userId), { confirmedByPerson: true, createIfMissing: true, forceApplicationId: row.applicationId ?? undefined });
      await set({ reviewState: "confirmed" });
      return true;
    }
    case "assign": {
      if (action.applicationId === "new") {
        const companyName = row.companyName ?? companyFromSender(row.fromName, row.fromAddress) ?? "Unknown company";
        await set({ applicationId: null, companyName });
        await applyToPipeline({ ...row, companyName, applicationId: null, threadId: null }, [], { confirmedByPerson: true, createIfMissing: true });
      } else {
        const mine = await one(
          db
            .select({ id: schema.application.id })
            .from(schema.application)
            .where(and(eq(schema.application.id, action.applicationId), eq(schema.application.userId, userId))),
        );
        if (!mine) return false;
        await applyToPipeline(row, await trackedApplications(userId), { confirmedByPerson: true, forceApplicationId: mine.id });
      }
      await set({ reviewState: "confirmed" });
      return true;
    }
    case "correct": {
      const kind = action.kind ?? row.kind;
      const round = action.round !== undefined ? action.round : row.round;
      await set({ kind, round, reviewState: "confirmed" });
      if (kind === "unrelated") {
        await set({ reviewState: "dismissed" });
        return true;
      }
      const updated = (await getEmail(emailId))!;
      await applyToPipeline(updated, await trackedApplications(userId), { confirmedByPerson: true, forceApplicationId: updated.applicationId ?? undefined, createIfMissing: true });
      await set({ reviewState: "confirmed" });
      return true;
    }
  }
}
