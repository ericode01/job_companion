import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getSettings, type DiscoveryCandidate, type SearchFilter } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import { assertBudget, forModel, parseStructured, recordMessageUsage } from "@jd/llm";
import { adapters, boardName, findAtsForSite, storeCompanyJobs } from "@jd/sources";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { assertNativeSearch } from "./company";
import { assertUsableStop, NonRetryableError, textOf } from "./util";

const { company, discoveryRun } = schema;
export type DiscoveryRunRow = typeof discoveryRun.$inferSelect;

const SEARCH_SYSTEM = `You find technology companies a job seeker should be watching, so their openings can be pulled from the company's own job board.

Use web search. Good sources: "companies hiring <role> in <place>" roundups, recent funding announcements, startup directories, local tech-scene lists, and "best places to work" lists.

For each company give, on its own line:
NAME | website domain (no protocol, no path) | one short reason it fits | the URL you found it on | its job board URL if you are sure of it, otherwise a dash

A job board URL looks like job-boards.greenhouse.io/<company>, jobs.lever.co/<company>, jobs.ashbyhq.com/<company>, <company>.wdN.myworkdayjobs.com/<site> or jobs.smartrecruiters.com/<company>. Write a dash rather than guessing one.

Rules:
- Only companies that exist and are actively hiring engineers. Skip staffing agencies, recruiters, and job boards themselves.
- The domain must be the company's own site, not a directory listing or an ATS URL.
- Prefer companies whose openings match the request; breadth matters more than fame.
- No duplicates, and skip any company on the "already tracked" list.
- If you can't find enough, return fewer. Never invent a company or a domain.`;

const EXTRACT_SYSTEM = `You turn a list of companies into JSON. Copy names, domains, reasons and URLs exactly as written. Drop any line that has no domain.`;

const CandidatesSchema = z.object({
  companies: z.array(
    z.object({
      name: z.string(),
      domain: z.string().describe("Bare hostname, e.g. 'ramp.com'"),
      why: z.string().nullable(),
      sourceUrl: z.string().nullable(),
      boardUrl: z.string().nullable().describe("The job board URL if one was given, else null"),
    }),
  ),
});

/** Turns a saved search into the plain-English brief the search step works from. */
export function briefFor(filter: SearchFilter, rawQuery: string): string {
  const where = filter.remoteOnly
    ? "hiring fully remote roles in the US"
    : filter.locations.length
      ? `with engineering roles in ${filter.locations.map((l) => l.label).join(" or ")}${filter.includeRemoteUS ? " (or remote in the US)" : ""}`
      : "hiring engineers";
  const roles = [...filter.levelKeywords, ...filter.roleKeywords].slice(0, 4).join(", ");
  return `Technology companies ${where}${roles ? `, for roles like: ${roles}` : ""}. Original search: "${rawQuery}".`;
}

function trackedCompanies(limit = 400): string[] {
  return getDb()
    .select({ name: company.name, domain: company.domain })
    .from(company)
    .limit(limit)
    .all()
    .map((c) => c.name);
}

async function proposeCompanies(
  brief: string,
  wanted: number,
  opts: { background: boolean },
): Promise<z.infer<typeof CandidatesSchema>["companies"]> {
  const { models } = getSettings("ai");
  const { maxWebSearches } = getSettings("research");
  const tracked = trackedCompanies();
  assertNativeSearch(models.research);
  const research = forModel(models.research);

  const response = await research.client.messages
    .stream({
      model: research.model,
      max_tokens: 4000,
      system: SEARCH_SYSTEM,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxWebSearches }],
      cache_control: { type: "ephemeral" },
      messages: [
        {
          role: "user",
          content: `Find up to ${wanted} companies.\n\nLooking for: ${brief}\nToday: ${new Date().toISOString().slice(0, 10)}\n\nAlready tracked (skip these):\n${tracked.join(", ")}`,
        },
      ],
    })
    .finalMessage();
  recordMessageUsage("discover_companies", models.research, response);
  assertUsableStop(response, "find companies");

  const listing = textOf(response).trim();
  if (!listing) throw new NonRetryableError("The search came back empty.");
  assertBudget(opts);

  const extraction = forModel(models.extraction);
  const extracted = await extraction.client.messages.create({
    model: extraction.model,
    max_tokens: 4000,
    system: EXTRACT_SYSTEM,
    messages: [{ role: "user", content: listing }],
    output_config: { format: zodOutputFormat(CandidatesSchema) },
  });
  recordMessageUsage("discover_extract", models.extraction, extracted);
  assertUsableStop(extracted, "read the list of companies");
  return parseStructured(extracted, CandidatesSchema, "list of companies").companies;
}

const cleanDomain = (d: string) =>
  d
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

/**
 * Looks up one candidate's job board and adds it. Everything here is code, not model output:
 * the ATS is found by reading the company's own careers page and confirmed by listing real jobs.
 */
