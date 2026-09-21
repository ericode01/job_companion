import { prepareJob } from "@jd/research";
import { ensureJobDetail } from "@jd/sources";
import { json, withUser } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const id = Number((await params).id);
    await ensureJobDetail(id);
    await prepareJob(user.id, id);
    return json({ ok: true });
  });
}
