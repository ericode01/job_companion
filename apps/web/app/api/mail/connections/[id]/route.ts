import { disconnect, enqueueSync, getConnection, LOOKBACK_CHOICES, toPublic, updateConnection } from "@jd/mail";
import { z } from "zod";
import { json, notFound, readJson, withUser } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

const Patch = z.object({
  paused: z.boolean().optional(),
  /** Read further back: clears what was listed so the next check covers the new window. */
  backfillDays: z
    .number()
    .int()
    .refine((d) => (LOOKBACK_CHOICES as readonly number[]).includes(d))
    .optional(),
});

export function PATCH(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const conn = getConnection(user.id, Number((await params).id));
    if (!conn || !conn.secret) return notFound();
    const body = Patch.parse(await readJson(req));
    if (body.paused !== undefined) updateConnection(conn.id, { status: body.paused ? "paused" : "active", lastError: null });
    if (body.backfillDays !== undefined && body.backfillDays !== conn.backfillDays) {
      updateConnection(conn.id, { backfillDays: body.backfillDays, backfillDone: false, cursor: {} });
    }
    if (body.paused === false || body.backfillDays !== undefined) enqueueSync(conn, true);
    return json(toPublic(getConnection(user.id, conn.id)!));
  });
}

/** Disconnects. ?purge=1 also deletes the job emails it found (applications stay). */
export function DELETE(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const purge = new URL(req.url).searchParams.get("purge") === "1";
    return (await disconnect(user.id, Number((await params).id), purge)) ? json({ ok: true }) : notFound();
  });
}
