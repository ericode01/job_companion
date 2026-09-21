import { getSpendStatus, listUsers, spendByUser } from "@jd/core";
import { getDb, one, schema } from "@jd/core/db";
import { hasApiKey } from "@jd/llm";
import { countOpenJobs, pendingDetailCount } from "@jd/sources";
import { count, eq, gte, inArray, sql } from "drizzle-orm";
import { json, withAdmin } from "@/lib/api";
import { latestCrawl } from "@/lib/crawl-runner";

export function GET(req: Request) {
  return withAdmin(req, async () => {
    const db = getDb();
    const users = await listUsers();
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const byPurpose = (
      await db
        .select({ purpose: schema.llmUsage.purpose, usd: sql<number>`sum(${schema.llmUsage.costUsd})`.mapWith(Number), calls: count() })
        .from(schema.llmUsage)
        .where(gte(schema.llmUsage.ts, monthStart))
        .groupBy(schema.llmUsage.purpose)
    ).sort((a, b) => b.usd - a.usd);
    const queue = await db
      .select({ status: schema.task.status, n: count() })
      .from(schema.task)
      .where(inArray(schema.task.status, ["queued", "running", "failed"]))
      .groupBy(schema.task.status);
    const failedCompanies = (await one(db.select({ n: count() }).from(schema.company).where(eq(schema.company.crawlStatus, "error"))))?.n ?? 0;
    return json({
      users: { total: users.length, active: users.filter((u) => !u.disabled).length, admins: users.filter((u) => u.role === "admin").length },
      coverage: { ...await countOpenJobs(), pendingDetail: await pendingDetailCount(), failedCompanies },
      crawl: await latestCrawl(),
      spend: { ...await getSpendStatus(new Date(), null), byUser: await spendByUser(), byPurpose },
      queue: Object.fromEntries(queue.map((q) => [q.status, q.n])),
      hasApiKey: hasApiKey(),
    });
  });
}
