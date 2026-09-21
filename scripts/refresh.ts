/** pnpm refresh — one scheduled pass: crawl job boards, score new matches, send the digests that are due. */
import { getSettings, hasRunnableTasks, loadEnv } from "@jd/core";
import { initDb } from "@jd/core/db";
import { dueDigestUsers, followedSearches, runDigest } from "@jd/digest";
import { briefFor, discoveryDue, enqueueDiscovery, enqueueFitScores, startWorker } from "@jd/research";
import { hydrateForFilter, runCrawl, runSearch } from "@jd/sources";

loadEnv();
await initDb();
await startWorker({ pollMs: 500 });

const started = Date.now();
await runCrawl({ trigger: "schedule", onProgress: ({ done, total }) => process.stdout.write(`\rcrawled ${done}/${total}`) });
console.log(`\ncrawl finished in ${((Date.now() - started) / 1000).toFixed(0)}s`);

const searches = await followedSearches();
for (const search of searches) {
  if (!search.userId) continue;
  await hydrateForFilter(search.filter, search.userId);
  const results = await runSearch(search.id, search.filter, search.userId);
  const queued = await enqueueFitScores(search.userId, results.map((r) => r.jobId).slice(0, (await getSettings("research")).maxScoredPerSearch), true);
  console.log(`"${search.name ?? search.rawQuery}": ${results.length} matches, ${queued} queued for scoring`);
}

const [first] = searches;
if (first && await discoveryDue()) {
  await enqueueDiscovery(briefFor(first.filter, first.rawQuery), "schedule", first.id);
  console.log(`looking for new companies like "${first.rawQuery}"`);
}

// Let fit scoring and any company search finish so the digest can rank and filter by fit.
const deadline = Date.now() + 10 * 60_000;
while (await hasRunnableTasks() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 2000));

for (const userId of await dueDigestUsers()) {
  const outcome = await runDigest(userId);
  console.log(`digest for user ${userId}: ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ` — ${outcome.subject}`}`);
}
process.exit(0);
