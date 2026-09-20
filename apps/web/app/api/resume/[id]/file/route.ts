import fs from "node:fs";
import { ownedResume } from "@jd/research";
import { NextResponse } from "next/server";
import { notFound, withUser } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

/** Serves a resume PDF to its owner only. */
export function GET(req: Request, { params }: Ctx) {
  return withUser(req, async (user) => {
    const resume = ownedResume(user.id, Number((await params).id));
    if (!resume || !fs.existsSync(resume.filePath)) return notFound();
    return new NextResponse(new Uint8Array(fs.readFileSync(resume.filePath)), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${resume.fileName.replace(/["\r\n]/g, "")}"`,
        "cache-control": "private, no-store",
      },
    });
  });
}
