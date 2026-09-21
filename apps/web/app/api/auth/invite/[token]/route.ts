import { acceptInvite, AuthError, createSession, toPublicUser } from "@jd/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, handleError, readJson } from "@/lib/api";
import { setSessionCookie } from "@/lib/session";

type Ctx = { params: Promise<{ token: string }> };

const Body = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: z.string().trim().max(200),
  password: z.string().max(500),
  timezone: z.string().max(80).optional(),
});

export async function POST(req: Request, { params }: Ctx) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  try {
    const body = Body.parse(await readJson(req));
    const user = await acceptInvite((await params).token, body);
    const { token, expiresAt } = await createSession(user.id);
    await setSessionCookie(token, expiresAt);
    return NextResponse.json({ user: toPublicUser(user) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 422 });
    return handleError(err);
  }
}
