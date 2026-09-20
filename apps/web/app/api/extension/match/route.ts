import { getApplicationByJob, matchJobByUrl, prepareApplication } from "@jd/apply";
import { z } from "zod";
import { extensionJson, extensionPreflight, withExtension } from "@/lib/api";

export const OPTIONS = extensionPreflight;

/** For application pages opened directly (not via the app): find the job and start an application. */
export function POST(req: Request) {
  return withExtension(req, async (userId) => {
    const parsed = z.object({ url: z.string().url() }).safeParse(await req.json().catch(() => null));
    if (!parsed.success) return extensionJson(req, { error: "Invalid request" }, { status: 400 });
    const hit = matchJobByUrl(parsed.data.url);
    if (!hit) return extensionJson(req, { match: null });
    const existing = getApplicationByJob(userId, hit.jobId);
    const app =
      existing && existing.status !== "saved"
        ? existing
        : prepareApplication(userId, hit.jobId, { coverLetter: existing?.coverLetterChoice ?? "no" });
    return extensionJson(req, { match: { jobId: hit.jobId, applicationId: app.id } });
  });
}