export async function resolveCandidate(c: DiscoveryCandidate): Promise<DiscoveryCandidate> {
  const domain = c.domain ? cleanDomain(c.domain) : null;
  if (!domain) return { ...c, status: "no_board", note: "No website given" };

  const db = getDb();
  const existingByDomain = db.select().from(company).where(eq(company.domain, domain)).get();
  if (existingByDomain) {
    return { ...c, domain, status: "exists", companyId: existingByDomain.id, atsType: existingByDomain.atsType, atsSlug: existingByDomain.atsSlug };
  }

  // The company's own careers page is the authority; a board URL from the model is only a
  // fallback, and it still has to list real jobs before anything is stored.
  let hit: Awaited<ReturnType<typeof findAtsForSite>>;
  try {
    hit = (await findAtsForSite(domain)) ?? (c.boardUrl ? await findAtsForSite(c.boardUrl) : null);
  } catch (err) {
    return { ...c, domain, status: "error", note: err instanceof Error ? err.message : String(err) };
  }
  if (!hit) return { ...c, domain, status: "no_board", note: "No Greenhouse, Lever, Ashby, Workday or SmartRecruiters board found" };

  const already = db
    .select()
    .from(company)
    .where(and(eq(company.atsType, hit.atsType), eq(company.atsSlug, hit.atsSlug)))
    .get();
  if (already) {
    return { ...c, domain, status: "exists", companyId: already.id, atsType: hit.atsType, atsSlug: hit.atsSlug, openJobs: hit.openJobs };
  }

  const row = db
    .insert(company)
    .values({
      name: c.name.trim() || hit.companyName || boardName(hit.atsType, hit.atsSlug),
      domain,
      atsType: hit.atsType,
      atsSlug: hit.atsSlug,
      source: "discovered",
    })
    .returning()
    .get();

  // Store the board's postings now so the company isn't empty until the next crawl.
  const { maxJobsPerBoard } = getSettings("sources");
  try {
    const { jobs } = await adapters[hit.atsType].listJobs(hit.atsSlug, { maxJobs: maxJobsPerBoard });
    storeCompanyJobs(row.id, hit.atsType, jobs);
    return { ...c, domain, status: "added", companyId: row.id, atsType: hit.atsType, atsSlug: hit.atsSlug, openJobs: jobs.length };
  } catch {
    // The board answered during detection, so leave the company in place for the next crawl.
    return { ...c, domain, status: "added", companyId: row.id, atsType: hit.atsType, atsSlug: hit.atsSlug, openJobs: hit.openJobs };
  }
}

export function startDiscoveryRun(prompt: string, trigger: "manual" | "schedule", searchId: number | null, startedBy: number | null = null): DiscoveryRunRow {
  return getDb()
    .insert(discoveryRun)
    .values({ prompt, trigger, searchId, startedBy, status: "running", candidates: [] })
    .returning()
    .get();
}

/** True when "look for new companies" is on and none has started in the last day. */
export function discoveryDue(now = new Date()): boolean {
  if (!getSettings("sources").autoGrowCompanies) return false;
  const last = getDb().select().from(discoveryRun).orderBy(desc(discoveryRun.id)).limit(1).get();
  return !last || now.getTime() - last.createdAt.getTime() > 86_400_000;
}

export function latestDiscoveryRuns(limit = 10): DiscoveryRunRow[] {
  return getDb().select().from(discoveryRun).orderBy(desc(discoveryRun.id)).limit(limit).all();
}

/**
 * Asks Claude for companies matching a brief, then checks each one against the real web:
 * find the careers page, find the ATS board, confirm it lists jobs, add it.
 */
export async function discoverCompanies(runId: number, opts: { background: boolean }): Promise<DiscoveryRunRow> {
  const db = getDb();
  const run = db.select().from(discoveryRun).where(eq(discoveryRun.id, runId)).get();
  if (!run) throw new NonRetryableError(`Discovery run ${runId} not found`);
  assertBudget(opts);

  const { maxCompaniesPerDiscovery } = getSettings("sources");
  const save = (patch: Partial<DiscoveryRunRow>) =>
    db.update(discoveryRun).set(patch).where(eq(discoveryRun.id, runId)).run();

  try {
    const proposed = await proposeCompanies(run.prompt, maxCompaniesPerDiscovery, opts);
    let candidates: DiscoveryCandidate[] = proposed.slice(0, maxCompaniesPerDiscovery).map((p) => ({
      name: p.name.trim(),
      domain: p.domain?.trim() || null,
      why: p.why,
      sourceUrl: p.sourceUrl,
      boardUrl: p.boardUrl?.trim() || null,
      status: "pending",
      atsType: null,
      atsSlug: null,
      openJobs: null,
      companyId: null,
      note: null,
    }));
    save({ candidates });

    // Sequential: each candidate fetches a handful of pages, and a run is a dozen candidates.
    for (let i = 0; i < candidates.length; i++) {
      candidates[i] = await resolveCandidate(candidates[i]!);
      candidates = [...candidates];
      save({ candidates, added: candidates.filter((c) => c.status === "added").length });
    }

    save({ status: "done", finishedAt: new Date() });
  } catch (err) {
    save({ status: "failed", error: err instanceof Error ? err.message : String(err), finishedAt: new Date() });
    throw err;
  }
  return db.select().from(discoveryRun).where(eq(discoveryRun.id, runId)).get()!;
}
