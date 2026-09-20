import { AuthError, changePassword } from "@jd/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { json, readJson, withUser } from "@/lib/api";

const Body = z.object({ current: z.string().min(1).max(500), next: z.string().max(500) });

export function POST(req: Request) {
  return withUser(req, async (user) => {
    const { current, next } = Body.parse(await readJson(req));
    try {
      await changePassword(user.id, current, next);
    } catch (err) {
      if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 422 });
      throw err;
    }
    return json({ ok: true });
  });
}
