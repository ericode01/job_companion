import { startTailoring, tailorStatus } from "@jd/apply";
import { hasApiKey } from "@jd/llm";
import { currentMasterResume } from "@jd/research";
import { NextResponse } from "next/server";
import { json, withUser } from "@/lib/api";

type Ctx = { params: Promise<{ jobId: string }> };

/** Writes a version of your master resume aimed at this job. It never invents experience. */
export function POST(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    if (!hasApiKey()) return NextResponse.json({ error: "AI is turned off on this server (no API key)." }, { status: 422 });
    const master = currentMasterResume(user.id);
    if (!master || master.parseStatus !== "done") {
      return NextResponse.json({ error: "Upload your resume and let it finish reading first." }, { status: 422 });
    }
    const jobId = Number((await params).jobId);
    startTailoring(user.id, jobId);
    return json({ task: tailorStatus(user.id, jobId) });
  });
}
