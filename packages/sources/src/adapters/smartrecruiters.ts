import type { NormalizedJob } from "@jd/core";
import { parseCompFromText } from "../comp";
import { fetchJson, HttpError } from "../http";
import { inferLocationType } from "../location";
import { htmlToText } from "../text";
import type { AtsAdapter } from "./types";

const PAGE = 100;
const API = "https://api.smartrecruiters.com/v1/companies";

interface SrLocation {
  city?: string;
  region?: string;
  country?: string;
  remote?: boolean;
  fullLocation?: string;
}

interface SrPosting {
  id: string;
  name: string;
  refNumber?: string;
  releasedDate?: string;
  location?: SrLocation;
  department?: { label?: string };
  function?: { label?: string };
  company?: { name?: string };
  postingUrl?: string;
  applyUrl?: string;
}

interface SrDetail extends SrPosting {
  jobAd?: { sections?: Record<string, { title?: string; text?: string } | undefined> };
}

/** The order SmartRecruiters renders them in; companyDescription is boilerplate, so it goes last. */
const SECTIONS = ["jobDescription", "qualifications", "additionalInformation", "companyDescription"] as const;

function locationOf(l: SrLocation | undefined): string[] {
  if (!l) return [];
  const full = l.fullLocation?.trim();
  if (full) return [l.remote ? `Remote - ${full}` : full];
  const parts = [l.city, l.region, l.country?.toUpperCase()].map((p) => p?.trim()).filter(Boolean);
  if (!parts.length) return l.remote ? ["Remote"] : [];
  return [l.remote ? `Remote - ${parts.join(", ")}` : parts.join(", ")];
}

function toJob(slug: string, p: SrPosting): NormalizedJob {
  const locations = locationOf(p.location);
  const url = p.postingUrl ?? `https://jobs.smartrecruiters.com/${slug}/${p.id}`;
  return {
    externalId: p.id,
    title: p.name.trim(),
    url,
    applyUrl: p.applyUrl ?? url,
    locations,
    locationType: p.location?.remote ? "remote" : locations.length ? inferLocationType(locations) : "unknown",
    remoteCountries: p.location?.remote && p.location.country ? [countryName(p.location.country)] : [],
    department: p.department?.label ?? p.function?.label ?? null,
    comp: null,
    descriptionHtml: "",
    descriptionText: "",
    postedAt: p.releasedDate ? new Date(p.releasedDate) : null,
    // The list endpoint carries titles and locations but no description.
    needsDetail: true,
  };
}

function countryName(code: string): string {
  const c = code.toLowerCase();
  return c === "us" || c === "usa" ? "united states" : c;
}

export const smartrecruiters: AtsAdapter = {
  type: "smartrecruiters",

  detect(url) {
    const m =
      url.match(/jobs\.smartrecruiters\.com\/(?:sr-jobs\/)?([\w.-]+)/i) ??
      url.match(/api\.smartrecruiters\.com\/v1\/companies\/([\w.-]+)/i) ??
      url.match(/careers\.smartrecruiters\.com\/([\w.-]+)/i);
    const slug = m?.[1];
    return slug && !["oauth", "external-referrals", "sr-jobs"].includes(slug.toLowerCase()) ? { slug } : null;
  },

  async listJobs(slug, opts = {}) {
    const max = opts.maxJobs ?? 2000;
    const base = `${API}/${encodeURIComponent(slug)}/postings`;
    const first = await fetchJson<{ totalFound?: number; content?: SrPosting[] }>(`${base}?limit=${PAGE}&offset=0`);
    // An unknown company answers 200 with an empty page, so treat that as a missing board.
    if (!first.content?.length) throw new HttpError(404, base);

    const postings = [...first.content];
    const total = Math.min(first.totalFound ?? postings.length, max);
    const offsets: number[] = [];
    for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
    const pages = await Promise.all(
      offsets.map((offset) => fetchJson<{ content?: SrPosting[] }>(`${base}?limit=${PAGE}&offset=${offset}`)),
    );
    for (const page of pages) postings.push(...(page.content ?? []));

    return {
      companyName: postings[0]?.company?.name ?? null,
      jobs: postings.slice(0, max).map((p) => toJob(slug, p)),
    };
  },

  async hydrate(slug, job) {
    // A fetch failure throws so the caller can retry; a posting with no ad is simply done.
    const detail = await fetchJson<SrDetail>(
      `${API}/${encodeURIComponent(slug)}/postings/${encodeURIComponent(job.externalId)}`,
    );
    const sections = detail.jobAd?.sections;
    if (!sections) return { ...job, needsDetail: false };
    const html = SECTIONS.map((k) => {
      const s = sections[k];
      return s?.text ? `<h3>${s.title ?? k}</h3>${s.text}` : "";
    }).join("");
    const text = htmlToText(html);
    return { ...job, comp: parseCompFromText(text), descriptionHtml: html, descriptionText: text, needsDetail: false };
  },
};
