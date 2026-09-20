import { SearchFilterSchema } from "@jd/core";
import { z } from "zod";
import { json, readJson, withUser } from "@/lib/api";
import { ensureCrawl } from "@/lib/crawl-runner";
import { createDashboard, listDashboards } from "@/lib/dashboards";

const Body = z.object({
  rawQuery: z.string().trim().min(1).max(300),
  name: z.string().trim().max(80).nullable().optional(),
  filter: SearchFilterSchema,
  parsedBy: z.enum(["llm", "rules"]),
});

/** Your dashboards, for the switcher. */
export function GET(req: Request) {
  return withUser(req, (user) => json(listDashboards(user.id)));
}

export function POST(req: Request) {
  return withUser(req, async (user) => {
    const row = createDashboard(user.id, Body.parse(await readJson(req)));
    const crawl = ensureCrawl({ trigger: "search" });
    return json({ id: row.id, crawlStarted: crawl.started });
  });
}
