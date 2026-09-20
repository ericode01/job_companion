import { z } from "zod";

export const ATS_TYPES = ["greenhouse", "lever", "ashby", "workday", "smartrecruiters"] as const;
export type AtsType = (typeof ATS_TYPES)[number];

export const LocationTargetSchema = z.object({
  label: z.string().describe("Human label, e.g. 'New York City'"),
  aliases: z
    .array(z.string())
    .describe("Lowercase substrings that identify this place in a job location string, e.g. ['new york', 'nyc', 'brooklyn']"),
});
export type LocationTarget = z.infer<typeof LocationTargetSchema>;

/** Structured search filter. Produced by the query parser, editable in the UI. */
export const SearchFilterSchema = z.object({
  roleKeywords: z
    .array(z.string())
    .describe("Lowercase phrases; a title must contain at least one, e.g. ['software engineer', 'engineer', 'developer']"),
  levelKeywords: z
    .array(z.string())
    .describe("Lowercase seniority words; a title must contain at least one if non-empty, e.g. ['staff']"),
  excludeKeywords: z
    .array(z.string())
    .describe("Lowercase words/phrases that disqualify a title, e.g. ['manager', 'sales engineer']"),
  locations: z.array(LocationTargetSchema).describe("Empty means anywhere"),
  includeRemoteUS: z.boolean(),
  remoteOnly: z.boolean().describe("true when the user wants only remote roles (e.g. 'remote', 'fully remote')"),
  postedWithinDays: z.number().int().nullable(),
});
export type SearchFilter = z.infer<typeof SearchFilterSchema>;

export type LocationType = "onsite" | "hybrid" | "remote" | "unknown";

export interface Comp {
  min: number | null;
  max: number | null;
  currency: string | null;
  interval: "year" | "hour" | null;
}

/** ATS-agnostic job, as produced by adapters before it hits the DB. */
export interface NormalizedJob {
  externalId: string;
  title: string;
  url: string;
  applyUrl: string;
  locations: string[];
  locationType: LocationType;
  remoteCountries: string[];
  department: string | null;
  comp: Comp | null;
  descriptionHtml: string;
  descriptionText: string;
  postedAt: Date | null;
  /**
   * True when the board's list endpoint doesn't carry the description (and often the real
   * locations). Such jobs are stored as-is and filled in later by hydrateJobs().
   */
  needsDetail?: boolean;
}

/** One company turned up by discovery, with the result of trying to find its job board. */
export interface DiscoveryCandidate {
  name: string;
  domain: string | null;
  why: string | null;
  sourceUrl: string | null;
  /** A board URL the model offered, tried only if the company's own site doesn't reveal one. */
  boardUrl: string | null;
  /** pending until checked; "exists" means it was already in the company list. */
  status: "pending" | "added" | "exists" | "no_board" | "error";
  atsType: AtsType | null;
  atsSlug: string | null;
  openJobs: number | null;
  companyId: number | null;
  note: string | null;
}
