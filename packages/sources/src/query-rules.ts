import type { LocationTarget, SearchFilter } from "@jd/core";

/** Known places. Aliases are lowercase substrings matched with word boundaries. */
export const PLACES: Record<string, LocationTarget> = {
  nyc: { label: "New York City", aliases: ["new york", "nyc", "manhattan", "brooklyn", "ny, ny", "new york city"] },
  sf: { label: "San Francisco Bay Area", aliases: ["san francisco", "sf", "bay area", "oakland", "palo alto", "mountain view", "menlo park", "san mateo", "sunnyvale", "san jose"] },
  seattle: { label: "Seattle", aliases: ["seattle", "bellevue", "redmond", "kirkland"] },
  boston: { label: "Boston", aliases: ["boston", "cambridge, ma", "somerville"] },
  austin: { label: "Austin", aliases: ["austin"] },
  la: { label: "Los Angeles", aliases: ["los angeles", "santa monica", "culver city", "venice, ca"] },
  chicago: { label: "Chicago", aliases: ["chicago"] },
  denver: { label: "Denver / Boulder", aliases: ["denver", "boulder"] },
  dc: { label: "Washington, DC", aliases: ["washington, dc", "washington dc", "arlington, va"] },
  london: { label: "London", aliases: ["london"] },
};

const PLACE_KEYS: [RegExp, string][] = [
  [/\b(nyc|new york( city)?|manhattan|brooklyn)\b/, "nyc"],
  [/\b(sf|san francisco|bay area|silicon valley)\b/, "sf"],
  [/\bseattle\b/, "seattle"],
  [/\bboston\b/, "boston"],
  [/\baustin\b/, "austin"],
  [/\b(la|los angeles)\b/, "la"],
  [/\bchicago\b/, "chicago"],
  [/\b(denver|boulder)\b/, "denver"],
  [/\b(dc|washington)\b/, "dc"],
  [/\blondon\b/, "london"],
];

const LEVELS: [RegExp, string[]][] = [
  [/\bsenior staff\b/, ["senior staff"]],
  [/\bstaff\b/, ["staff"]],
  [/\bprincipal\b/, ["principal"]],
  [/\bdistinguished\b/, ["distinguished"]],
  [/\b(senior|sr\.?)\b/, ["senior", "sr"]],
  [/\blead\b/, ["lead"]],
  [/\b(junior|jr\.?|entry[- ]level)\b/, ["junior", "jr", "entry level", "new grad"]],
  [/\bintern(ship)?\b/, ["intern", "internship"]],
];

const ENGINEER_EXCLUDES = [
  "manager", "sales engineer", "solutions engineer", "support engineer", "customer engineer", "field engineer",
  "hardware", "mechanical", "electrical", "recruiter", "director", "intern",
];

const ROLES: [RegExp, { keywords: string[]; exclude: string[] }][] = [
  [/\b(software engineer|software developer|swe|engineer|developer)\b/, { keywords: ["software engineer", "software developer", "engineer", "developer"], exclude: ENGINEER_EXCLUDES }],
  [/\b(ml|machine learning|ai) engineer\b/, { keywords: ["machine learning engineer", "ml engineer", "ai engineer", "applied ai", "research engineer"], exclude: ["manager", "director", "intern"] }],
  [/\bdata scientist\b/, { keywords: ["data scientist"], exclude: ["manager", "director", "intern"] }],
  [/\bdata engineer\b/, { keywords: ["data engineer"], exclude: ["manager", "director", "intern"] }],
  [/\b(engineering manager|em)\b/, { keywords: ["engineering manager", "manager, engineering", "manager engineering"], exclude: ["product manager", "intern"] }],
  [/\bproduct manager\b/, { keywords: ["product manager"], exclude: ["intern"] }],
  [/\bdesigner\b/, { keywords: ["designer"], exclude: ["intern"] }],
];

/**
 * Offline query parser: used when no API key is configured or the LLM call fails.
 * Handles the common "<level> <role> in <place>" shape.
 */
export function parseQueryWithRules(query: string, defaults: { includeRemoteUS: boolean; postedWithinDays: number | null }): SearchFilter {
  const q = query.toLowerCase().trim();
  const [rolePart = q, placePart = ""] = q.split(/\s+(?:in|near|around|@|at)\s+/, 2);

  const locations: LocationTarget[] = [];
  const placeText = placePart || q;
  for (const [re, key] of PLACE_KEYS) {
    if (re.test(placeText) && PLACES[key]) locations.push(PLACES[key]);
  }
  if (locations.length === 0 && placePart && !/\bremote\b/.test(placePart)) {
    const city = placePart.replace(/[^a-z ,.-]/g, "").trim();
    if (city) locations.push({ label: city.replace(/\b\w/g, (c) => c.toUpperCase()), aliases: [city.split(",")[0]!.trim()] });
  }

  let levelKeywords: string[] = [];
  for (const [re, kws] of LEVELS) {
    if (re.test(rolePart)) {
      levelKeywords = kws;
      break;
    }
  }

  const specific = ROLES.slice(1).find(([re]) => re.test(rolePart));
  const role = specific ?? ROLES.find(([re]) => re.test(rolePart));
  let roleKeywords: string[];
  let excludeKeywords: string[];
  if (role) {
    roleKeywords = role[1].keywords;
    excludeKeywords = role[1].exclude.filter((e) => !levelKeywords.includes(e));
  } else {
    const levelWords = new RegExp(`\\b(${levelKeywords.join("|") || "$^"})\\b`, "g");
    roleKeywords = [rolePart.replace(levelWords, "").replace(/\s+/g, " ").trim()].filter(Boolean);
    excludeKeywords = [];
  }

  return {
    roleKeywords,
    levelKeywords,
    excludeKeywords,
    locations,
    includeRemoteUS: /\bremote\b/.test(q) ? true : defaults.includeRemoteUS,
    remoteOnly: /\bremote\b/.test(q) && locations.length === 0,
    postedWithinDays: defaults.postedWithinDays,
  };
}
