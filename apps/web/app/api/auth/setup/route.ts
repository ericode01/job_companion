import { AuthError, createFirstAdmin, createSession, toPublicUser, userCount } from "@jd/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, handleError, readJson } from "@/lib/api";
import { setSessionCookie } from "@/lib/session";

const Body = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: z.string().trim().max(200),
  password: z.string().max(500),
  timezone: z.string().max(80).optional(),
});

/** Creates the first account (admin) and gives it the data that existed before accounts. */
export async function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  if (userCount() > 0) return NextResponse.json({ error: "Setup is already done." }, { status: 409 });
  try {
    const body = Body.parse(await readJson(req));
    const user = await createFirstAdmin(body);
    const { token, expiresAt } = createSession(user.id);
    await setSessionCookie(token, expiresAt);
    return NextResponse.json({ user: toPublicUser(user) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 422 });
    return handleError(err);
  }
}
