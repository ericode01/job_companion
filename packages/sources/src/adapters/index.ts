import type { AtsType } from "@jd/core";
import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { smartrecruiters } from "./smartrecruiters";
import type { AtsAdapter } from "./types";
import { prettifySlug } from "../text";
import { parseBoard, workday, workdayBoardUrl } from "./workday";

export const adapters: Record<AtsType, AtsAdapter> = { greenhouse, lever, ashby, workday, smartrecruiters };

/** Human labels for the Settings page and company list. */
export const ATS_LABELS: Record<AtsType, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workday: "Workday",
  smartrecruiters: "SmartRecruiters",
};

/** The public landing page for a board, e.g. for the "View job board" link. */
export function boardUrl(type: AtsType, slug: string): string {
  switch (type) {
    case "greenhouse":
      return `https://job-boards.greenhouse.io/${slug}`;
    case "lever":
      return `https://jobs.lever.co/${slug}`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${encodeURIComponent(slug)}`;
    case "smartrecruiters":
      return `https://jobs.smartrecruiters.com/${slug}`;
    case "workday":
      return workdayBoardUrl(slug);
  }
}

/**
 * A readable company name from a slug alone, for boards whose API doesn't give one.
 * Workday slugs carry a host and a site name, so only the tenant is worth showing.
 */
export function boardName(type: AtsType, slug: string): string {
  return prettifySlug(type === "workday" ? (parseBoard(slug)?.tenant ?? slug) : slug);
}

export function detectAts(url: string): { type: AtsType; slug: string } | null {
  for (const a of Object.values(adapters)) {
    const hit = a.detect(url);
    if (hit) return { type: a.type, slug: hit.slug };
  }
  return null;
}

export type { AtsAdapter, ListOptions } from "./types";
