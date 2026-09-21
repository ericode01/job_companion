import { getApplicationByJob, updateCoverLetter } from "@jd/apply";
import { z } from "zod";
import { json, notFound, readJson, withUser } from "@/lib/api";

type Ctx = { params: Promise<{ jobId: string }> };

export function PUT(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const app = await getApplicationByJob(user.id, Number((await params).jobId));
    if (!app) return notFound();
    const { text } = z.object({ text: z.string().trim().min(50, "The cover letter is too short.").max(10000) }).parse(await readJson(req));
    await updateCoverLetter(user.id, app.id, text);
    return json({ ok: true });
  });
}
