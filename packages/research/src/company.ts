import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { dataDir, getSettings, type CompanyProfile } from "@jd/core";
import { z } from "zod";
import { getDb, schema } from "@jd/core/db";
import { assertBudget, forModel, parseModel, parseStructured, recordMessageUsage } from "@jd/llm";
import { boardUrl } from "@jd/sources";
import { eq } from "drizzle-orm";
import { assertUsableStop, NonRetryableError, textOf } from "./util";

const { company, companyProfile } = schema;
export type CompanyProfileRow = typeof companyProfile.$inferSelect;

const RESEARCH_SYSTEM = `You research a technology company for a job seeker deciding whether to apply.

Use web search (and web fetch, if available). Start with the company's own website (home, about, product, customers, pricing), then its newsroom or press releases, then reputable coverage of funding and headcount (company announcements, major business press, SEC filings for public companies, Wikipedia).

Write research notes in Markdown covering:
1. Overview: what the company does and for whom
2. Products: each main product with a one-line description
3. Customers and business model
4. Competitors
5. Founded, headquarters, approximate headcount (with an as-of date)
6. Stage and funding: total raised, most recent round (type, amount, date), notable investors; or ticker if public; or acquirer if acquired
7. Recent news from the last 12 months (layoffs, launches, acquisitions, leadership changes)

Rules:
- End every factual sentence with the URL it came from in square brackets, e.g. "Raised a $300M Series D in June 2025 [https://…]".
- If sources conflict, give both figures with their sources and dates.
- If you can't verify something, say "not found". Never estimate funding or headcount.
- Watch for other organizations with the same name; stick to the one whose careers site is given.`;

const STRUCTURE_SYSTEM = `You convert company research notes into JSON.

Rules:
- Use only facts stated in the notes. Use null (or an empty list) for anything the notes don't state or mark "not found".
- sourceUrl must be a URL that appears in the notes next to that fact. Never invent or modify URLs.
- stage: pick the closest option; "unknown" if the notes don't say.
- confidence: "high" if funding and headcount come from the company or primary filings, "medium" for press coverage, "low" if missing or conflicting.`;

/**
 * Flat schema for the structuring step. The nested CompanyProfile shape (many nullable
 * sourced objects) compiles to a grammar that is too large for structured outputs.
 */
const FACT_KEYS = ["customers", "businessModel", "founded", "headquarters", "headcount", "stage", "totalFunding", "lastRound", "publicTicker"] as const;
const STAGES = ["pre-seed", "seed", "series-a", "series-b", "series-c", "series-d-plus", "growth", "public", "acquired", "bootstrapped", "unknown"] as const;

export const StructuredNotesSchema = z.object({
  overview: z.string().nullable(),
  products: z.array(z.object({ name: z.string(), description: z.string(), sourceUrl: z.string().nullable() })),
  facts: z
    .array(z.object({ key: z.enum(FACT_KEYS), value: z.string(), sourceUrl: z.string().nullable() }))
    .describe(`At most one per key. stage value must be one of: ${STAGES.join(", ")}. founded is a year.`),
  competitors: z.array(z.string()),
  investors: z.array(z.string()),
  recentNews: z.array(z.object({ headline: z.string(), date: z.string().nullable(), sourceUrl: z.string() })),
  confidence: z.enum(["high", "medium", "low"]),
  notes: z.string().nullable(),
});
export type StructuredNotes = z.infer<typeof StructuredNotesSchema>;

export function toCompanyProfile(s: StructuredNotes): CompanyProfile {
  const fact = (key: (typeof FACT_KEYS)[number]) => {
    const f = s.facts.find((x) => x.key === key && x.value.trim());
    return { value: f?.value.trim() ?? null, sourceUrl: f?.sourceUrl ?? null };
  };
  const stage = fact("stage");
  const stageValue = STAGES.find((st) => st === stage.value?.toLowerCase().replace(/\s+/g, "-")) ?? (stage.value ? "unknown" : null);
  return {
    overview: s.overview,
    products: s.products,
    customers: fact("customers"),
    businessModel: fact("businessModel"),
    competitors: s.competitors,
    founded: fact("founded"),
    headquarters: fact("headquarters"),
    headcount: fact("headcount"),
    stage: { value: stageValue, sourceUrl: stage.sourceUrl },
    totalFunding: fact("totalFunding"),
    lastRound: fact("lastRound"),
    investors: s.investors,
    publicTicker: fact("publicTicker").value,
    recentNews: s.recentNews,
    confidence: s.confidence,
    notes: s.notes,
  };
}

