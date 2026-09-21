import { EMAIL_KINDS, INTERVIEW_ROUNDS } from "@jd/core";
import { reviewEmail } from "@jd/mail";
import { z } from "zod";
import { json, notFound, readJson, withUser } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("done"), done: z.boolean() }),
  z.object({ type: z.literal("confirm") }),
  z.object({ type: z.literal("assign"), applicationId: z.union([z.number().int(), z.literal("new")]) }),
  z.object({ type: z.literal("correct"), kind: z.enum(EMAIL_KINDS).optional(), round: z.enum(INTERVIEW_ROUNDS).nullable().optional() }),
  z.object({ type: z.literal("dismiss") }),
]);

/** Your decision about one email: done, yes, it's about this application, it's actually…, or ignore. */
export function PATCH(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const action = Action.parse(await readJson(req));
    return await reviewEmail(user.id, Number((await params).id), action) ? json({ ok: true }) : notFound();
  });
}
