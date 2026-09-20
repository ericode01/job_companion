import type { LocationTarget, LocationType } from "@jd/core";

const US_TOKENS = ["united states", "usa", "u.s.", "us", "america", "north america", "anywhere in the us"];
const NON_US_REGION = /\b(canada|emea|europe|uk|united kingdom|apac|latam|india|germany|france|ireland|australia|brazil|mexico|japan|singapore|spain|poland|netherlands|israel)\b/;

export function inferLocationType(texts: string[]): LocationType {
  const s = texts.join(" | ").toLowerCase();
  if (/\bremote\b/.test(s)) return "remote";
  if (/\bhybrid\b/.test(s)) return "hybrid";
  return texts.length ? "onsite" : "unknown";
}

/** "Remote (US)", "Remote - United States", "US Remote", "Remote" (no country) → true. */
export function isRemoteUSString(loc: string): boolean {
  const s = loc.toLowerCase();
  if (!/\bremote\b|\banywhere\b/.test(s)) return false;
  if (US_TOKENS.some((t) => new RegExp(`(^|[^a-z])${t.replace(/\./g, "\\.")}([^a-z]|$)`).test(s))) return true;
  if (NON_US_REGION.test(s)) return false;
  // Bare "Remote" with no region: treat as US-eligible for a US-based search.
  return /^\s*(fully\s+)?remote\s*$/.test(s) || /^\s*anywhere\s*$/.test(s);
}

export interface LocationMatchInput {
  locations: string[];
  locationType: LocationType;
  remoteCountries: string[];
}

export type LocationMatch = { match: true; reason: "location" | "remote_us"; matched: string } | { match: false };

export function matchLocation(
  job: LocationMatchInput,
  targets: LocationTarget[],
  includeRemoteUS: boolean,
  opts: { remoteOnly?: boolean } = {},
): LocationMatch {
  if (targets.length === 0 && !opts.remoteOnly) return { match: true, reason: "location", matched: "anywhere" };
  for (const loc of job.locations) {
    const s = loc.toLowerCase();
    for (const t of targets) {
      const hit = t.aliases.find((a) => new RegExp(`(^|[^a-z])${escapeRe(a.toLowerCase())}([^a-z]|$)`).test(s));
      if (hit) return { match: true, reason: "location", matched: t.label };
    }
  }
  if (includeRemoteUS) {
    const remoteLoc = job.locations.find(isRemoteUSString);
    if (remoteLoc) return { match: true, reason: "remote_us", matched: remoteLoc };
    if (job.remoteCountries.some((c) => US_TOKENS.includes(c.toLowerCase()))) {
      return { match: true, reason: "remote_us", matched: "Remote (US)" };
    }
  }
  return { match: false };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
