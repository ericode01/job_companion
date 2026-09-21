import crypto from "node:crypto";
import { appOrigin, runAs } from "@jd/core";
import { exchangeCode, saveGmailConnection } from "@jd/mail";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { assertAllowedHost, sessionUser } from "@/lib/api";

const COOKIE = "jd_gstate";

const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Google sends people back here after they allow (or cancel) read-only Gmail access. */
export async function GET(req: Request) {
  const badHost = assertAllowedHost(req);
  if (badHost) return badHost;
  const done = (params: Record<string, string>) => {
    const res = NextResponse.redirect(`${appOrigin()}/mailbox?${new URLSearchParams(params)}`);
    res.cookies.delete({ name: COOKIE, path: "/api/mail/google" });
    return res;
  };
  const user = await sessionUser();
  if (!user) return NextResponse.redirect(`${appOrigin()}/login`);

  const url = new URL(req.url);
  if (url.searchParams.get("error")) {
    return done({ error: url.searchParams.get("error") === "access_denied" ? "Gmail wasn't connected: access was cancelled." : "Google sign-in didn't finish." });
  }
  const [state, verifier, uid, days] = ((await cookies()).get(COOKIE)?.value ?? "").split(".");
  const given = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  if (!state || !verifier || !code || !same(state, given) || Number(uid) !== user.id) {
    return done({ error: "That sign-in link expired or didn't match. Try connecting again." });
  }
  try {
    const grant = await exchangeCode(code, verifier);
    await runAs(user.id, () => saveGmailConnection(user.id, { address: grant.address, refreshToken: grant.refreshToken, backfillDays: Number(days) || 90 }));
    return done({ connected: grant.address });
  } catch (err) {
    return done({ error: err instanceof Error ? err.message : "Google sign-in failed." });
  }
}
