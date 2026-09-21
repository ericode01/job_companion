import { matchJobByUrl, recordCreated } from "@jd/apply";
import { type ApplicationStatus, getUserSettings } from "@jd/core";
import { getDb, one, returned, schema } from "@jd/core/db";
import { matchTitle, normalizeTitle } from "@jd/sources";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

/** An application as the linker sees it: whose company and which role. */
export interface TrackedApp {
  id: number;
  jobId: number | null;
  searchId: number | null;
  status: ApplicationStatus;
  confirmedAt: Date | null;
  company: string;
  companyDomain: string | null;
  title: string;
}

export async function trackedApplications(userId: number): Promise<TrackedApp[]> {
  const { application, job, company } = schema;
  return (
    await getDb()
      .select({
        id: application.id,
        jobId: application.jobId,
        searchId: application.searchId,
        status: application.status,
        confirmedAt: application.confirmedAt,
        appCompany: application.companyName,
        appTitle: application.jobTitle,
        jobTitle: job.title,
        companyName: company.name,
        companyDomain: company.domain,
      })
      .from(application)
      .leftJoin(job, eq(job.id, application.jobId))
      .leftJoin(company, eq(company.id, job.companyId))
      .where(eq(application.userId, userId))
  ).map((r) => ({
      id: r.id,
      jobId: r.jobId,
      searchId: r.searchId,
      status: r.status,
      confirmedAt: r.confirmedAt,
      company: r.companyName ?? r.appCompany ?? "Unknown company",
      companyDomain: r.companyDomain,
      title: r.jobTitle ?? r.appTitle ?? "Unknown role",
    }));
}

/* ---------- fuzzy company and title matching ---------- */

