import { getUserSettings, type Comp, type LocationType, type SearchFilter } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import { and, eq, gte, isNull, like, or, sql } from "drizzle-orm";
import { matchJob, type RuleResult } from "./match";
import { normalizeTitle } from "./text";

const { job, company, jobMatch } = schema;

export interface SearchResult {
  jobId: number;
  /** Other postings collapsed into this row (same company + title). */
  duplicateJobIds: number[];
  title: string;
  companyId: number;
  companyName: string;
  atsType: string;
  url: string;
  applyUrl: string;
  locations: string[];
  locationType: LocationType;
  matchReason: "location" | "remote_us";
  comp: Comp | null;
  postedAt: Date | null;
  firstSeenAt: Date;
  department: string | null;
}

/** A person's "never show" lists; empty when the search isn't anyone's (CLI use). */
export function exclusionsFor(userId: number | null | undefined): { excludedCompanies: string[]; excludedTitleKeywords: string[] } {
  if (!userId) return { excludedCompanies: [], excludedTitleKeywords: [] };
  const { excludedCompanies, excludedTitleKeywords } = getUserSettings(userId, "search");
  return { excludedCompanies, excludedTitleKeywords };
}

/** Applies the rule filter over open jobs, records matches, and returns deduped results (newest first). */
export function runSearch(searchId: number | null, filter: SearchFilter, userId?: number | null): SearchResult[] {
  const db = getDb();
  const { excludedCompanies, excludedTitleKeywords } = exclusionsFor(userId);
  const now = new Date();

  // Cheap SQL narrowing on the most selective keyword group; exact matching happens in matchJob.
  const narrowOn = filter.levelKeywords.length ? filter.levelKeywords : filter.roleKeywords;
  const titleClause = narrowOn.length
    ? or(...narrowOn.map((k) => like(job.titleNormalized, `%${normalizeTitle(k)}%`)))
    : undefined;
  const ageClause =
    filter.postedWithinDays !== null
      ? or(isNull(job.postedAt), gte(job.postedAt, new Date(now.getTime() - filter.postedWithinDays * 86_400_000)))
      : undefined;

  const rows = db
    .select({
      jobId: job.id,
      title: job.title,
      titleNormalized: job.titleNormalized,
      companyId: company.id,
      companyName: company.name,
      atsType: job.atsType,
      url: job.url,
      applyUrl: job.applyUrl,
      locations: job.locations,
      locationType: job.locationType,
      remoteCountries: job.remoteCountries,
      comp: job.comp,
      postedAt: job.postedAt,
      firstSeenAt: job.firstSeenAt,
      department: job.department,
    })
    .from(job)
    .innerJoin(company, eq(company.id, job.companyId))
    .where(and(isNull(job.closedAt), titleClause, ageClause))
    .all();

  const passed: { row: (typeof rows)[number]; rule: RuleResult }[] = [];
  for (const row of rows) {
    const rule = matchJob(row, filter, { excludedCompanies, excludedTitleKeywords, now });
    if (rule.pass) passed.push({ row, rule });
  }

  if (searchId !== null && passed.length) {
    db.transaction((tx) => {
      for (const { row } of passed) {
        tx.insert(jobMatch).values({ jobId: row.jobId, searchId, rulePass: true }).onConflictDoNothing().run();
      }
      tx.update(schema.savedSearch).set({ lastRunAt: now }).where(eq(schema.savedSearch.id, searchId)).run();
    });
  }

  const grouped = new Map<string, SearchResult>();
  for (const { row, rule } of passed) {
    const key = `${row.companyId}:${row.titleNormalized}`;
    const existing = grouped.get(key);
    const reason = rule.location?.match ? rule.location.reason : "location";
    if (existing) {
      existing.duplicateJobIds.push(row.jobId);
      for (const l of row.locations) if (!existing.locations.includes(l)) existing.locations.push(l);
      if (reason === "location") existing.matchReason = "location";
      if (row.postedAt && (!existing.postedAt || row.postedAt > existing.postedAt)) existing.postedAt = row.postedAt;
      existing.comp ??= row.comp;
      continue;
    }
    grouped.set(key, {
      jobId: row.jobId,
      duplicateJobIds: [],
      title: row.title,
      companyId: row.companyId,
      companyName: row.companyName,
      atsType: row.atsType,
      url: row.url,
      applyUrl: row.applyUrl,
      locations: [...row.locations],
      locationType: row.locationType,
      matchReason: reason,
      comp: row.comp,
      postedAt: row.postedAt,
      firstSeenAt: row.firstSeenAt,
      department: row.department,
    });
  }

  const ts = (r: SearchResult) => (r.postedAt ?? r.firstSeenAt).getTime();
  return [...grouped.values()].sort((a, b) => ts(b) - ts(a));
}

export function countOpenJobs(): { jobs: number; companies: number } {
  const db = getDb();
  const j = db.select({ n: sql<number>`count(*)` }).from(job).where(isNull(job.closedAt)).get();
  const c = db.select({ n: sql<number>`count(*)` }).from(company).where(eq(company.enabled, true)).get();
  return { jobs: j?.n ?? 0, companies: c?.n ?? 0 };
}
