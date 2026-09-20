import { countOpenJobs } from "@jd/sources";
import { z } from "zod";
import { json, readJson, withAdmin, withUser } from "@/lib/api";
import { ensureCrawl, latestCrawl } from "@/lib/crawl-runner";

/** Coverage numbers are shown to everyone; starting a refresh is an admin action. */
export function GET(req: Request) {
  return withUser(req, () => json({ crawl: latestCrawl(), ...countOpenJobs() }));
}

export function POST(req: Request) {
  return withAdmin(req, async () => {
    const { force } = z.object({ force: z.boolean().default(false) }).parse(await readJson(req));
    return json(ensureCrawl({ trigger: "manual", force }));
  });
}
