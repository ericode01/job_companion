import { getUser, getUserSettings, type Comp } from "@jd/core";
import { getDb, one, schema } from "@jd/core/db";
import { pendingInboxCount } from "@jd/apply";
import { emailChangesSince, openActions, type ActionItem, type EmailChange } from "@jd/mail";
import { currentMasterResume, getFit } from "@jd/research";
import { runSearch } from "@jd/sources";
import { and, desc, eq, isNull } from "drizzle-orm";

export interface DigestJob {
  jobId: number;
  title: string;
  companyName: string;
  locations: string[];
  comp: Comp | null;
  fitScore: number | null;
  fitSummary: string | null;
  matchReason: "location" | "remote_us";
  postedAt: Date | null;
}

export interface DigestSection {
  searchId: number;
  /** The dashboard's name. */
  query: string;
  minFitScore: number;
  jobs: DigestJob[];
  /** Matches that were new but scored below your minimum. */
  belowThreshold: number;
}

export interface Digest {
  sections: DigestSection[];
  total: number;
  /** Emails asking you to do something, across all your searches. Shown first. */
  actions: ActionItem[];
  /** Pipeline moves your email made since the last digest. */
  changes: EmailChange[];
  /** The person's time zone, for due dates. */
  timeZone: string;
  since: Date;
  until: Date;
  pendingQuestions: number;
  minFitScore: number;
  resumeReady: boolean;
}

const MAX_PER_SEARCH = 25;

export async function lastDigestAt(userId: number): Promise<Date | null> {
  const row = await one(
    getDb()
      .select()
      .from(schema.digestRun)
      .where(eq(schema.digestRun.userId, userId))
      .orderBy(desc(schema.digestRun.id))
      .limit(1),
  );
  return row?.coveredUntil ?? null;
}

/**
 * One person's email: new jobs since their last digest, a section per dashboard whose Digest
 * tab is on. "New" means first seen after the last digest, so nothing is reported twice, and a
 * job that matches two dashboards appears only in the first.
 */
export async function buildDigest(userId: number, now = new Date()): Promise<Digest> {
  const { minFitScore } = await getUserSettings(userId, "digest");
  // First run: look back a day rather than dumping the whole database.
  const since = await lastDigestAt(userId) ?? new Date(now.getTime() - 86_400_000);
  const resume = await currentMasterResume(userId);
  const resumeReady = resume?.parseStatus === "done";

  const sections: DigestSection[] = [];
  const seen = new Set<number>();

  for (const search of await followedSearches(userId)) {
    const threshold = search.digestMinFit ?? minFitScore;
    const results = (await runSearch(null, search.filter, userId)).filter((r) => r.firstSeenAt > since && !seen.has(r.jobId));
    const jobs: DigestJob[] = [];
    let belowThreshold = 0;
    for (const r of results) {
      const fit = resumeReady ? await getFit(r.jobId, resume!.sourceHash) : null;
      const fitScore = fit?.score ?? null;
      if (resumeReady && fitScore !== null && fitScore < threshold) {
        belowThreshold++;
        continue;
      }
      jobs.push({
        jobId: r.jobId,
        title: r.title,
        companyName: r.companyName,
        locations: r.locations,
        comp: r.comp,
        fitScore,
        fitSummary: fit?.data.summary ?? null,
        matchReason: r.matchReason,
        postedAt: r.postedAt,
      });
      seen.add(r.jobId);
    }
    jobs.sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1));
    if (jobs.length || belowThreshold) {
      sections.push({
        searchId: search.id,
        query: search.name ?? search.rawQuery,
        minFitScore: threshold,
        jobs: jobs.slice(0, MAX_PER_SEARCH),
        belowThreshold,
      });
    }
  }

  const pendingQuestions = await pendingInboxCount(userId);
  return {
    sections,
    total: sections.reduce((n, s) => n + s.jobs.length, 0),
    actions: (await openActions(userId)).slice(0, 15),
    timeZone: (await getUser(userId))?.timezone ?? "UTC",
    changes: await emailChangesSince(userId, since),
    since,
    until: now,
    pendingQuestions,
    minFitScore,
    resumeReady,
  };
}

/** A person's dashboards whose Digest tab is on (all people's when userId is omitted). */
export async function followedSearches(userId?: number) {
  const { savedSearch } = schema;
  return await getDb()
    .select()
    .from(savedSearch)
    .where(
      and(
        eq(savedSearch.notify, true),
        isNull(savedSearch.archivedAt),
        userId === undefined ? undefined : eq(savedSearch.userId, userId),
      ),
    )
    .orderBy(savedSearch.id);
}
