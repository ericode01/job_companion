import { hasApiKey } from "@jd/llm";
import { enqueueCompanyResearch, getCompanyProfile } from "@jd/research";
import { NextResponse } from "next/server";
import { json, withUser } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

/** Research is shared: one person's refresh serves everyone. It's billed to whoever asked. */
export function POST(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    if (!hasApiKey()) return NextResponse.json({ error: "AI is turned off on this server (no API key)." }, { status: 422 });
    const id = Number((await params).id);
    // Refreshing an existing profile re-researches; retrying a failed first attempt reuses gathered notes.
    await enqueueCompanyResearch(id, false, await getCompanyProfile(id) !== null, user.id);
    return json({ ok: true });
  });
}
