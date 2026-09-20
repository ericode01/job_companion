import { getDb, schema } from "@jd/core/db";
import { AddCompanyError, addCompanyFromUrl } from "@jd/sources";
import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { json, readJson, withAdmin } from "@/lib/api";

/** The shared company list is managed in the admin portal. */
export function GET(req: Request) {
  return withAdmin(req, () => json(getDb().select().from(schema.company).orderBy(asc(schema.company.name)).all()));
}

const Body = z.object({ url: z.string().trim().min(3).max(500), name: z.string().trim().max(120).optional() });

export function POST(req: Request) {
  return withAdmin(req, async () => {
    const { url, name } = Body.parse(await readJson(req));
    try {
      return json(await addCompanyFromUrl(url, name));
    } catch (err) {
      if (err instanceof AddCompanyError) return NextResponse.json({ error: err.message }, { status: 422 });
      throw err;
    }
  });
}
