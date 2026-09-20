import { getDb, schema } from "@jd/core/db";
import type { AtsType } from "@jd/core";
import { getSettings } from "@jd/core";
import { adapters, boardName, detectAts } from "./adapters";
import { findAtsForSite, originOf } from "./detect-site";
import { HttpError } from "./http";
import { storeCompanyJobs } from "./crawl";

export interface SeedCompany {
  name: string;
  domain?: string;
  ats: AtsType;
  slug: string;
}

/** Inserts seed rows, skipping (ats, slug) pairs that already exist. Returns inserted count. */
export function importSeedCompanies(rows: SeedCompany[]): number {
  const db = getDb();
  let inserted = 0;
  db.transaction((tx) => {
    for (const r of rows) {
      const res = tx
        .insert(schema.company)
        .values({ name: r.name, domain: r.domain ?? null, atsType: r.ats, atsSlug: r.slug, source: "seed" })
        .onConflictDoNothing()
        .run();
      inserted += res.changes;
    }
  });
  return inserted;
}

export class AddCompanyError extends Error {}

/**
 * Adds a company from a job-board URL or, failing that, from its website: the careers page is
 * read to find which ATS it uses. Either way the board is verified before anything is stored.
 */
export async function addCompanyFromUrl(url: string, name?: string) {
  let hit = detectAts(url);
  let domain: string | null = null;
  if (!hit) {
    const site = await findAtsForSite(url);
    if (!site) {
      throw new AddCompanyError(
        "That isn't a Greenhouse, Lever, Ashby, Workday or SmartRecruiters board, and no board was found on that site. Try pasting the job board URL itself.",
      );
    }
    hit = { type: site.atsType, slug: site.atsSlug };
    domain = originOf(url)?.replace(/^https?:\/\//, "").replace(/^www\./, "") ?? null;
  }
  let result;
  try {
    result = await adapters[hit.type].listJobs(hit.slug, { maxJobs: getSettings("sources").maxJobsPerBoard });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new AddCompanyError(`No ${hit.type} job board found for "${hit.slug}".`);
    }
    throw err;
  }
  const db = getDb();
  const displayName = name?.trim() || result.companyName || boardName(hit.type, hit.slug);
  const row = db
    .insert(schema.company)
    .values({ name: displayName, domain, atsType: hit.type, atsSlug: hit.slug, source: "manual", watch: true })
    .onConflictDoUpdate({
      target: [schema.company.atsType, schema.company.atsSlug],
      set: { watch: true, enabled: true },
    })
    .returning()
    .get();
  const counts = storeCompanyJobs(row.id, hit.type, result.jobs);
  return { company: row, ...counts };
}

