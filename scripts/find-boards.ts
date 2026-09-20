/**
 * Grows packages/sources/seed/companies.json by reading each candidate's own careers page to
 * find its job board. Unlike build-seed.ts (which guesses Greenhouse/Lever/Ashby slugs), this
 * follows what the site actually links to, so it also finds Workday and SmartRecruiters boards.
 *
 *   pnpm tsx scripts/find-boards.ts            # only candidates with no board yet
 *   pnpm tsx scripts/find-boards.ts --all      # re-check everything
 *   pnpm tsx scripts/find-boards.ts --dry-run  # report without writing
 */
import fs from "node:fs";
import path from "node:path";
import { findAtsForSite, type SeedCompany } from "@jd/sources";
import { Semaphore } from "../packages/sources/src/http";

const dir = path.join(import.meta.dirname, "../packages/sources/seed");
const seedFile = path.join(dir, "companies.json");
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

const existing = JSON.parse(fs.readFileSync(seedFile, "utf8")) as SeedCompany[];
const haveName = new Set(existing.map((c) => c.name));
const haveBoard = new Set(existing.map((c) => `${c.ats}:${c.slug.toLowerCase()}`));

const candidates = fs
  .readFileSync(path.join(dir, "candidates.txt"), "utf8")
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => {
    const [name = "", domain = ""] = l.split("|").map((s) => s.trim());
    return { name, domain };
  })
  .filter((c) => c.domain && (args.has("--all") || !haveName.has(c.name)));

console.log(`checking ${candidates.length} sites…`);

const sem = new Semaphore(6);
const found: SeedCompany[] = [];
const collisions: string[] = [];
const missing: string[] = [];
let done = 0;

await Promise.all(
  candidates.map((c) =>
    sem.run(async () => {
      let hit: Awaited<ReturnType<typeof findAtsForSite>> = null;
      try {
        hit = await findAtsForSite(c.domain);
      } catch {
        /* treated as not found */
      }
      done++;
      process.stdout.write(`\r${done}/${candidates.length}`);
      if (!hit) {
        missing.push(c.name);
        return;
      }
      const key = `${hit.atsType}:${hit.atsSlug.toLowerCase()}`;
      // Two companies resolving to one board means a bad detection, not two employers.
      if (haveBoard.has(key) || found.some((f) => `${f.ats}:${f.slug.toLowerCase()}` === key)) {
        collisions.push(`${c.name} -> ${key}`);
        return;
      }
      found.push({ name: c.name, domain: c.domain, ats: hit.atsType, slug: hit.atsSlug });
    }),
  ),
);

const byAts = found.reduce<Record<string, number>>((m, f) => ({ ...m, [f.ats]: (m[f.ats] ?? 0) + 1 }), {});
console.log(`\n\nfound ${found.length} new boards:`, byAts);
for (const f of found) console.log(`  ${f.name.padEnd(22)} ${f.ats.padEnd(16)} ${f.slug}`);
if (collisions.length) console.log(`\nskipped ${collisions.length} that pointed at a board already in the list:\n  ${collisions.join("\n  ")}`);
console.log(`\nstill no board for ${missing.length}: ${missing.join(", ")}`);

if (dryRun) {
  console.log("\n--dry-run: nothing written.");
} else if (found.length) {
  const merged = [...existing, ...found].sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(seedFile, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`\nwrote ${merged.length} companies to seed/companies.json. Run "pnpm seed" to import them.`);
}
