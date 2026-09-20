import { buildPacket } from "@jd/apply";
import { extensionJson, extensionPreflight, withExtension } from "@/lib/api";

export const OPTIONS = extensionPreflight;

export function GET(req: Request) {
  return withExtension(req, async (userId) => {
    const id = Number(new URL(req.url).searchParams.get("applicationId"));
    const packet = Number.isFinite(id) ? await buildPacket(userId, id) : null;
    if (!packet) return extensionJson(req, { error: "Application not found" }, { status: 404 });
    return extensionJson(req, packet);
  });
}