/* Phase-1 notes are cached on disk for a day so a failed structuring step doesn't pay for research twice. */
interface NotesCache {
  notes: string;
  consulted: string[];
  model: string;
  savedAt: number;
}
const NOTES_TTL_MS = 86_400_000;
const notesPath = (companyId: number) => path.join(dataDir(), "files", "research", `company-${companyId}.json`);

function readNotesCache(companyId: number): NotesCache | null {
  try {
    const c = JSON.parse(fs.readFileSync(notesPath(companyId), "utf8")) as NotesCache;
    return Date.now() - c.savedAt < NOTES_TTL_MS ? c : null;
  } catch {
    return null;
  }
}

function writeNotesCache(companyId: number, c: NotesCache): void {
  fs.mkdirSync(path.dirname(notesPath(companyId)), { recursive: true });
  fs.writeFileSync(notesPath(companyId), JSON.stringify(c));
}

/** URLs Claude actually retrieved or cited, collected from server tool results and citations. */
export function collectConsultedUrls(messages: Anthropic.Message[]): string[] {
  const urls = new Set<string>();
  for (const m of messages) {
    for (const block of m.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) urls.add(r.url);
      } else if (block.type === "web_fetch_tool_result" && block.content.type === "web_fetch_result") {
        urls.add(block.content.url);
      } else if (block.type === "text") {
        for (const c of block.citations ?? []) if ("url" in c && typeof c.url === "string") urls.add(c.url);
      }
    }
  }
  return [...urls];
}

