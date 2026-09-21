import { getSettings, type NormalizedJob, type SearchFilter } from "@jd/core";
import { getDb, one, schema } from "@jd/core/db";
import { and, count, eq, getTableColumns, inArray, isNull, like, or, type SQL } from "drizzle-orm";
import { adapters } from "./adapters";
import { hashJob } from "./crawl";
import { Semaphore, setPerHostConcurrency } from "./http";
import { matchJob } from "./match";
import { exclusionsFor } from "./search";
import { normalizeTitle } from "./text";

const { company, job } = schema;

/**
 * Workday and SmartRecruiters list endpoints give titles but no descriptions — and Workday
 * hides the locations of multi-site postings behind "5 Locations". Fetching a detail page per
 * posting at crawl time would mean thousands of requests per board, so those rows are stored
 * with needs_detail set and filled in here: for the handful of jobs a search actually matches,
 * and for any job you open.
 */

type PendingJob = typeof job.$inferSelect & { atsSlug: string; companyName: string };

async function pendingRows(where?: SQL): Promise<PendingJob[]> {
  return await getDb()
    .select({ ...getTableColumns(job), atsSlug: company.atsSlug, companyName: company.name })
    .from(job)
    .innerJoin(company, eq(company.id, job.companyId))
    .where(and(eq(job.needsDetail, true), where));
}

function toNormalized(r: PendingJob): NormalizedJob {
  return {
    externalId: r.externalId,
    title: r.title,
    url: r.url,
    applyUrl: r.applyUrl,
    locations: r.locations,
    locationType: r.locationType,
    remoteCountries: r.remoteCountries,
    department: r.department,
    comp: r.comp,
    descriptionHtml: r.descriptionHtml,
    descriptionText: r.descriptionText,
    postedAt: r.postedAt,
    needsDetail: r.needsDetail,
  };
}

/**
 * Fetches the detail page for each pending job and writes it back. Returns how many rows were
 * filled in. A request that fails leaves the row pending, so the next pass retries it.
 */
export async function hydrateJobs(rows: PendingJob[]): Promise<number> {
  if (!rows.length) return 0;
  const db = getDb();
  const { concurrency, perHostConcurrency } = await getSettings("sources");
  setPerHostConcurrency(perHostConcurrency);
  const sem = new Semaphore(concurrency);
  let filled = 0;

  await Promise.all(
    rows.map((r) =>
      sem.run(async () => {
        const hydrate = adapters[r.atsType].hydrate;
        if (!hydrate) {
          // Flagged by mistake — nothing more to fetch, so stop asking.
          await db.update(job).set({ needsDetail: false }).where(eq(job.id, r.id));
          return;
        }
        try {
          const full = await hydrate(r.atsSlug, toNormalized(r));
          await db.update(job)
            .set({
              url: full.url,
              locations: full.locations,
              locationType: full.locationType,
              remoteCountries: full.remoteCountries,
              comp: full.comp,
              descriptionHtml: full.descriptionHtml,
              descriptionText: full.descriptionText,
              postedAt: full.postedAt,
              needsDetail: full.needsDetail ?? false,
              contentHash: hashJob(full),
            })
            .where(eq(job.id, r.id));
          filled++;
        } catch (err) {
          console.warn(`[hydrate] job ${r.id} (${r.atsType}): ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    ),
  );
  return filled;
}

export async function hydrateByIds(jobIds: number[]): Promise<number> {
  return jobIds.length ? hydrateJobs(await pendingRows(inArray(job.id, jobIds))) : Promise.resolve(0);
}

/** Called when you open a job, so the description is there for analysis and fit scoring. */
export async function ensureJobDetail(jobId: number): Promise<number> {
  return await hydrateByIds([jobId]);
}

/**
 * Fills in the jobs a search could match. The title, level, exclusion and age rules run first
 * on data the list endpoint already gave us, so only their survivors cost a request — for a
 * "staff software engineer" search that is tens of jobs out of thousands, not thousands.
 */
export async function hydrateForFilter(filter: SearchFilter, userId?: number | null, limit = 300): Promise<number> {
  const { excludedCompanies, excludedTitleKeywords } = await exclusionsFor(userId);
  const narrowOn = filter.levelKeywords.length ? filter.levelKeywords : filter.roleKeywords;
  const titleClause = narrowOn.length
    ? or(...narrowOn.map((k) => like(job.titleNormalized, `%${normalizeTitle(k)}%`)))
    : undefined;

  // Location can't be judged before hydration, so let it pass here and leave it to runSearch.
  const withoutLocation: SearchFilter = { ...filter, locations: [], includeRemoteUS: true, remoteOnly: false };
  const wanted = (await pendingRows(and(isNull(job.closedAt), titleClause))).filter(
    (r) => matchJob(r, withoutLocation, { excludedCompanies, excludedTitleKeywords }).pass,
  );
  return hydrateJobs(wanted.slice(0, limit));
}

/** Open jobs still missing a description. Shown on the Companies page. */
export async function pendingDetailCount(): Promise<number> {
  return (
    (
      await one(
        getDb()
          .select({ n: count() })
          .from(job)
          .where(and(eq(job.needsDetail, true), isNull(job.closedAt))),
      )
    )?.n ?? 0
  );
}
