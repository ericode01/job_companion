import { getDb, schema } from "@jd/core/db";
import { hasApiKey } from "@jd/llm";
import { briefFor, enqueueDiscovery, latestDiscoveryRuns } from "@jd/research";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { json, readJson, withAdmin } from "@/lib/api";

export function GET(req: Request) {
  return withAdmin(req, () => json({ runs: latestDiscoveryRuns(5), hasApiKey: hasApiKey() }));
}

const Body = z
  .object({ prompt: z.string().trim().max(500).optional(), searchId: z.number().int().optional() })
  .refine((b) => b.prompt || b.searchId, { message: "Describe what to look for, or pick a saved search." });

/** Adds shared companies, so it's an admin action. */
export function POST(req: Request) {
  return withAdmin(req, async (user) => {
    if (!hasApiKey()) return NextResponse.json({ error: "Set ANTHROPIC_API_KEY on the server to search for companies." }, { status: 422 });
    const { prompt, searchId } = Body.parse(await readJson(req));
    let brief = prompt ?? "";
    if (searchId) {
      const search = getDb().select().from(schema.savedSearch).where(eq(schema.savedSearch.id, searchId)).get();
      if (!search) return NextResponse.json({ error: "That saved search no longer exists." }, { status: 404 });
      brief = prompt ? `${briefFor(search.filter, search.rawQuery)} ${prompt}` : briefFor(search.filter, search.rawQuery);
    }
    return json({ run: enqueueDiscovery(brief, "manual", searchId ?? null, user.id) });
  });
}
