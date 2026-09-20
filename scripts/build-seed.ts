/**
 * Builds packages/sources/seed/companies.json from seed/candidates.txt by probing each
 * candidate's slug guesses against Greenhouse, Ashby, and Lever. Keeps boards with ≥1 open job.
 *   pnpm tsx scripts/build-seed.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { SeedCompany } from "@jd/sources";
import { Semaphore } from "../packages/sources/src/http";

const dir = path.join(import.meta.dirname, "../packages/sources/seed");

const probes = {
  greenhouse: async (slug: string) => {
    const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
    return r.ok ? ((await r.json()) as { jobs: unknown[] }).jobs.length : 0;
  },
  ashby: async (slug: string) => {
    const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
    return r.ok ? ((await r.json()) as { jobs?: unknown[] }).jobs?.length ?? 0 : 0;
  },
  lever: async (slug: string) => {
    const r = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json&limit=1`);
    if (!r.ok) return 0;
    const body = (await r.json()) as unknown;
    return Array.isArray(body) ? body.length : 0;
  },
} as const;

const candidates = fs
  .readFileSync(path.join(dir, "candidates.txt"), "utf8")
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => {
    const [name = "", domain = "", guesses = ""] = l.split("|").map((s) => s.trim());
    const slugs = guesses ? guesses.split(",").map((s) => s.trim()) : [name.toLowerCase().replace(/[^a-z0-9]/g, "")];
    return { name, domain, slugs };
  });

const sem = new Semaphore(12);
const found: SeedCompany[] = [];
const missing: string[] = [];

await Promise.all(
  candidates.map((c) =>
    sem.run(async () => {
      for (const slug of c.slugs) {
        for (const ats of ["greenhouse", "ashby", "lever"] as const) {
          try {
            if ((await probes[ats](slug)) > 0) {
              found.push({ name: c.name, domain: c.domain || undefined, ats, slug });
              return;
            }
          } catch {
            /* try next */
          }
        }
      }
      missing.push(c.name);
    }),
  ),
);

const seen = new Set<string>();
const unique = found
  .sort((a, b) => a.name.localeCompare(b.name))
  .filter((c) => (seen.has(`${c.ats}:${c.slug}`) ? false : (seen.add(`${c.ats}:${c.slug}`), true)));

fs.writeFileSync(path.join(dir, "companies.json"), JSON.stringify(unique, null, 2) + "\n");
const byAts = unique.reduce<Record<string, number>>((m, c) => ((m[c.ats] = (m[c.ats] ?? 0) + 1), m), {});
console.log(`verified ${unique.length}/${candidates.length}`, byAts);
console.log(`not found (${missing.length}): ${missing.sort().join(", ")}`);
