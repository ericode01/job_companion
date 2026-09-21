import "server-only";
import { getDb, one, schema } from "@jd/core/db";
import { runCrawl, staleCompanies } from "@jd/sources";
import { desc, eq } from "drizzle-orm";

const g = globalThis as unknown as { __jdCrawl?: Promise<number>; __jdCrawlRecovered?: boolean };

/** Marks crawl rows left "running" by a previous server process as failed. */
async function recoverInterrupted() {
  if (g.__jdCrawlRecovered) return;
  g.__jdCrawlRecovered = true;
  await getDb()
    .update(schema.crawlRun)
    .set({ status: "failed", finishedAt: new Date(), error: "Interrupted (server restarted)" })
    .where(eq(schema.crawlRun.status, "running"));
}

/** Starts a crawl in the background unless one is already running or nothing is stale. */
export async function ensureCrawl(opts: { trigger: "search" | "manual"; force?: boolean }): Promise<{ started: boolean }> {
  await recoverInterrupted();
  if (g.__jdCrawl) return { started: false };
  if (!opts.force && (await staleCompanies()).length === 0) return { started: false };
  g.__jdCrawl = runCrawl(opts)
    .catch((err) => {
      console.error("crawl failed", err);
      return -1;
    })
    .finally(() => {
      g.__jdCrawl = undefined;
    });
  return { started: true };
}

export async function latestCrawl() {
  await recoverInterrupted();
  return await one(getDb().select().from(schema.crawlRun).orderBy(desc(schema.crawlRun.id)).limit(1)) ?? null;
}
