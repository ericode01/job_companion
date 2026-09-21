import { getApplication, resolveInboxByQuestion, saveAnswer } from "@jd/apply";
import { z } from "zod";
import { extensionJson, extensionPreflight, withExtension } from "@/lib/api";

export const OPTIONS = extensionPreflight;

const Body = z.object({
  applicationId: z.number().int(),
  question: z.string().min(1).max(2000),
  answer: z.string().min(1).max(10000),
  category: z.enum(["work_auth", "sponsorship", "relocation", "salary", "eeo", "logistics", "custom"]),
  scope: z.enum(["global", "job"]),
});

export function POST(req: Request) {
  return withExtension(req, async (userId) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return extensionJson(req, { error: "Invalid request" }, { status: 400 });
    const { applicationId, ...input } = parsed.data;
    const app = await getApplication(userId, applicationId);
    if (!app) return extensionJson(req, { error: "Application not found" }, { status: 404 });
    const saved = await saveAnswer(userId, { ...input, jobId: app.jobId });
    await resolveInboxByQuestion(userId, input.question);
    return extensionJson(req, saved);
  });
}
