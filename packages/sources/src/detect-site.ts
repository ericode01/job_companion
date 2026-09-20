import type { AtsType } from "@jd/core";
import { adapters, detectAts } from "./adapters";
import { fetchText, HttpError } from "./http";

/**
 * Most companies host their own /careers page and embed or link out to an ATS. This walks the
 * usual career-page paths, pulls every URL out of the HTML, and keeps the ATS board that the
 * page points at most often — then proves it by actually listing the board's jobs.
 */

const CAREER_PATHS = ["/careers", "/jobs", "/careers/jobs", "/company/careers", "/about/careers", "/join-us", "/"];

/** Career pages often only link to the board from a "See open roles" page one hop further in. */
const JOBS_LINK = /career|jobs?|opening|open-role|position|vacanc|join-us|work-with-us/i;

/** Slugs that appear in ATS marketing or boilerplate links rather than a real board. */
const BOGUS_SLUGS = new Set(["www", "about", "privacy", "terms", "blog", "help", "support", "en-us", "job", "jobs", "search"]);

export interface SiteAtsHit {
  atsType: AtsType;
  atsSlug: string;
  /** The page the board link was found on. */
  foundOn: string;
  openJobs: number;
  companyName: string | null;
}

export function originOf(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`);
    return u.origin;
  } catch {
    return null;
  }
}

/** Every http(s) URL in a blob of HTML, including ones inside escaped JSON or `//host` refs. */
export function urlsIn(html: string): string[] {
  const text = html.replace(/\\\//g, "/").replace(/&amp;/g, "&");
  return [...text.matchAll(/(?:https?:)?\/\/[\w.-]+\.[a-z]{2,}[^\s"'<>)\\]*/gi)].map((m) => m[0]);
}

/** Same-origin pages a careers page points at that are probably the jobs listing. */
export function jobsLinksIn(html: string, origin: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    const href = m[1]!;
    if (!JOBS_LINK.test(href)) continue;
    try {
      const u = new URL(href, origin);
      if (u.origin === origin && u.pathname !== "/") out.add(u.origin + u.pathname);
    } catch {
      /* skip unparseable hrefs */
    }
  }
  return [...out];
}

/** ATS boards referenced by a page, most-referenced first. */
export function boardsIn(html: string): { type: AtsType; slug: string; hits: number }[] {
  const counts = new Map<string, { type: AtsType; slug: string; hits: number }>();
  for (const url of urlsIn(html)) {
    const hit = detectAts(url.startsWith("//") ? `https:${url}` : url);
    if (!hit || BOGUS_SLUGS.has(hit.slug.toLowerCase())) continue;
    const key = `${hit.type}:${hit.slug}`;
    const entry = counts.get(key) ?? { ...hit, hits: 0 };
    entry.hits++;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.hits - a.hits);
}

/** Confirms a board exists and has open postings. Returns null when it doesn't. */
export async function verifyBoard(type: AtsType, slug: string): Promise<{ openJobs: number; companyName: string | null } | null> {
  try {
    const { companyName, jobs } = await adapters[type].listJobs(slug, { maxJobs: 20 });
    return jobs.length ? { openJobs: jobs.length, companyName } : null;
  } catch (err) {
    if (err instanceof HttpError) return null;
    throw err;
  }
}

/**
 * Finds the job board behind a company website. `input` can be a domain, a home page, or a
 * careers page — if it already points at an ATS, that board is verified directly.
 */
export async function findAtsForSite(input: string, opts: { maxPages?: number } = {}): Promise<SiteAtsHit | null> {
  const direct = detectAts(input);
  if (direct) {
    const ok = await verifyBoard(direct.type, direct.slug);
    if (ok) return { atsType: direct.type, atsSlug: direct.slug, foundOn: input, ...ok };
  }

  const origin = originOf(input);
  if (!origin) return null;
  const given = /^https?:\/\//i.test(input) && new URL(input).pathname !== "/" ? [input] : [];
  const pages = [...new Set([...given, ...CAREER_PATHS.map((p) => origin + p)])].slice(0, opts.maxPages ?? 8);

  const tried = new Set<string>();
  const queue = [...pages];
  const visited = new Set<string>();
  const maxPages = opts.maxPages ?? 12;

  for (let i = 0; i < queue.length && visited.size < maxPages; i++) {
    const page = queue[i]!;
    if (visited.has(page)) continue;
    visited.add(page);

    let html: string;
    let finalUrl = page;
    try {
      const res = await fetchText(page);
      html = res.body;
      finalUrl = res.url;
    } catch {
      continue; // 404s on guessed paths are the normal case.
    }
    for (const board of boardsIn(html)) {
      const key = `${board.type}:${board.slug}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const ok = await verifyBoard(board.type, board.slug);
      if (ok) return { atsType: board.type, atsSlug: board.slug, foundOn: finalUrl, ...ok };
    }
    // Nothing on this page, but it may link to the actual listing one hop in.
    if (i < pages.length) {
      for (const link of jobsLinksIn(html, origin).slice(0, 4)) if (!visited.has(link)) queue.push(link);
    }
  }
  return null;
}
