import { getDb, schema } from "@jd/core/db";
import { hasApiKey } from "@jd/llm";
import { enqueueResumeParse, ownedResume } from "@jd/research";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { json, notFound, withUser } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const id = Number((await params).id);
    if (!await ownedResume(user.id, id)) return notFound();
    if (!hasApiKey()) return NextResponse.json({ error: "AI is turned off on this server (no API key)." }, { status: 422 });
    await getDb().update(schema.resume).set({ parseStatus: "pending", parseError: null }).where(eq(schema.resume.id, id));
    await enqueueResumeParse(user.id, id);
    return json({ ok: true });
  });
}
