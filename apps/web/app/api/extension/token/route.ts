import { getExtensionState } from "@jd/apply";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";

/**
 * Pairing: the extension's bridge script runs on this app's pages and fetches the signed-in
 * person's token same-origin. Other websites can't read it (no CORS headers), and
 * Sec-Fetch-Site must be same-origin.
 */
export function GET(req: Request) {
  return withUser(req, (user) => {
    if (req.headers.get("sec-fetch-site") !== "same-origin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ token: getExtensionState(user.id).token }, { headers: { "cache-control": "no-store" } });
  });
}