export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|pbc|the|hq)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whole-word containment, so "Block" doesn't match "Cityblock". */
export function sameCompany(a: string, b: string): boolean {
  const x = normalizeCompany(a);
  const y = normalizeCompany(b);
  if (!x || !y) return false;
  return x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `);
}

const SYNONYMS: Record<string, string> = { sr: "senior", jr: "junior", eng: "engineer", engr: "engineer", swe: "software engineer", mgr: "manager", pm: "product manager", ml: "machine learning", sde: "software engineer" };
const STOP = new Set(["the", "a", "an", "of", "and", "for", "to", "in", "at", "on", "with", "role", "position", "remote", "hybrid"]);

function titleTokens(title: string): Set<string> {
  const words = normalizeTitle(title)
    .split(" ")
    .flatMap((w) => (SYNONYMS[w] ?? w).split(" "))
    .filter((w) => w && !STOP.has(w));
  return new Set(words);
}

/** Jaccard overlap of title words, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const x = titleTokens(a);
  const y = titleTokens(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** Title overlap that's convincing enough to attach an email to a card by itself. */
const SURE_TITLE = 0.55;

const domainOf = (address: string | null) => address?.split("@")[1]?.toLowerCase() ?? "";
const underDomain = (domain: string, d: string) => domain === d || domain.endsWith(`.${d}`);

/* ---------- finding the application ---------- */

export interface LinkInput {
  threadId: string | null;
  links: string[];
  companyName: string | null;
  jobTitle: string | null;
  fromAddress: string | null;
  applicationRef: number | null;
}

export type LinkOutcome =
  | { kind: "linked"; applicationId: number; via: "thread" | "url" | "ref" | "company" }
  | { kind: "ambiguous"; candidates: number[] }
  | { kind: "none"; jobId: number | null };

export async function linkEmail(userId: number, input: LinkInput, apps: TrackedApp[]): Promise<LinkOutcome> {
  const byId = new Map(apps.map((a) => [a.id, a]));

  // 1. A reply in a thread that's already linked.
  if (input.threadId) {
    const prev = await one(
      getDb()
        .select({ applicationId: schema.emailMessage.applicationId })
        .from(schema.emailMessage)
        .where(and(eq(schema.emailMessage.userId, userId), eq(schema.emailMessage.threadId, input.threadId), isNotNull(schema.emailMessage.applicationId)))
        .orderBy(desc(schema.emailMessage.receivedAt)),
    );
    if (prev?.applicationId && byId.has(prev.applicationId)) return { kind: "linked", applicationId: prev.applicationId, via: "thread" };
  }

  // 2. A job-board link in the email.
  let urlJobId: number | null = null;
  for (const link of input.links) {
    const hit = await matchJobByUrl(link);
    if (!hit) continue;
    const app = apps.find((a) => a.jobId === hit.jobId);
    if (app) return { kind: "linked", applicationId: app.id, via: "url" };
    urlJobId ??= hit.jobId;
  }

  // 3. The classifier's pick, if the company agrees.
  const ref = input.applicationRef !== null ? byId.get(input.applicationRef) : undefined;
  if (ref && (!input.companyName || sameCompany(ref.company, input.companyName))) {
    if (!input.jobTitle || titleSimilarity(ref.title, input.jobTitle) >= SURE_TITLE) return { kind: "linked", applicationId: ref.id, via: "ref" };
  }

  // 4. Same company (by name or the sender's domain), then the closest title.
  const fromDomain = domainOf(input.fromAddress);
  const atCompany = apps.filter(
    (a) => (input.companyName && sameCompany(a.company, input.companyName)) || (fromDomain && a.companyDomain && underDomain(fromDomain, a.companyDomain)),
  );
  if (atCompany.length === 0) return { kind: "none", jobId: urlJobId ?? await findJobForExternal(input.companyName, input.jobTitle, input.fromAddress) };
  if (!input.jobTitle) {
    const active = atCompany.filter((a) => a.status !== "rejected" && a.status !== "withdrawn");
    if (atCompany.length === 1) return { kind: "linked", applicationId: atCompany[0]!.id, via: "company" };
    if (active.length === 1) return { kind: "linked", applicationId: active[0]!.id, via: "company" };
    return { kind: "ambiguous", candidates: atCompany.map((a) => a.id) };
  }
  const scored = atCompany.map((a) => ({ a, s: titleSimilarity(a.title, input.jobTitle!) })).sort((x, y) => y.s - x.s);
  const [best, second] = scored;
  // A clearly different role at the same company is a different application.
  if (best!.s < 0.3) return { kind: "none", jobId: urlJobId ?? await findJobForExternal(input.companyName, input.jobTitle, input.fromAddress) };
  // People apply to several roles at one company, and those emails look alike. Only a close title
  // match links on its own; a partial one waits in "Check these" rather than joining the wrong card.
  if (best!.s >= SURE_TITLE && (!second || best!.s - second.s >= 0.15)) return { kind: "linked", applicationId: best!.a.id, via: "company" };
  return { kind: "ambiguous", candidates: scored.filter((x) => x.s >= best!.s - 0.15).map((x) => x.a.id) };
}

/** A job we know (open or closed) for an application made elsewhere, so it can link to the job page. */
export async function findJobForExternal(companyName: string | null, jobTitle: string | null, fromAddress: string | null): Promise<number | null> {
  if (!jobTitle) return null;
  const db = getDb();
  const fromDomain = domainOf(fromAddress);
  const companies = (
    await db
      .select({ id: schema.company.id, name: schema.company.name, domain: schema.company.domain })
      .from(schema.company)
  ).filter((c) => (companyName && sameCompany(c.name, companyName)) || (fromDomain && c.domain && underDomain(fromDomain, c.domain)));
  if (!companies.length) return null;
  const jobs = await db
    .select({ id: schema.job.id, title: schema.job.title, closedAt: schema.job.closedAt })
    .from(schema.job)
    .where(inArray(schema.job.companyId, companies.map((c) => c.id)));
  const best = jobs
    .map((j) => ({ j, s: titleSimilarity(j.title, jobTitle) }))
    // Strict: "Payments Infrastructure" and "Payments Intelligence" are different jobs.
    .filter((x) => x.s >= 0.75)
    .sort((x, y) => y.s - x.s || Number(Boolean(x.j.closedAt)) - Number(Boolean(y.j.closedAt)))[0];
  return best?.j.id ?? null;
}

/** A link in the email that looks like the job posting itself. */
export function postingUrl(links: string[]): string | null {
  return (
    links.find((l) => /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com|workable\.com|icims\.com|jobvite\.com)\/.+/i.test(l) && !/unsubscribe|preferences/i.test(l)) ??
    links.find((l) => /\/(jobs?|careers?|positions?|openings?)\/[\w-]+/i.test(l) && !/unsubscribe|preferences|linkedin\.com\/comm/i.test(l)) ??
    null
  );
}

/**
 * Which dashboard an application lands in: the one whose search found the job, else the first
 * whose title rules fit, else the one you opened last.
 */
export async function chooseDashboard(userId: number, jobId: number | null, title: string | null): Promise<number | null> {
  const db = getDb();
  const live = await db
    .select({ id: schema.savedSearch.id, filter: schema.savedSearch.filter })
    .from(schema.savedSearch)
    .where(and(eq(schema.savedSearch.userId, userId), isNull(schema.savedSearch.archivedAt)))
    .orderBy(asc(schema.savedSearch.id));
  if (!live.length) return null;
  if (jobId !== null) {
    const hit = await one(
      db
        .select({ searchId: schema.jobMatch.searchId })
        .from(schema.jobMatch)
        .where(and(eq(schema.jobMatch.jobId, jobId), inArray(schema.jobMatch.searchId, live.map((d) => d.id))))
        .orderBy(asc(schema.jobMatch.searchId)),
    );
    if (hit) return hit.searchId;
  }
  if (title) {
    const { excludedTitleKeywords } = await getUserSettings(userId, "search");
    const fit = live.find((d) => matchTitle(title, d.filter, excludedTitleKeywords) === null);
    if (fit) return fit.id;
  }
  const last = (await one(db.select({ id: schema.user.lastSearchId }).from(schema.user).where(eq(schema.user.id, userId))))?.id;
  return live.find((d) => d.id === last)?.id ?? live.at(-1)!.id;
}

/** An application found only in email: the person applied somewhere without Job Companion. */
export async function createExternalApplication(
  userId: number,
  input: { companyName: string; jobTitle: string | null; jobUrl: string | null; jobId: number | null; status: ApplicationStatus; appliedAt: Date | null; confirmedAt: Date | null; emailId: number },
): Promise<TrackedApp> {
  const db = getDb();
  // Someone may already track that exact job (e.g. saved it); then this email belongs to it.
  if (input.jobId !== null) {
    const existing = await one(
      db
        .select({ id: schema.application.id })
        .from(schema.application)
        .where(and(eq(schema.application.userId, userId), eq(schema.application.jobId, input.jobId))),
    );
    if (existing) return (await trackedApplications(userId)).find((a) => a.id === existing.id)!;
  }
  const row = await returned(
    db
      .insert(schema.application)
      .values({
        userId,
        jobId: input.jobId,
        searchId: await chooseDashboard(userId, input.jobId, input.jobTitle),
        companyName: input.companyName,
        jobTitle: input.jobTitle,
        jobUrl: input.jobUrl,
        source: "email",
        status: input.status,
        appliedAt: input.appliedAt,
        confirmedAt: input.confirmedAt,
      })
      .returning(),
  );
  await recordCreated(row.id, input.status, "email", input.emailId);
  return (await trackedApplications(userId)).find((a) => a.id === row.id)!;
}
