import { enqueueSync, getConnection, updateConnection } from "@jd/mail";
import { json, notFound, withUser } from "@/lib/api";
import { allowAttempt } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

/** "Check now". The worker picks it up within a second or two. */
export function POST(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const conn = getConnection(user.id, Number((await params).id));
    if (!conn || !conn.secret) return notFound();
    if (!allowAttempt(`mail-check:${conn.id}`, 6, 10 * 60_000)) return json({ error: "Checked a moment ago. Try again in a few minutes." }, { status: 429 });
    if (conn.status === "error") updateConnection(conn.id, { status: "active" });
    enqueueSync(conn, true);
    return json({ ok: true });
  });
}
