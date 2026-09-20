import { listAnswers, listInbox, pendingInboxCount, saveAnswer } from "@jd/apply";
import { z } from "zod";
import { json, readJson, withUser } from "@/lib/api";

export function GET(req: Request) {
  return withUser(req, (user) =>
    json({ answers: listAnswers(user.id), inbox: listInbox(user.id, "pending"), pending: pendingInboxCount(user.id) }),
  );
}

const CATEGORIES = ["work_auth", "sponsorship", "relocation", "salary", "eeo", "logistics", "custom"] as const;

const Body = z.object({
  question: z.string().trim().min(3, "Enter the question.").max(2000),
  answer: z.string().trim().min(1, "Enter an answer.").max(10000),
  category: z.enum(CATEGORIES),
});

/** Saves one answer, or several at once (onboarding's common questions). */
export function POST(req: Request) {
  return withUser(req, async (user) => {
    const raw = await readJson(req);
    if (Array.isArray(raw)) {
      const items = z.array(Body).max(40).parse(raw);
      return json(items.map((a) => saveAnswer(user.id, { ...a, scope: "global" })));
    }
    return json(saveAnswer(user.id, { ...Body.parse(raw), scope: "global" }));
  });
}
