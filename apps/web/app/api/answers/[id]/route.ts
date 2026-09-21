import { deleteAnswer, updateAnswer } from "@jd/apply";
import { z } from "zod";
import { json, notFound, readJson, withUser } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

const Patch = z.object({
  question: z.string().trim().min(3).max(2000).optional(),
  answer: z.string().trim().min(1, "Enter an answer.").max(10000).optional(),
  category: z.enum(["work_auth", "sponsorship", "relocation", "salary", "eeo", "logistics", "custom"]).optional(),
});

export function PUT(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const row = await updateAnswer(user.id, Number((await params).id), Patch.parse(await readJson(req)));
    return row ? json(row) : notFound();
  });
}

export function DELETE(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    await deleteAnswer(user.id, Number((await params).id));
    return json({ ok: true });
  });
}
