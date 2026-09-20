import { hasApiKey } from "@jd/llm";
import { enqueueResumeParse, listMasterResumes, ResumeUploadError, saveMasterResume, taskStatus } from "@jd/research";
import { NextResponse } from "next/server";
import { json, withUser } from "@/lib/api";

export function GET(req: Request) {
  return withUser(req, (user) => {
    const all = listMasterResumes(user.id);
    const current = all[0] ?? null;
    return json({
      current,
      parseTask: current ? taskStatus("parse_resume", `resume:${current.id}`) : null,
      history: all.map(({ id, fileName, createdAt, parseStatus }) => ({ id, fileName, createdAt, parseStatus })),
      hasApiKey: hasApiKey(),
    });
  });
}

export function POST(req: Request) {
  return withUser(req, async (user) => {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    try {
      const row = await saveMasterResume(user.id, new Uint8Array(await file.arrayBuffer()), file.name);
      if (row.parseStatus === "pending") enqueueResumeParse(user.id, row.id);
      return json({ id: row.id });
    } catch (err) {
      if (err instanceof ResumeUploadError) return NextResponse.json({ error: err.message }, { status: 422 });
      throw err;
    }
  });
}
