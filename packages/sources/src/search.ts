import { getUserSettings, type Comp, type LocationType, type SearchFilter } from "@jd/core";
import { getDb, one, schema } from "@jd/core/db";
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
export async function exclusionsFor(userId: number | null | undefined): Promise<{ excludedCompanies: string[]; excludedTitleKeywords: string[] }> {
  if (!userId) return { excludedCompanies: [], excludedTitleKeywords: [] };
  const { excludedCompanies, excludedTitleKeywords } = await getUserSettings(userId, "search");
  return { excludedCompanies, excludedTitleKeywords };
}

/** Applies the rule filter over open jobs, records matches, and returns deduped results (newest first). */
export async function runSearch(searchId: number | null, filter: SearchFilter, userId?: number | null): Promise<SearchResult[]> {
  const db = getDb();
  const { excludedCompanies, excludedTitleKeywords } = await exclusionsFor(userId);
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

  const rows = await db
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
    .where(and(isNull(job.closedAt), titleClause, ageClause));

  const passed: { row: (typeof rows)[number]; rule: RuleResult }[] = [];
  for (const row of rows) {
    const rule = matchJob(row, filter, { excludedCompanies, excludedTitleKeywords, now });
    if (rule.pass) passed.push({ row, rule });
  }

  if (searchId !== null && passed.length) {
    await db.transaction(async (tx) => {
      for (const { row } of passed) {
        await tx.insert(jobMatch).values({ jobId: row.jobId, searchId, rulePass: true }).onConflictDoNothing();
      }
      await tx.update(schema.savedSearch).set({ lastRunAt: now }).where(eq(schema.savedSearch.id, searchId));
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

export async function countOpenJobs(): Promise<{ jobs: number; companies: number }> {
  const db = getDb();
  const j = await one(db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(job).where(isNull(job.closedAt)));
  const c = await one(db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(company).where(eq(company.enabled, true)));
  return { jobs: j?.n ?? 0, companies: c?.n ?? 0 };
}
