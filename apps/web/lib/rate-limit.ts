import "server-only";

/**
 * Sign-in attempt limiter. In memory, which is right for one server process; failures are
 * counted per IP and per email so neither guessing many passwords nor many accounts works.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 8;
const g = globalThis as unknown as { __jdLoginFails?: Map<string, number[]> };
const fails = (g.__jdLoginFails ??= new Map());

function recent(key: string, now: number): number[] {
  const list = (fails.get(key) ?? []).filter((t: number) => now - t < WINDOW_MS);
  fails.set(key, list);
  return list;
}

export function loginBlocked(keys: string[], now = Date.now()): number | null {
  const worst = Math.max(...keys.map((k) => recent(k, now).length));
  if (worst < MAX_FAILURES) return null;
  const oldest = Math.min(...keys.flatMap((k) => recent(k, now)));
  return Math.ceil((oldest + WINDOW_MS - now) / 60_000);
}

export function recordLoginFailure(keys: string[], now = Date.now()): void {
  for (const k of keys) recent(k, now).push(now);
}

export function clearLoginFailures(keys: string[]): void {
  for (const k of keys) fails.delete(k);
}

export function clientIp(req: Request): string {
  // Behind a reverse proxy the first X-Forwarded-For hop is the client.
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

const h = globalThis as unknown as { __jdHits?: Map<string, number[]> };
const hits = (h.__jdHits ??= new Map());

/** A general sliding-window limit (mailbox connect attempts, "Check now"). Records the attempt when allowed. */
export function allowAttempt(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const list = (hits.get(key) ?? []).filter((t: number) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  return true;
}
