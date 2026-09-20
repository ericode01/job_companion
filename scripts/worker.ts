/**
 * Background worker: company research, job analysis, fit scoring, resume parsing, cover letters,
 * tailored resumes and mailbox checks. It also refreshes job boards and sends the daily digest
 * while it runs. Started by `pnpm dev`; run alone with `pnpm worker`.
 */
import { getSettings, loadEnv, pruneSessions } from "@jd/core";
import { dueDigestUsers, followedSearches, runDigest } from "@jd/digest";
import { dueConnections, enqueueSync, syncConnection } from "@jd/mail";
import { briefFor, discoveryDue, enqueueDiscovery, enqueueFitScores, registerTaskHandler, startWorker } from "@jd/research";
import { hydrateForFilter, runCrawl, runSearch, staleCompanies } from "@jd/sources";

loadEnv();
registerTaskHandler("sync_mailbox", async (p) => {
  const summary = await syncConnection(Number(p.connectionId));
  if (summary?.candidates) {
    console.log(
      `[mail] mailbox ${p.connectionId}: ${summary.processed}/${summary.candidates} read, ${summary.jobEmails} job emails, ${summary.moved} cards moved, ${summary.created} applications added`,
    );
  }
  return summary;
});
startWorker({ pollMs: 1000 });
console.log("worker started");

let crawling = false;

/** Refreshes stale boards, then queues fit scoring for searches you follow. */
async function refreshIfStale() {
  if (crawling || !getSettings("sources").autoRefresh) return;
  const stale = staleCompanies();
  if (stale.length === 0) return;
  crawling = true;
  console.log(`[refresh] ${stale.length} companies are stale`);
  try {
    await runCrawl({ trigger: "schedule" });
    for (const search of followedSearches()) {
      if (!search.userId) continue;
      await hydrateForFilter(search.filter, search.userId);
      const results = runSearch(search.id, search.filter, search.userId);
      const queued = enqueueFitScores(
        search.userId,
        results.map((r) => r.jobId).slice(0, getSettings("research").maxScoredPerSearch),
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
function discoverIfDue() {
  if (!discoveryDue()) return;
  const [search] = followedSearches();
  if (!search) return;
  enqueueDiscovery(briefFor(search.filter, search.rawQuery), "schedule", search.id);
  console.log(`[discover] looking for companies like "${search.rawQuery}"`);
}

async function digestIfDue() {
  for (const userId of dueDigestUsers()) {
    const outcome = await runDigest(userId);
    console.log(`[digest] user ${userId}: ${outcome.status}${outcome.reason ? `: ${outcome.reason}` : ` — ${outcome.subject}`}`);
  }
}

/** Mailboxes are checked on their own interval (Admin → Mailbox sync), independent of job boards. */
function queueMailboxChecks() {
  for (const conn of dueConnections()) enqueueSync(conn, false);
}
queueMailboxChecks();
setInterval(queueMailboxChecks, 60_000);

const tick = async () => {
  pruneSessions();
  await refreshIfStale();
  discoverIfDue();
  await digestIfDue();
};
void tick();
setInterval(() => void tick(), 10 * 60_000);

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => process.exit(0));
