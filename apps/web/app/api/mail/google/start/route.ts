import crypto from "node:crypto";
import { appOrigin, getSettings } from "@jd/core";
import { googleAuthUrl, googleConfigured, LOOKBACK_CHOICES, pkcePair } from "@jd/mail";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";

const GOOGLE_STATE_COOKIE = "jd_gstate";

/** Starts Google sign-in for read-only Gmail access. */
export function GET(req: Request) {
  return withUser(req, (user) => {
    const back = (error: string) => NextResponse.redirect(`${appOrigin()}/mailbox?error=${encodeURIComponent(error)}`);
    if (!getSettings("mailSync").enabled) return back("Mailbox sync is turned off on this server.");
    if (!googleConfigured()) return back("Google sign-in isn't set up on this server yet. Ask your admin, or use an app password.");
    const url = new URL(req.url);
    const days = Number(url.searchParams.get("days"));
    const backfillDays = (LOOKBACK_CHOICES as readonly number[]).includes(days) ? days : 90;
    const hint = url.searchParams.get("hint")?.slice(0, 200) || user.email;
    const state = crypto.randomBytes(24).toString("base64url");
    const { verifier, challenge } = pkcePair();
    const res = NextResponse.redirect(googleAuthUrl({ state, challenge, loginHint: hint }));
    // Tied to this person and this attempt; checked and cleared by the callback.
    res.cookies.set(GOOGLE_STATE_COOKIE, [state, verifier, user.id, backfillDays].join("."), {
      httpOnly: true,
      sameSite: "lax",
      secure: appOrigin().startsWith("https://"),
      path: "/api/mail/google",
      maxAge: 600,
    });
    return res;
  });
}
