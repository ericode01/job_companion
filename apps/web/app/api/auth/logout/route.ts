import { deleteSession, SESSION_COOKIE } from "@jd/core";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/api";
import { clearSessionCookie } from "@/lib/session";

export async function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  await deleteSession((await cookies()).get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
