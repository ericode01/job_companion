import type { Comp, NormalizedJob } from "@jd/core";
import { parseCompFromText } from "../comp";
import { fetchJson } from "../http";
import { inferLocationType } from "../location";
import { decodeHtmlEntities, htmlToText } from "../text";
import type { AtsAdapter } from "./types";

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  location: { name: string } | null;
  offices?: { name: string; location: string | null }[];
  departments?: { name: string }[];
  content?: string;
  updated_at?: string;
  first_published?: string | null;
  company_name?: string;
  pay_input_ranges?: { min_cents: number; max_cents: number; currency_type: string; title?: string }[];
}

function payRange(job: GhJob): Comp | null {
  const r = job.pay_input_ranges?.[0];
  if (!r) return null;
  return { min: r.min_cents / 100, max: r.max_cents / 100, currency: r.currency_type, interval: "year" };
}

export const greenhouse: AtsAdapter = {
  type: "greenhouse",
  detect(url) {
    const m =
      url.match(/(?:job-)?boards(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/)?(?:embed\/job_board\?for=)?([\w-]+)/i) ??
      url.match(/greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([\w-]+)/i);
    const slug = m?.[1];
    return slug && !["embed", "v1"].includes(slug) ? { slug: slug.toLowerCase() } : null;
  },
  async listJobs(slug) {
    const data = await fetchJson<{ jobs: GhJob[] }>(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true&pay_transparency=true`,
    );
    const jobs = data.jobs.map((j): NormalizedJob => {
      const html = decodeHtmlEntities(j.content ?? "");
      const text = htmlToText(html);
      const locations = (j.location?.name ?? "")
        .split(/\s*[;|]\s*|\s+or\s+/i)
        .map((s) => s.trim())
        .filter(Boolean);
      return {
        externalId: String(j.id),
        title: j.title.trim(),
        url: j.absolute_url,
        applyUrl: j.absolute_url,
        locations,
        locationType: inferLocationType(locations),
        remoteCountries: [],
        department: j.departments?.[0]?.name ?? null,
        comp: payRange(j) ?? parseCompFromText(text),
        descriptionHtml: html,
        descriptionText: text,
        postedAt: j.first_published ? new Date(j.first_published) : j.updated_at ? new Date(j.updated_at) : null,
      };
    });
    return { companyName: data.jobs[0]?.company_name ?? null, jobs };
  },
};
