import "server-only";
import { appOrigin, DEV_ORIGIN, runAs, SESSION_COOKIE, userForSession, type PublicUser } from "@jd/core";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** The app's own origin, plus the local dev addresses outside production. */
function allowedOrigins(): Set<string> {
  const set = new Set([appOrigin()]);
  if (process.env.NODE_ENV !== "production") {
    set.add(DEV_ORIGIN);
    set.add("http://localhost:4317");
  }
  return set;
}

/** Rejects requests addressed to another hostname (DNS rebinding, stray virtual hosts). */
export function assertAllowedHost(req: Request): NextResponse | null {
  const host = req.headers.get("host");
  if (!host) return null;
  const ok = [...allowedOrigins()].some((o) => new URL(o).host === host);
  return ok ? null : NextResponse.json({ error: "Invalid host" }, { status: 421 });
}

/**
 * Mutations must come from the app's own pages. With SameSite=Lax cookies this blocks
 * cross-site form posts and fetches.
 */
export function assertSameOrigin(req: Request): NextResponse | null {
  const badHost = assertAllowedHost(req);
  if (badHost) return badHost;
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins().has(origin)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  return null;
}

export function handleError(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return NextResponse.json({ error: first?.message ?? "Invalid input", issues: err.issues }, { status: 400 });
  }
  console.error(err);
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export const json = (body: unknown, init?: ResponseInit) => NextResponse.json(body, init);
export const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/* ---------- signed-in routes ---------- */

export async function sessionUser(): Promise<PublicUser | null> {
  return userForSession((await cookies()).get(SESSION_COOKIE)?.value);
}

interface RouteOptions {
  /** Checks the Origin header; on by default for anything but GET/HEAD. */
  mutation?: boolean;
  admin?: boolean;
}

/**
 * Runs a handler for the signed-in person: host and origin checks, 401/403, error handling,
 * and AI spend attribution (everything inside runs "as" this person).
 */
export async function withUser(
  req: Request,
  handler: (user: PublicUser) => Promise<Response> | Response,
  opts: RouteOptions = {},
): Promise<Response> {
  const mutation = opts.mutation ?? !["GET", "HEAD"].includes(req.method);
  const blocked = mutation ? assertSameOrigin(req) : assertAllowedHost(req);
  if (blocked) return blocked;
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (opts.admin && user.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    return await runAs(user.id, () => handler(user));
  } catch (err) {
    return handleError(err);
  }
}

export const withAdmin = (req: Request, handler: (user: PublicUser) => Promise<Response> | Response) =>
  withUser(req, handler, { admin: true });

/* ---------- Chrome extension ---------- */

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin?.startsWith("chrome-extension://")) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type, x-jd-token, x-jd-version",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    vary: "origin",
  };
}

export function extensionPreflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function extensionJson(req: Request, body: unknown, init: ResponseInit = {}): NextResponse {
  return NextResponse.json(body, { ...init, headers: { ...corsHeaders(req), ...(init.headers ?? {}) } });
}

/**
 * Extension routes authenticate with the person's pairing token instead of the session cookie,
 * and run as that person.
 */
export async function withExtension(req: Request, handler: (userId: number) => Promise<Response> | Response): Promise<Response> {
  const badHost = assertAllowedHost(req);
  if (badHost) return badHost;
  const { userForExtensionToken } = await import("@jd/apply");
  const userId = userForExtensionToken(req.headers.get("x-jd-token"), req.headers.get("x-jd-version"));
  if (userId === null) {
    return extensionJson(req, { error: "Extension not paired. Sign in to Job Companion in this browser to pair it." }, { status: 401 });
  }
  try {
    return await runAs(userId, () => handler(userId));
  } catch (err) {
    console.error(err);
    return extensionJson(req, { error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
