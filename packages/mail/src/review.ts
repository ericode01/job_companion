import { type EmailKind, type InterviewRound } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
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

export function ownEmail(userId: number, emailId: number) {
  const row = getEmail(emailId);
  return row && row.userId === userId ? row : null;
}

/** Applies a person's decision about an email. Returns false if it isn't theirs. */
export function reviewEmail(userId: number, emailId: number, action: EmailAction): boolean {
  const row = ownEmail(userId, emailId);
  if (!row) return false;
  const db = getDb();
  const set = (patch: Partial<typeof schema.emailMessage.$inferInsert>) => db.update(schema.emailMessage).set(patch).where(eq(schema.emailMessage.id, emailId)).run();

  switch (action.type) {
    case "done":
      set({ actionDoneAt: action.done ? new Date() : null });
      return true;
    case "dismiss":
      set({ reviewState: "dismissed" });
      return true;
    case "confirm": {
      const companyName = row.companyName ?? (row.applicationId ? null : companyFromSender(row.fromName, row.fromAddress));
      if (companyName !== row.companyName) set({ companyName });
      applyToPipeline({ ...row, companyName }, trackedApplications(userId), { confirmedByPerson: true, createIfMissing: true, forceApplicationId: row.applicationId ?? undefined });
      set({ reviewState: "confirmed" });
      return true;
    }
    case "assign": {
      if (action.applicationId === "new") {
        const companyName = row.companyName ?? companyFromSender(row.fromName, row.fromAddress) ?? "Unknown company";
        set({ applicationId: null, companyName });
        applyToPipeline({ ...row, companyName, applicationId: null, threadId: null }, [], { confirmedByPerson: true, createIfMissing: true });
      } else {
        const mine = db
          .select({ id: schema.application.id })
          .from(schema.application)
          .where(and(eq(schema.application.id, action.applicationId), eq(schema.application.userId, userId)))
          .get();
        if (!mine) return false;
        applyToPipeline(row, trackedApplications(userId), { confirmedByPerson: true, forceApplicationId: mine.id });
      }
      set({ reviewState: "confirmed" });
      return true;
    }
    case "correct": {
      const kind = action.kind ?? row.kind;
      const round = action.round !== undefined ? action.round : row.round;
      set({ kind, round, reviewState: "confirmed" });
      if (kind === "unrelated") {
        set({ reviewState: "dismissed" });
        return true;
      }
      const updated = getEmail(emailId)!;
      applyToPipeline(updated, trackedApplications(userId), { confirmedByPerson: true, forceApplicationId: updated.applicationId ?? undefined, createIfMissing: true });
      set({ reviewState: "confirmed" });
      return true;
    }
  }
}
