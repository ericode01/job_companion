import { markSubmitted } from "@jd/apply";
import { z } from "zod";
import { extensionJson, extensionPreflight, withExtension } from "@/lib/api";

export const OPTIONS = extensionPreflight;

const Body = z.object({
  applicationId: z.number().int(),
  answers: z.array(z.object({ label: z.string().max(2000), value: z.union([z.string(), z.array(z.string()), z.null()]), source: z.string() })).max(200),
});

/** The extension saw the job board's confirmation page. */
export function POST(req: Request) {
  return withExtension(req, async (userId) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return extensionJson(req, { error: "Invalid request" }, { status: 400 });
    const app = markSubmitted(userId, parsed.data.applicationId, parsed.data.answers);
    if (!app) return extensionJson(req, { error: "Application not found" }, { status: 404 });
    return extensionJson(req, { ok: true, status: app.status });
  });
}
