import type { NormalizedJob } from "@jd/core";
import { parseCompFromText } from "../comp";
import { fetchJson, postJson } from "../http";
import { inferLocationType } from "../location";
import { htmlToText } from "../text";
import type { AtsAdapter } from "./types";

/**
 * Workday boards are per-tenant, so the slug carries everything needed to rebuild a URL:
 * "{host}/{tenant}/{site}", e.g. "nvidia.wd5.myworkdayjobs.com/nvidia/NVIDIAExternalCareerSite".
 */
interface Board {
  host: string;
  tenant: string;
  site: string;
}

/** Workday only ever returns 20 postings per request, whatever limit you ask for. */
const PAGE = 20;
/** Its search caps out around here; asking for more offsets just returns nothing. */
const MAX_OFFSET = 2000;

interface WdPosting {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

interface WdDetail {
  jobPostingInfo?: {
    id?: string;
    title?: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    startDate?: string;
    timeType?: string;
    jobReqId?: string;
    externalUrl?: string;
    remoteType?: string;
  };
}

export function parseBoard(slug: string): Board | null {
  const [host, tenant, site] = slug.split("/");
  return host && tenant && site ? { host, tenant, site } : null;
}

export function publicUrl(b: Board, externalPath = ""): string {
  const base = b.host.endsWith("myworkdaysite.com")
    ? `https://${b.host}/recruiting/${b.tenant}/${b.site}`
    : `https://${b.host}/${b.site}`;
  return base + externalPath;
}

const cxs = (b: Board) => `https://${b.host}/wday/cxs/${b.tenant}/${b.site}`;

/** "5 Locations" tells us nothing useful; the real list only comes from the job detail. */
const isLocationCount = (s: string) => /^\d+\s+locations?$/i.test(s.trim());

/**
 * Workday reports age as prose ("Posted 3 Days Ago"), not a date. Good enough for the
 * posting-age filter; hydrating the job replaces it with the real start date.
 */
export function parsePostedOn(text: string | undefined, now = new Date()): Date | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const days = /today|just posted/.test(t)
    ? 0
    : /yesterday/.test(t)
      ? 1
      : Number(t.match(/(\d+)\+?\s*day/)?.[1] ?? NaN);
  if (Number.isNaN(days)) return null;
  return new Date(now.getTime() - days * 86_400_000);
}

function toJob(b: Board, p: WdPosting, now: Date): NormalizedJob {
  const locationsText = (p.locationsText ?? "").trim();
  const multi = isLocationCount(locationsText);
  const locations = multi || !locationsText ? [] : [locationsText];
  const reqId = p.bulletFields?.find((f) => f && !/\s/.test(f));
  return {
    externalId: reqId ?? p.externalPath,
    title: p.title.trim(),
    url: publicUrl(b, p.externalPath),
    applyUrl: publicUrl(b, `${p.externalPath}/apply`),
    locations,
    locationType: locations.length ? inferLocationType(locations) : "unknown",
    remoteCountries: [],
    department: null,
    comp: null,
    descriptionHtml: "",
    descriptionText: "",
    postedAt: parsePostedOn(p.postedOn, now),
    // The list endpoint carries no description, and multi-location jobs carry no real location.
    needsDetail: true,
  };
}

/** The board's own landing page, for links in the UI and as a research starting point. */
export function workdayBoardUrl(slug: string): string {
  const b = parseBoard(slug);
  return b ? publicUrl(b) : slug;
}

export const workday: AtsAdapter = {
  type: "workday",

  detect(url) {
    const u = url.replace(/^\/\//, "https://");
    // wday/cxs/{tenant}/{site} — the API URL itself.
    const api = u.match(/^https?:\/\/([\w.-]*(?:myworkdayjobs|myworkdaysite)\.com)\/wday\/cxs\/([\w.-]+)\/([\w.-]+)/i);
    if (api) return { slug: `${api[1]!.toLowerCase()}/${api[2]}/${api[3]}` };

    // wd1.myworkdaysite.com/[locale/]recruiting/{tenant}/{site}
    const site = u.match(/^https?:\/\/([\w.-]*myworkdaysite\.com)\/(?:[a-z]{2}[-_][A-Z]{2}\/)?recruiting\/([\w.-]+)\/([\w.-]+)/i);
    if (site) return { slug: `${site[1]!.toLowerCase()}/${site[2]}/${site[3]}` };

    // {tenant}.wd{N}.myworkdayjobs.com/[locale/]{site}
    const jobs = u.match(/^https?:\/\/([\w-]+)\.(wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}[-_][A-Z]{2}\/)?([\w.-]+)/i);
    if (jobs) {
      const tenant = jobs[1]!.toLowerCase();
      return { slug: `${tenant}.${jobs[2]!.toLowerCase()}/${tenant}/${jobs[3]}` };
    }
    return null;
  },

  async listJobs(slug, opts = {}) {
    const b = parseBoard(slug);
    if (!b) throw new Error(`Malformed Workday slug "${slug}" (expected host/tenant/site)`);
    const max = Math.min(opts.maxJobs ?? MAX_OFFSET, MAX_OFFSET);
    const now = new Date();
    const url = `${cxs(b)}/jobs`;

    const first = await postJson<{ total?: number; jobPostings?: WdPosting[] }>(url, {
      appliedFacets: {},
      limit: PAGE,
      offset: 0,
      searchText: "",
    });
    const postings = [...(first.jobPostings ?? [])];
    const total = Math.min(first.total ?? postings.length, max);

    const offsets: number[] = [];
    for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
    // The per-host semaphore in http.ts keeps this from stampeding a single tenant.
    const pages = await Promise.all(
      offsets.map((offset) =>
        postJson<{ jobPostings?: WdPosting[] }>(url, { appliedFacets: {}, limit: PAGE, offset, searchText: "" }),
      ),
    );
    for (const page of pages) postings.push(...(page.jobPostings ?? []));

    const seen = new Set<string>();
    const jobs: NormalizedJob[] = [];
    for (const p of postings.slice(0, max)) {
      const job = toJob(b, p, now);
      if (seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      jobs.push(job);
    }
    return { companyName: null, jobs };
  },

  async hydrate(slug, job) {
    const b = parseBoard(slug);
    if (!b) throw new Error(`Malformed Workday slug "${slug}"`);
    // Every Workday posting path starts at "/job/", whatever locale or site prefix precedes it.
    const path = new URL(job.url).pathname;
    const start = path.indexOf("/job/");
    // A fetch failure throws so the caller can retry; a posting with no detail is simply done.
    const info = start < 0 ? null : (await fetchJson<WdDetail>(`${cxs(b)}${path.slice(start)}`)).jobPostingInfo;
    if (!info) return { ...job, needsDetail: false };
    const html = info.jobDescription ?? "";
    const text = htmlToText(html);
    const locations = [info.location, ...(info.additionalLocations ?? [])]
      .map((l) => l?.trim())
      .filter((l): l is string => !!l);
    return {
      ...job,
      title: info.title?.trim() || job.title,
      url: info.externalUrl || job.url,
      locations: locations.length ? locations : job.locations,
      locationType: locations.length ? inferLocationType(locations) : job.locationType,
      comp: parseCompFromText(text),
      descriptionHtml: html,
      descriptionText: text,
      postedAt: info.startDate ? new Date(info.startDate) : job.postedAt,
      needsDetail: false,
    };
  },
};
