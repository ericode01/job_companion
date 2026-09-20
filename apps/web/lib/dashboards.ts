import "server-only";
import { getSettings, getUserSettings, type PublicUser, type SearchFilter } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import { getExtensionState, pendingInboxCount } from "@jd/apply";
import { AI_KEY_HINT, hasApiKey } from "@jd/llm";
import { activeConnections, chooseDashboard, mailForCards, openActions, reviewQueue } from "@jd/mail";
import { currentMasterResume, enqueueFitScores, getFitScores } from "@jd/research";
import { hydrateForFilter, runSearch, type SearchResult } from "@jd/sources";
import { and, asc, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

const { savedSearch, jobMatch, job, application, company } = schema;
export type Dashboard = typeof savedSearch.$inferSelect;

export const dashboardName = (d: Pick<Dashboard, "name" | "rawQuery">) =>
  d.name?.trim() || d.rawQuery.charAt(0).toUpperCase() + d.rawQuery.slice(1);

/** A dashboard only if it belongs to this person. */
export function getDashboard(userId: number, id: number): Dashboard | null {
  if (!Number.isInteger(id)) return null;
  return getDb().select().from(savedSearch).where(and(eq(savedSearch.id, id), eq(savedSearch.userId, userId))).get() ?? null;
}

export interface DashboardSummary {
  id: number;
  name: string;
  rawQuery: string;
  notify: boolean;
  newCount: number;
}

/** The switcher's list: each dashboard with matches first seen since you last opened it. */
export function listDashboards(userId: number): DashboardSummary[] {
  const db = getDb();
  const rows = db
    .select()
    .from(savedSearch)
    .where(and(eq(savedSearch.userId, userId), isNull(savedSearch.archivedAt)))
    .orderBy(asc(savedSearch.id))
    .all();
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const newCounts = new Map(
    db
      .select({ searchId: jobMatch.searchId, n: count() })
      .from(jobMatch)
      .innerJoin(job, eq(job.id, jobMatch.jobId))
      .innerJoin(savedSearch, eq(savedSearch.id, jobMatch.searchId))
      .where(
        and(
          inArray(jobMatch.searchId, ids),
          isNull(job.closedAt),
          gt(job.firstSeenAt, sql`coalesce(${savedSearch.lastViewedAt}, ${savedSearch.createdAt})`),
        ),
      )
      .groupBy(jobMatch.searchId)
      .all()
      .map((r) => [r.searchId, r.n]),
  );
  return rows.map((r) => ({
    id: r.id,
    name: dashboardName(r),
    rawQuery: r.rawQuery,
    notify: r.notify,
    newCount: newCounts.get(r.id) ?? 0,
  }));
}

export function createDashboard(userId: number, input: { rawQuery: string; filter: SearchFilter; parsedBy: "llm" | "rules"; name?: string | null }): Dashboard {
  return getDb()
    .insert(savedSearch)
    .values({ userId, rawQuery: input.rawQuery, filter: input.filter, parsedBy: input.parsedBy, name: input.name ?? null })
    .returning()
    .get();
}

/**
 * Applications with no dashboard (made before dashboards existed, from a job opened elsewhere,
 * or found in email) go to the dashboard whose search found the job, else the one whose title
 * rules fit, else the one you opened last.
 */
export function assignOrphanApplications(userId: number): void {
  const db = getDb();
  const orphans = db
    .select({ id: application.id, jobId: application.jobId, title: sql<string | null>`coalesce(${job.title}, ${application.jobTitle})` })
    .from(application)
    .leftJoin(job, eq(job.id, application.jobId))
    .where(and(eq(application.userId, userId), isNull(application.searchId)))
    .all();
  for (const o of orphans) {
    const searchId = chooseDashboard(userId, o.jobId, o.title);
    if (searchId === null) return;
    db.update(application).set({ searchId }).where(eq(application.id, o.id)).run();
  }
}

export interface DashboardResult extends SearchResult {
  fitScore: number | null;
  isNew: boolean;
  applicationStatus: string | null;
}

/**
 * The Jobs tab: runs the dashboard's filter, queues fit scores, and marks what's new since
 * your last visit. Opening it counts as a visit.
 */
export async function dashboardResults(user: PublicUser, d: Dashboard, opts: { markViewed?: boolean; since?: Date | null } = {}) {
  const db = getDb();
  await hydrateForFilter(d.filter, user.id);
  const results = runSearch(d.id, d.filter, user.id);
  const jobIds = results.map((r) => r.jobId);
  const resume = currentMasterResume(user.id);
  const parsed = resume?.parseStatus === "done" ? resume : null;
  const { scoreSearchResults, maxScoredPerSearch } = getSettings("research");
  // Results are newest first, so the cap scores the freshest postings.
  if (parsed && scoreSearchResults) enqueueFitScores(user.id, jobIds.slice(0, maxScoredPerSearch), true);
  const scores = parsed ? getFitScores(jobIds, parsed.sourceHash) : new Map<number, number>();
  const apps = new Map(
    jobIds.length
      ? db
          .select({ jobId: application.jobId, status: application.status })
          .from(application)
          .where(and(eq(application.userId, user.id), inArray(application.jobId, jobIds)))
          .all()
          .map((a) => [a.jobId, a.status])
      : [],
  );
  // Polls pass back the first load's cut-off so "New" doesn't vanish once the visit is recorded.
  const since = opts.since ?? d.lastViewedAt ?? d.createdAt;
  const pendingFit =
    db
      .select({ n: count() })
      .from(schema.task)
      .where(and(eq(schema.task.kind, "score_fit"), inArray(schema.task.status, ["queued", "running"])))
      .get()?.n ?? 0;

  if (opts.markViewed) {
    db.update(savedSearch).set({ lastViewedAt: new Date() }).where(eq(savedSearch.id, d.id)).run();
    db.update(schema.user).set({ lastSearchId: d.id }).where(eq(schema.user.id, user.id)).run();
  }

  const rows: DashboardResult[] = results.map((r) => ({
    ...r,
    fitScore: scores.get(r.jobId) ?? null,
    isNew: r.firstSeenAt > since,
    applicationStatus: apps.get(r.jobId) ?? null,
  }));
  return {
    results: rows,
    newSince: since,
    fit: { resumeReady: Boolean(parsed), scored: scores.size, total: jobIds.length, limit: maxScoredPerSearch, pending: pendingFit },
  };
}

/**
 * Every application you're tracking, whichever search found it. The pipeline is about your
 * process, not about discovery, so it's one board; the search is a tag you can filter and change.
 * Applications on archived searches are included: nothing else in the app would show them.
 */
export function pipelineFor(userId: number) {
  assignOrphanApplications(userId);
  const db = getDb();
  const rows = db
    .select({
      id: application.id,
      jobId: application.jobId,
      searchId: application.searchId,
      status: application.status,
      source: application.source,
      notes: application.notes,
      appliedAt: application.appliedAt,
      confirmedAt: application.confirmedAt,
      updatedAt: application.updatedAt,
      jobUrl: application.jobUrl,
      title: sql<string>`coalesce(${job.title}, ${application.jobTitle}, 'Unknown role')`,
      locations: job.locations,
      comp: job.comp,
      closedAt: job.closedAt,
      companyId: company.id,
      companyName: sql<string>`coalesce(${company.name}, ${application.companyName}, 'Unknown company')`,
    })
    .from(application)
    .leftJoin(job, eq(job.id, application.jobId))
    .leftJoin(company, eq(company.id, job.companyId))
    .where(eq(application.userId, userId))
    .orderBy(desc(application.updatedAt))
    .all();
  const resume = currentMasterResume(userId);
  const jobIds = rows.map((r) => r.jobId).filter((id): id is number => id !== null);
  const scores = resume ? getFitScores(jobIds, resume.sourceHash) : new Map<number, number>();
  const mail = mailForCards(userId, rows.map((r) => r.id));
  return rows.map((r) => {
    const m = mail.get(r.id);
    return {
      ...r,
      locations: r.locations ?? [],
      fitScore: r.jobId !== null ? (scores.get(r.jobId) ?? null) : null,
      emailCount: m?.emailCount ?? 0,
      openActions: m?.openActions ?? 0,
      rounds: m?.rounds ?? [],
      lastEmailAt: m?.lastEmailAt ?? null,
    };
  });
}

/** The pipeline's filter chips: your live searches, plus archived ones that still hold cards. */
export function pipelineSearches(userId: number): { id: number; name: string; archived: boolean }[] {
  const db = getDb();
  const withCards = new Set(
    db
      .selectDistinct({ searchId: application.searchId })
      .from(application)
      .where(eq(application.userId, userId))
      .all()
      .flatMap((r) => (r.searchId === null ? [] : [r.searchId])),
  );
  return db
    .select()
    .from(savedSearch)
    .where(eq(savedSearch.userId, userId))
    .orderBy(asc(savedSearch.id))
    .all()
    .filter((d) => !d.archivedAt || withCards.has(d.id))
    .map((d) => ({ id: d.id, name: dashboardName(d), archived: Boolean(d.archivedAt) }));
}

/* ---------------- the companion ---------------- */

export interface CompanionStep {
  id: string;
  title: string;
  detail: string;
  action: { label: string; href: string };
  tone: "setup" | "action" | "progress";
}

/**
 * What to do next, most useful first. Setup gaps come before job actions, because every later
 * step (fit scores, auto-filled forms) depends on them.
 */
export function companionSteps(user: PublicUser, d: Dashboard, stats: { newStrong: number; newCount: number }): CompanionStep[] {
  const steps: CompanionStep[] = [];
  // People waiting on a reply come first: they're time-sensitive, and nothing else is.
  const mailSteps: CompanionStep[] = [];
  const mailboxes = activeConnections(user.id);
  const reauth = mailboxes.find((c) => c.status === "needs_reauth");
  if (reauth) {
    mailSteps.push({
      id: "mail-reauth",
      title: `Reconnect ${reauth.address}`,
      detail: "I lost access to your mailbox, so replies from companies aren't reaching your pipeline.",
      action: { label: "Reconnect", href: "/mailbox" },
      tone: "setup",
    });
  }
  // Applications are yours, not a search's, so these steps count all of them wherever you are.
  const actions = openActions(user.id);
  if (actions.length > 0) {
    const first = actions[0]!;
    mailSteps.push({
      id: "mail-actions",
      title: actions.length === 1 ? `${first.company}: ${first.actionText}` : `${actions.length} emails need your reply`,
      detail:
        actions.length === 1
          ? `About ${first.title}${first.actionDueAt ? `, due ${first.actionDueAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: user.timezone })}` : ""}.`
          : `First up: ${first.company}, ${first.actionText.charAt(0).toLowerCase()}${first.actionText.slice(1)}.`,
      action: { label: actions.length === 1 ? "Open" : "See them", href: `/pipeline${actions.length === 1 ? `?app=${first.applicationId}` : ""}` },
      tone: "action",
    });
  }
  const review = reviewQueue(user.id).length;
  if (review > 0) {
    mailSteps.push({
      id: "mail-review",
      title: `${review} email${review === 1 ? " needs" : "s need"} a quick check`,
      detail: "I wasn't sure what they mean for your applications, so I haven't moved anything.",
      action: { label: "Check them", href: "/pipeline#check" },
      tone: "action",
    });
  }
  steps.push(...mailSteps);
  const resume = currentMasterResume(user.id);
  if (!resume) {
    steps.push({
      id: "resume",
      title: "Add your resume so I can score every job for fit",
      detail: "Fit scores rank this list, and your resume fills applications for you.",
      action: { label: "Add resume", href: "/profile#resume" },
      tone: "setup",
    });
  } else if (resume.parseStatus === "failed" || resume.parseStatus === "skipped") {
    steps.push({
      id: "resume-parse",
      title: "Your resume couldn't be read yet",
      detail: resume.parseError ?? "Open your profile to retry.",
      action: { label: "Fix resume", href: "/profile#resume" },
      tone: "setup",
    });
  }
  const inbox = pendingInboxCount(user.id);
  if (inbox > 0) {
    steps.push({
      id: "inbox",
      title: `Answer ${inbox} recurring question${inbox === 1 ? "" : "s"} once`,
      detail: "Application forms keep asking these. Answer them here and they fill themselves next time.",
      action: { label: "Answer now", href: "/answers" },
      tone: "setup",
    });
  }
  const ext = getExtensionState(user.id);
  if (!ext.lastSeenAt) {
    steps.push({
      id: "extension",
      title: "Set up the Chrome extension for near one-click applying",
      detail: "It fills application forms from your profile and answers. You always press Submit yourself.",
      action: { label: "Set it up", href: "/extension" },
      tone: "setup",
    });
  }
  if (stats.newStrong > 0) {
    steps.push({
      id: "strong",
      title: `${stats.newStrong} new strong match${stats.newStrong === 1 ? "" : "es"} since your last visit`,
      detail: "Scored 80 or higher against your resume.",
      action: { label: "Review them", href: `/d/${d.id}?fit=80&new=1` },
      tone: "action",
    });
  } else if (stats.newCount > 0) {
    steps.push({
      id: "new",
      title: `${stats.newCount} new job${stats.newCount === 1 ? "" : "s"} since your last visit`,
      detail: "Marked New in the list below.",
      action: { label: "Show new", href: `/d/${d.id}?new=1` },
      tone: "action",
    });
  }
  const db = getDb();
  const stalled =
    db
      .select({ n: count() })
      .from(application)
      .where(and(eq(application.userId, user.id), eq(application.status, "applying"), sql`${application.updatedAt} < ${Date.now() - 2 * 86_400_000}`))
      .get()?.n ?? 0;
  if (stalled > 0) {
    steps.push({
      id: "stalled",
      title: `${stalled} application${stalled === 1 ? " is" : "s are"} still in progress`,
      detail: "Started more than two days ago and not submitted yet.",
      action: { label: "Open pipeline", href: "/pipeline" },
      tone: "progress",
    });
  }
  if (mailboxes.length === 0 && getSettings("mailSync").enabled) {
    const applied =
      db
        .select({ n: count() })
        .from(application)
        .where(and(eq(application.userId, user.id), inArray(application.status, ["applied", "interview", "offer"])))
        .get()?.n ?? 0;
    if (applied > 0) {
      steps.push({
        id: "mail-connect",
        title: "Let your pipeline update itself from email",
        detail: "Connect your inbox, read-only, and confirmations, interviews and rejections move your cards for you.",
        action: { label: "Connect inbox", href: "/mailbox" },
        tone: "setup",
      });
    }
  }
  if (!d.notify && getUserSettings(user.id, "digest").enabled) {
    steps.push({
      id: "digest",
      title: "Get this search's new matches by email",
      detail: "Your daily digest is on, but this dashboard isn't in it.",
      action: { label: "Add to digest", href: `/d/${d.id}/digest` },
      tone: "setup",
    });
  }
  if (!hasApiKey()) {
    steps.unshift({
      id: "api-key",
      title: "AI features are off on this server",
      detail: `An admin needs to set ${AI_KEY_HINT}. Search still works with built-in rules.`,
      action: { label: "Learn more", href: "/account" },
      tone: "setup",
    });
  }
  return steps;
}

