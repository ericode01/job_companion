import type { LocationType, SearchFilter } from "@jd/core";
import { matchLocation, type LocationMatch } from "./location";
import { normalizeTitle } from "./text";

function containsPhrase(haystack: string, phrase: string): boolean {
  const p = normalizeTitle(phrase);
  if (!p) return false;
  return ` ${haystack} `.includes(` ${p} `);
}

export interface MatchableJob {
  title: string;
  locations: string[];
  locationType: LocationType;
  remoteCountries: string[];
  postedAt: Date | null;
  companyName: string;
}

export interface RuleResult {
  pass: boolean;
  failed?: "title" | "level" | "excluded" | "location" | "age" | "company";
  location?: LocationMatch;
}

export interface MatchOptions {
  excludedCompanies?: string[];
  excludedTitleKeywords?: string[];
  now?: Date;
}

/** The title rules alone: role, level and excluded words. Used where location isn't known. */
export function matchTitle(rawTitle: string, filter: SearchFilter, excludedTitleKeywords: string[] = []): RuleResult["failed"] | null {
  const title = normalizeTitle(rawTitle);
  if (filter.roleKeywords.length && !filter.roleKeywords.some((k) => containsPhrase(title, k))) return "title";
  if (filter.levelKeywords.length && !filter.levelKeywords.some((k) => containsPhrase(title, k))) return "level";
  if ([...filter.excludeKeywords, ...excludedTitleKeywords].some((k) => containsPhrase(title, k))) return "excluded";
  return null;
}

/** Cheap, deterministic prefilter. Runs over every open job before any LLM work. */
export function matchJob(job: MatchableJob, filter: SearchFilter, opts: MatchOptions = {}): RuleResult {
  const excludedCompanies = (opts.excludedCompanies ?? []).map((c) => c.toLowerCase().trim());
  if (excludedCompanies.includes(job.companyName.toLowerCase().trim())) return { pass: false, failed: "company" };
  const titleFailed = matchTitle(job.title, filter, opts.excludedTitleKeywords);
  if (titleFailed) return { pass: false, failed: titleFailed };
  if (filter.postedWithinDays !== null && job.postedAt) {
    const ageMs = (opts.now ?? new Date()).getTime() - job.postedAt.getTime();
    if (ageMs > filter.postedWithinDays * 86_400_000) return { pass: false, failed: "age" };
  }
  if (filter.remoteOnly) {
    const remote = matchLocation(job, [], true, { remoteOnly: true });
    return remote.match ? { pass: true, location: remote } : { pass: false, failed: "location", location: remote };
  }
  const location = matchLocation(job, filter.locations, filter.includeRemoteUS);
  if (!location.match) return { pass: false, failed: "location", location };
  return { pass: true, location };
}
