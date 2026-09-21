import { buildDigest, digestDue, lastDigestRun, renderHtml, runDigest, subjectFor } from "@jd/digest";
import { NextResponse } from "next/server";
import { z } from "zod";
import { json, readJson, withUser } from "@/lib/api";

export function GET(req: Request) {
  return withUser(req, async (user) => {
    const digest = await buildDigest(user.id);
    return json({
      due: await digestDue(user.id),
      lastRun: await lastDigestRun(user.id),
      preview: {
        subject: subjectFor(digest),
        total: digest.total,
        sections: digest.sections.map((s) => ({ searchId: s.searchId, query: s.query, count: s.jobs.length, belowThreshold: s.belowThreshold })),
      },
    });
  });
}

const Body = z.object({ action: z.enum(["send", "preview"]) });

export function POST(req: Request) {
  return withUser(req, async (user) => {
    const { action } = Body.parse(await readJson(req));
    if (action === "preview") {
      return new NextResponse(renderHtml(await buildDigest(user.id)), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const outcome = await runDigest(user.id, { force: true });
    return json({ status: outcome.status, reason: outcome.reason ?? null, subject: outcome.subject, total: outcome.digest.total });
  });
}
