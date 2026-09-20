import crypto from "node:crypto";
import { getSettings, type AtsType, type NormalizedJob } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import { and, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { adapters } from "./adapters";
import { HttpError, Semaphore, setPerHostConcurrency } from "./http";
import { normalizeTitle } from "./text";

const { company, job, crawlRun } = schema;

export function hashJob(j: NormalizedJob): string {
  return crypto
    .createHash("sha1")
    .update(JSON.stringify([j.title, j.locations, j.locationType, j.comp, j.descriptionText]))
    .digest("hex");
}

/** Upserts one company's postings and closes jobs that disappeared. Returns counts. */
export function storeCompanyJobs(companyId: number, atsType: AtsType, jobs: NormalizedJob[], seenAt = new Date()) {
  const db = getDb();
  return db.transaction((tx) => {
    for (const j of jobs) {
      const values = {
        companyId,
        atsType,
        externalId: j.externalId,
        url: j.url,
        applyUrl: j.applyUrl,
        title: j.title,
        titleNormalized: normalizeTitle(j.title),
        department: j.department,
        locations: j.locations,
        locationType: j.locationType,
        remoteCountries: j.remoteCountries,
        comp: j.comp,
        descriptionHtml: j.descriptionHtml,
        descriptionText: j.descriptionText,
        postedAt: j.postedAt,
        needsDetail: j.needsDetail ?? false,
        contentHash: hashJob(j),
      };
      // A list-only payload has no description, so re-crawling must not wipe a hydrated row.
      const { descriptionHtml, descriptionText, comp, locations, locationType, needsDetail, ...rest } = values;
      const onConflict = j.needsDetail
        ? { ...rest, lastSeenAt: seenAt, closedAt: null }
        : { ...values, lastSeenAt: seenAt, closedAt: null };
      tx.insert(job)
        .values({ ...values, firstSeenAt: seenAt, lastSeenAt: seenAt })
        .onConflictDoUpdate({ target: [job.atsType, job.companyId, job.externalId], set: onConflict })
        .run();
    }
    const ids = jobs.map((j) => j.externalId);
    const closed = tx
      .update(job)
      .set({ closedAt: seenAt })
      .where(
        and(
          eq(job.companyId, companyId),
          isNull(job.closedAt),
          ids.length ? notInArray(job.externalId, ids) : sql`1 = 1`,
        ),
      )
      .run();
    tx.update(company)
      .set({ lastCrawledAt: seenAt, crawlStatus: "ok", crawlError: null, openJobCount: jobs.length })
      .where(eq(company.id, companyId))
      .run();
    return { upserted: jobs.length, closed: closed.changes };
  });
}

export interface CrawlOptions {
  trigger: "search" | "manual" | "schedule";
  /** Ignore refresh interval and crawl everything enabled. */
  force?: boolean;
  companyIds?: number[];
  onProgress?: (p: { done: number; total: number; failed: number }) => void;
}

export function staleCompanies(opts: Pick<CrawlOptions, "force" | "companyIds"> = {}) {
  const { enabledAts, refreshIntervalHours } = getSettings("sources");
  const cutoff = new Date(Date.now() - refreshIntervalHours * 3_600_000);
  const db = getDb();
  return db
    .select({ id: company.id, atsType: company.atsType, atsSlug: company.atsSlug, name: company.name })
    .from(company)
    .where(
      and(
        eq(company.enabled, true),
        inArray(company.atsType, enabledAts),
        opts.companyIds?.length ? inArray(company.id, opts.companyIds) : undefined,
        opts.force ? undefined : or(isNull(company.lastCrawledAt), lt(company.lastCrawledAt, cutoff)),
      ),
    )
    .orderBy(sql`${company.watch} desc`, company.lastCrawledAt)
    .all();
}

/** Returns the running crawl, if any (only one crawl runs at a time). */
export function activeCrawl() {
  return getDb().select().from(crawlRun).where(eq(crawlRun.status, "running")).get();
}

export async function runCrawl(opts: CrawlOptions): Promise<number> {
  const db = getDb();
  const { concurrency, perHostConcurrency, maxJobsPerBoard } = getSettings("sources");
  setPerHostConcurrency(perHostConcurrency);
  const targets = staleCompanies(opts);
  const run = db.insert(crawlRun).values({ trigger: opts.trigger, status: "running", total: targets.length }).returning().get();

  let done = 0;
  let failed = 0;
  let upserted = 0;
  let closedTotal = 0;
  const sem = new Semaphore(concurrency);
  const flush = () => {
    db.update(crawlRun).set({ done, failed, jobsUpserted: upserted, jobsClosed: closedTotal }).where(eq(crawlRun.id, run.id)).run();
    opts.onProgress?.({ done, total: targets.length, failed });
  };

  try {
    await Promise.all(
      targets.map((c) =>
        sem.run(async () => {
          try {
            const { jobs } = await adapters[c.atsType].listJobs(c.atsSlug, { maxJobs: maxJobsPerBoard });
            const r = storeCompanyJobs(c.id, c.atsType, jobs);
            upserted += r.upserted;
            closedTotal += r.closed;
          } catch (err) {
            failed++;
            const notFound = err instanceof HttpError && err.status === 404;
            db.update(company)
              .set({
                lastCrawledAt: new Date(),
                crawlStatus: notFound ? "not_found" : "error",
                crawlError: String(err instanceof Error ? err.message : err).slice(0, 500),
                // A board that 404s is gone or renamed; stop crawling it until re-enabled.
                ...(notFound ? { enabled: false } : {}),
              })
              .where(eq(company.id, c.id))
              .run();
          } finally {
            done++;
            if (done % 5 === 0 || done === targets.length) flush();
          }
        }),
      ),
    );
    db.update(crawlRun).set({ status: "done", finishedAt: new Date() }).where(eq(crawlRun.id, run.id)).run();
  } catch (err) {
    db.update(crawlRun)
      .set({ status: "failed", finishedAt: new Date(), error: String(err) })
      .where(eq(crawlRun.id, run.id))
      .run();
    throw err;
  } finally {
    flush();
  }
  return run.id;
}
