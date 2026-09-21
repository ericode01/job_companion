/** pnpm search "staff software engineer in NYC" */
import { initDb } from "@jd/core/db";
import { parseSearchQuery } from "@jd/llm";
import { hydrateForFilter, runSearch } from "@jd/sources";

await initDb();

const query = process.argv.slice(2).join(" ");
if (!query) {
  console.error('usage: pnpm search "staff software engineer in NYC"');
  process.exit(1);
}
const { filter, parsedBy, warning } = await parseSearchQuery(query);
if (warning) console.warn(`note: ${warning}`);
console.log(`filter (${parsedBy}):`, JSON.stringify(filter, null, 2));
const filled = await hydrateForFilter(filter, null);
if (filled) console.log(`fetched details for ${filled} jobs`);
const results = await runSearch(null, filter);
console.log(`\n${results.length} matches\n`);
for (const r of results.slice(0, 40)) {
  const pay = r.comp?.min ? ` $${Math.round(r.comp.min / 1000)}k–${Math.round((r.comp.max ?? r.comp.min) / 1000)}k` : "";
  const tag = r.matchReason === "remote_us" ? " [remote US]" : "";
  console.log(`- ${r.companyName}: ${r.title} — ${r.locations.join(" / ")}${tag}${pay}`);
}