const normalizeUrl = (u: string) => u.trim().replace(/[#?].*$/, "").replace(/\/+$/, "").toLowerCase();

/**
 * Removes any source URL that wasn't retrieved during research (the structuring step must not invent sources).
 * A value whose source was dropped is kept but marked unsourced.
 */
export function restrictSources(profile: CompanyProfile, consulted: string[], notes: string): CompanyProfile {
  const allowed = new Set([...consulted, ...(notes.match(/https?:\/\/[^\s\])>"']+/g) ?? [])].map(normalizeUrl));
  const ok = (u: string | null) => (u && allowed.has(normalizeUrl(u)) ? u : null);
  const fix = <T>(f: { value: T | null; sourceUrl: string | null }) => ({ value: f.value, sourceUrl: ok(f.sourceUrl) });
  return {
    ...profile,
    products: profile.products.map((p) => ({ ...p, sourceUrl: ok(p.sourceUrl) })),
    customers: fix(profile.customers),
    businessModel: fix(profile.businessModel),
    founded: fix(profile.founded),
    headquarters: fix(profile.headquarters),
    headcount: fix(profile.headcount),
    stage: fix(profile.stage),
    totalFunding: fix(profile.totalFunding),
    lastRound: fix(profile.lastRound),
    recentNews: profile.recentNews.filter((n) => ok(n.sourceUrl)),
  };
}

const MAX_CONTINUATIONS = 4;

/**
 * A middling thinking budget for the research loop — but only where it is accepted. Haiku 4.5
 * rejects `effort` with a 400, so asking for it there doesn't degrade the research, it stops it.
 */
function effortFor(model: string): { output_config?: { effort: "medium" } } {
  return /haiku/i.test(model) ? {} : { output_config: { effort: "medium" } };
}

/**
 * Research has to run somewhere whose search results this code can verify. `collectConsultedUrls`
 * learns which URLs the model actually retrieved from Anthropic's `web_search_tool_result` blocks
 * and citations, and `restrictSources` drops every source outside that set — so a provider that
 * reports its searches differently wouldn't fail, it would quietly produce a profile where an
 * invented URL is indistinguishable from a retrieved one. Until the OpenRouter search tool is
 * wired up and measured, research stays on Anthropic.
 */
export function assertNativeSearch(setting: string): void {
  const { route } = parseModel(setting);
  if (route !== "anthropic") {
    throw new NonRetryableError(
      `Company research needs an anthropic: model — "${setting}" can't be checked for invented sources. Set Admin → Models → Company research back to an Anthropic model.`,
    );
  }
}

export async function researchCompany(
  companyId: number,
  opts: { background: boolean; reuseNotes?: boolean },
): Promise<CompanyProfileRow> {
  const db = getDb();
  const c = db.select().from(company).where(eq(company.id, companyId)).get();
  if (!c) throw new NonRetryableError(`Company ${companyId} not found`);
  assertBudget(opts);

  const { models } = getSettings("ai");
  const { maxWebSearches, maxWebFetches } = getSettings("research");
  assertNativeSearch(models.research);
  const careersUrl = boardUrl(c.atsType, c.atsSlug);

  let cached = opts.reuseNotes === false ? null : readNotesCache(companyId);
  if (!cached) {
    const research = forModel(models.research);
    cached = await gatherNotes(research.client, research.model, maxWebSearches, maxWebFetches, c, careersUrl, opts);
    writeNotesCache(companyId, cached);
  }
  const { notes, consulted } = cached;

  // Phase 2: structure the notes. No tools, so this one can run anywhere — and usually should,
  // since it is plain extraction.
  const extraction = forModel(models.extraction);
  const structured = await extraction.client.messages.create({
    model: extraction.model,
    max_tokens: 8000,
    system: STRUCTURE_SYSTEM,
    messages: [{ role: "user", content: `Company: ${c.name}\n\n<notes>\n${notes}\n</notes>` }],
    output_config: { format: zodOutputFormat(StructuredNotesSchema) },
  });
  recordMessageUsage("company_structure", models.extraction, structured);
  assertUsableStop(structured, "structure the research notes");
  const notesJson = parseStructured(structured, StructuredNotesSchema, "structured version of the research notes");

  const data = restrictSources(toCompanyProfile(notesJson), consulted, notes);
  const values = { companyId, data, consultedUrls: consulted, model: cached.model, enrichedAt: new Date() };
  return db
    .insert(companyProfile)
    .values(values)
    .onConflictDoUpdate({ target: companyProfile.companyId, set: values })
    .returning()
    .get();
}

export function getCompanyProfile(companyId: number): CompanyProfileRow | null {
  return getDb().select().from(companyProfile).where(eq(companyProfile.companyId, companyId)).get() ?? null;
}

export function isProfileStale(row: CompanyProfileRow | null): boolean {
  if (!row) return true;
  const { refreshAfterDays } = getSettings("research");
  return Date.now() - row.enrichedAt.getTime() > refreshAfterDays * 86_400_000;
}

/** Phase 1: research with server-side web tools, resuming paused turns. */
async function gatherNotes(
  client: Anthropic,
  model: string,
  maxWebSearches: number,
  maxWebFetches: number,
  c: { name: string; domain: string | null },
  careersUrl: string,
  opts: { background: boolean },
): Promise<NotesCache> {
  const tools: Anthropic.ToolUnion[] = [
    // Basic (non-filtering) tool variants on purpose. Measured on Ramp: the dynamic-filtering
    // web_search_20260209 re-read the growing context on every internal code-execution round
    // (510k input tokens, ~$1.16) vs ~58k tokens (~$0.19) with the basic tool plus caching.
    { type: "web_search_20250305", name: "web_search", max_uses: maxWebSearches },
    ...(maxWebFetches > 0
      ? [{ type: "web_fetch_20250910" as const, name: "web_fetch" as const, max_uses: maxWebFetches, max_content_tokens: 6000 }]
      : []),
  ];
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Company: ${c.name}\nWebsite: ${c.domain ? `https://${c.domain}` : "unknown"}\nCareers site: ${careersUrl}\nToday: ${new Date().toISOString().slice(0, 10)}`,
    },
  ];
  const responses: Anthropic.Message[] = [];
  let final: Anthropic.Message | null = null;
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const response = await client.messages
      // Auto-caching lets each server-side search round (and paused-turn continuations) read the prior context from cache.
      .stream({ model, max_tokens: 16000, system: RESEARCH_SYSTEM, tools, messages, cache_control: { type: "ephemeral" }, ...effortFor(model) })
      .finalMessage();
    recordMessageUsage("company_research", model, response);
    responses.push(response);
    if (response.stop_reason !== "pause_turn") {
      final = response;
      break;
    }
    messages.push({ role: "assistant", content: response.content });
    if (i < MAX_CONTINUATIONS) assertBudget(opts);
  }
  if (!final) throw new NonRetryableError("Research did not finish within the allowed continuations.");
  assertUsableStop(final, "research this company");
  const notes = responses.map(textOf).join("\n").trim();
  if (!notes) throw new NonRetryableError("Research produced no notes.");
  return { notes, consulted: collectConsultedUrls(responses), model, savedAt: Date.now() };
}