/** What changed since your last visit, for the companion card. Cheap: no search is run. */
export function sinceLastVisit(userId: number, d: Dashboard): { newCount: number; newStrong: number } {
  const db = getDb();
  const since = d.lastViewedAt ?? d.createdAt;
  const fresh = db
    .select({ jobId: jobMatch.jobId })
    .from(jobMatch)
    .innerJoin(job, eq(job.id, jobMatch.jobId))
    .where(and(eq(jobMatch.searchId, d.id), isNull(job.closedAt), gt(job.firstSeenAt, since)))
    .all()
    .map((r) => r.jobId);
  const resume = currentMasterResume(userId);
  const scores = resume?.parseStatus === "done" && fresh.length ? getFitScores(fresh, resume.sourceHash) : new Map<number, number>();
  return { newCount: fresh.length, newStrong: [...scores.values()].filter((s) => s >= 80).length };
}

export function archivedDashboards(userId: number): { id: number; name: string; archivedAt: Date }[] {
  return getDb()
    .select()
    .from(savedSearch)
    .where(and(eq(savedSearch.userId, userId), sql`${savedSearch.archivedAt} is not null`))
    .orderBy(desc(savedSearch.archivedAt))
    .all()
    .map((d) => ({ id: d.id, name: dashboardName(d), archivedAt: d.archivedAt! }));
}
