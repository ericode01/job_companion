import { fileStore } from "@jd/core";
import { ownedResume } from "@jd/research";
import { NextResponse } from "next/server";
import { notFound, withUser } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

/** Serves a resume PDF to its owner only. */
export function GET(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const resume = await ownedResume(user.id, Number((await params).id));
    const pdf = resume ? await fileStore().get(resume.filePath) : null;
    if (!resume || !pdf) return notFound();
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${resume.fileName.replace(/["\r\n]/g, "")}"`,
        "cache-control": "private, no-store",
      },
    });
  });
}
