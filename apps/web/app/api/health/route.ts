import { NextResponse } from "next/server";

/** Unauthenticated liveness check, used by the extension's popup and by uptime monitors. */
export function GET() {
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
