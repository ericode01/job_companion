/**
 * Background worker: company research, job analysis, fit scoring, resume parsing, cover letters,
 * tailored resumes and mailbox checks. It also refreshes job boards and sends the daily digest
 * while it runs. Started by `pnpm dev`; run alone with `pnpm worker`.
 */
import { getSettings, loadEnv, pruneSessions, refreshModelPrices } from "@jd/core";
import { initDb } from "@jd/core/db";
import { dueDigestUsers, followedSearches, runDigest } from "@jd/digest";
import { dueConnections, enqueueSync, syncConnection } from "@jd/mail";
import { briefFor, discoveryDue, enqueueDiscovery, enqueueFitScores, registerTaskHandler, startWorker } from "@jd/research";
import { hydrateForFilter, runCrawl, runSearch, staleCompanies } from "@jd/sources";

loadEnv();
// Every background job here now talks to a database over the network. One that fails while the
// database is briefly unreachable should be logged, not end the process: under `pnpm serve` the
// worker exiting takes the web server down with it.
process.on("unhandledRejection", (err) => {
  console.error("[worker] unhandled:", err instanceof Error ? err.message : err);
});
await initDb();
registerTaskHandler("sync_mailbox", async (p) => {
  const summary = await syncConnection(Number(p.connectionId));
  if (summary?.candidates) {
    console.log(
      `[mail] mailbox ${p.connectionId}: ${summary.processed}/${summary.candidates} read, ${summary.jobEmails} job emails, ${summary.moved} cards moved, ${summary.created} applications added`,
    );
  }
  return summary;
});
await startWorker({ pollMs: 1000 });
console.log("worker started");

let crawling = false;

/** Refreshes stale boards, then queues fit scoring for searches you follow. */
async function refreshIfStale() {
  if (crawling || !(await getSettings("sources")).autoRefresh) return;
  const stale = await staleCompanies();
  if (stale.length === 0) return;
  crawling = true;
  console.log(`[refresh] ${stale.length} companies are stale`);
  try {
    await runCrawl({ trigger: "schedule" });
    for (const search of await followedSearches()) {
      if (!search.userId) continue;
      await hydrateForFilter(search.filter, search.userId);
      const results = await runSearch(search.id, search.filter, search.userId);
      const queued = await enqueueFitScores(
        search.userId,
        results.map((r) => r.jobId).slice(0, (await getSettings("research")).maxScoredPerSearch),
        true,
      );
      if (queued) console.log(`[refresh] queued ${queued} fit scores for "${search.rawQuery}"`);
    }
  } catch (err) {
    console.warn("[refresh] failed:", err instanceof Error ? err.message : err);
  } finally {
    crawling = false;
  }
}

/** Once a day, if you asked for it, look for companies that aren't on the list yet. */
async function discoverIfDue() {
  if (!await discoveryDue()) return;
  const [search] = await followedSearches();
  if (!search) return;
  await enqueueDiscovery(briefFor(search.filter, search.rawQuery), "schedule", search.id);
  console.log(`[discover] looking for companies like "${search.rawQuery}"`);
}

async function digestIfDue() {
  for (const userId of await dueDigestUsers()) {
    const outcome = await runDigest(userId);
    console.log(`[digest] user ${userId}: ${outcome.status}${outcome.reason ? `: ${outcome.reason}` : ` — ${outcome.subject}`}`);
  }
}

/** Mailboxes are checked on their own interval (Admin → Mailbox sync), independent of job boards. */
async function queueMailboxChecks() {
  for (const conn of await dueConnections()) await enqueueSync(conn, false);
}
await queueMailboxChecks();
setInterval(() => void queueMailboxChecks(), 60_000);

/** Model prices move, and every spend cap depends on them. The committed snapshot is the floor. */
void refreshModelPrices();
setInterval(() => void refreshModelPrices(), 24 * 3_600_000);

const tick = async () => {
  await pruneSessions();
  await refreshIfStale();
  await discoverIfDue();
  await digestIfDue();
};
void tick();
setInterval(() => void tick(), 10 * 60_000);

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => process.exit(0));
