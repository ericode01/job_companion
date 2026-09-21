import { getExtensionState, rotateExtensionToken } from "@jd/apply";
import { json, withUser } from "@/lib/api";

const CONNECTED_WITHIN_MS = 7 * 86_400_000;

/** Whether your extension has checked in recently; drives the setup page's live status. */
export function GET(req: Request) {
  return withUser(req, async (user) => {
    const { lastSeenAt, version } = await getExtensionState(user.id);
    const seen = lastSeenAt?.getTime() ?? null;
    return json({ lastSeenAt: seen, version, connected: seen !== null && Date.now() - seen < CONNECTED_WITHIN_MS });
  });
}

/** Unpairs your extension (for example after using a shared computer). */
export function POST(req: Request) {
  return withUser(req, async (user) => {
    await rotateExtensionToken(user.id);
    return json({ ok: true });
  });
}
