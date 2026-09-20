import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getSettings, SearchFilterSchema, type SearchFilter } from "@jd/core";
import { parseQueryWithRules } from "@jd/sources";
import { assertBudget, forModel, hasKeyFor, parseStructured, recordMessageUsage } from "./client";

const SYSTEM = `You turn a job-search query into a structured title/location filter for matching job postings from company job boards (Greenhouse, Lever, Ashby).

Matching rules the filter is used with:
- Titles are lowercased with punctuation removed. A title must contain at least one roleKeywords phrase, at least one levelKeywords phrase (if any are given), and none of the excludeKeywords phrases. Phrases match on whole words.
- Location strings look like "New York, NY", "NYC", "Remote (US)", "San Francisco, CA; New York, NY". A job matches a location target if any alias appears in any of its location strings.

Guidance:
- roleKeywords: include common title variants for the role (e.g. software engineer → "software engineer", "software developer", "engineer", "developer"). Keep them lowercase.
- levelKeywords: only the exact seniority the user asked for, plus abbreviations of that same level (senior → "senior", "sr"; staff → "staff"; principal → "principal"). Never add a different level: staff does not include senior. Empty if no level was given.
- excludeKeywords: titles that contain the role words but are a different job (for engineers: "manager", "sales engineer", "solutions engineer", "support engineer", "hardware", "director"). Never exclude the requested level.
- locations: one target per place, with aliases covering the city, common abbreviations, and boroughs or neighboring cities people list on job posts. Empty if no place was given.
- remoteOnly: true only if the user asks for remote roles without naming a place ("remote", "fully remote"). A place plus remote ("NYC or remote") means locations + includeRemoteUS true, remoteOnly false.
- includeRemoteUS and postedWithinDays: use the defaults provided unless the query says otherwise (e.g. "onsite only" → includeRemoteUS false, "posted this week" → 7).`;

const LEVEL_FAMILIES: string[][] = [
  ["senior", "sr"],
  ["staff"],
  ["principal"],
  ["distinguished"],
  ["lead"],
  ["junior", "jr", "entry level", "new grad"],
  ["intern", "internship"],
];

/** Drops level keywords from a level family the query never mentioned (models tend to add "sr" to "staff"). */
export function keepRequestedLevels(query: string, levels: string[]): string[] {
  const q = ` ${query.toLowerCase().replace(/[^a-z ]+/g, " ")} `;
  return levels.filter((level) => {
    const family = LEVEL_FAMILIES.find((f) => f.includes(level));
    if (!family) return true;
    return family.some((alias) => q.includes(` ${alias} `)) || (family[0] === "senior" && /\bsenior staff\b/.test(q));
  });
}

export interface ParsedQuery {
  filter: SearchFilter;
  parsedBy: "llm" | "rules";
  warning?: string;
}

export interface QueryDefaults {
  includeRemoteUS: boolean;
  postedWithinDays: number | null;
}

/** Defaults come from the person's search settings (or onboarding's remote question). */
export async function parseSearchQuery(
  query: string,
  defaults: QueryDefaults = { includeRemoteUS: true, postedWithinDays: 30 },
): Promise<ParsedQuery> {
  const { includeRemoteUS, postedWithinDays } = defaults;
  const fallback = (warning?: string): ParsedQuery => ({
    filter: parseQueryWithRules(query, defaults),
    parsedBy: "rules",
    warning,
  });

  const setting = getSettings("ai").models.queryParse;
  if (!hasKeyFor(setting)) return fallback("No API key set, so the query was parsed with built-in rules.");

  try {
    assertBudget({ background: false });
    const { client, model } = forModel(setting);
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Defaults: includeRemoteUS=${includeRemoteUS}, postedWithinDays=${postedWithinDays}\n\nQuery: ${query}`,
        },
      ],
      output_config: { format: zodOutputFormat(SearchFilterSchema) },
    });
    recordMessageUsage("query_parse", setting, response);
    if (response.stop_reason === "refusal") return fallback("The AI parser declined, so built-in rules were used.");
    let f: SearchFilter;
    try {
      f = parseStructured(response, SearchFilterSchema, "search filter");
    } catch {
      return fallback("The AI parser returned no usable filter, so built-in rules were used.");
    }
    const lower = (xs: string[]) => [...new Set(xs.map((x) => x.toLowerCase().trim()).filter(Boolean))];
    return {
      filter: {
        ...f,
        roleKeywords: lower(f.roleKeywords),
        levelKeywords: keepRequestedLevels(query, lower(f.levelKeywords)),
        excludeKeywords: lower(f.excludeKeywords),
        locations: f.locations.map((l) => ({ label: l.label, aliases: lower(l.aliases) })),
      },
      parsedBy: "llm",
    };
  } catch (err) {
    const msg =
      err instanceof Anthropic.AuthenticationError
        ? "The API key was rejected"
        : err instanceof Anthropic.RateLimitError
          ? "Rate limited by the AI provider"
          : err instanceof Anthropic.APIError
            ? `AI provider error ${err.status}`
            : err instanceof Error
              ? err.message
              : String(err);
    return fallback(`${msg}. The query was parsed with built-in rules instead.`);
  }
}
