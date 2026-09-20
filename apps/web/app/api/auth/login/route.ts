import { authenticate, createSession, toPublicUser } from "@jd/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, handleError, readJson } from "@/lib/api";
import { clearLoginFailures, clientIp, loginBlocked, recordLoginFailure } from "@/lib/rate-limit";
import { setSessionCookie } from "@/lib/session";

const Body = z.object({ email: z.string().trim().min(1).max(200), password: z.string().min(1).max(500) });

export async function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  try {
    const { email, password } = Body.parse(await readJson(req));
    const keys = [`ip:${clientIp(req)}`, `email:${email.toLowerCase()}`];
    const wait = loginBlocked(keys);
    if (wait) return NextResponse.json({ error: `Too many attempts. Try again in ${wait} minutes.` }, { status: 429 });
    const user = await authenticate(email, password);
    if (!user) {
      recordLoginFailure(keys);
      return NextResponse.json({ error: "That email and password don't match." }, { status: 401 });
    }
    clearLoginFailures(keys);
    const { token, expiresAt } = createSession(user.id);
    await setSessionCookie(token, expiresAt);
    return NextResponse.json({ user: toPublicUser(user) });
  } catch (err) {
    return handleError(err);
  }
}
