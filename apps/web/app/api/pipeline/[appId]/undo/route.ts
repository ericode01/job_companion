import { undoEvent } from "@jd/apply";
import { z } from "zod";
import { json, readJson, withUser } from "@/lib/api";

const Body = z.object({ eventId: z.number().int() });

/** Undoes an automatic move (or removes an application that an email added). */
export function POST(req: Request) {
  return withUser(req, async (user) => {
    const { eventId } = Body.parse(await readJson(req));
    const out = await undoEvent(user.id, eventId);
    return out.ok ? json(out) : json({ error: out.reason }, { status: 409 });
  });
}
