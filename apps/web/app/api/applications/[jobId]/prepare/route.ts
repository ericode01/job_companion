import { coverLetterStatus, fetchFormInfo, getApplicationByJob, prepareApplication, tailorStatus } from "@jd/apply";
import { hasApiKey } from "@jd/llm";
import { currentMasterResume, tailoredResumeFor } from "@jd/research";
import { NextResponse } from "next/server";
import { z } from "zod";
import { json, readJson, withUser } from "@/lib/api";
import { getDashboard } from "@/lib/dashboards";

type Ctx = { params: Promise<{ jobId: string }> };

/** State for the Apply dialog. */
export function GET(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const jobId = Number((await params).jobId);
    const app = await getApplicationByJob(user.id, jobId);
    const resume = await currentMasterResume(user.id);
    const tailored = await tailoredResumeFor(user.id, jobId);
    return json({
      application: app,
      coverLetterTask: app ? await coverLetterStatus(app.id) : { status: "idle" },
      formInfo: await fetchFormInfo(jobId),
      resume: resume ? { id: resume.id, fileName: resume.fileName, parseStatus: resume.parseStatus } : null,
      tailored: tailored
        ? { id: tailored.id, fileName: tailored.fileName, changeLog: tailored.changeLog ?? [], truthWarnings: tailored.truthWarnings ?? [], updatedAt: tailored.updatedAt }
        : null,
      tailorTask: await tailorStatus(user.id, jobId),
      hasApiKey: hasApiKey(),
    });
  });
}

const Body = z.object({
  coverLetter: z.enum(["yes", "no"]),
  resume: z.enum(["master", "tailored"]).default("master"),
  regenerate: z.boolean().optional(),
  searchId: z.number().int().nullable().optional(),
});

export function POST(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const jobId = Number((await params).jobId);
    const body = Body.parse(await readJson(req));
    if (body.coverLetter === "yes" && !hasApiKey()) {
      return NextResponse.json({ error: "AI is turned off on this server, so cover letters can't be written." }, { status: 422 });
    }
    const searchId = body.searchId && await getDashboard(user.id, body.searchId) ? body.searchId : null;
    const app = await prepareApplication(user.id, jobId, { ...body, searchId });
    return json({ application: app, coverLetterTask: await coverLetterStatus(app.id) });
  });
}
