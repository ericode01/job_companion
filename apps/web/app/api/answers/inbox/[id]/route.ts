import { answerInboxItem, setInboxStatus } from "@jd/apply";
import { z } from "zod";
import { json, notFound, readJson, withUser } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.union([
  z.object({ answer: z.string().trim().min(1, "Enter an answer.").max(10000), scope: z.enum(["global", "job"]) }),
  z.object({ status: z.enum(["ignored", "pending"]) }),
]);

export function POST(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const id = Number((await params).id);
    const body = Body.parse(await readJson(req));
    if ("status" in body) {
      setInboxStatus(user.id, id, body.status);
      return json({ ok: true });
    }
    const saved = answerInboxItem(user.id, id, body.answer, body.scope);
    return saved ? json(saved) : notFound();
  });
}
