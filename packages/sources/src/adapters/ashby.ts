import type { Comp, NormalizedJob } from "@jd/core";
import { parseCompFromText } from "../comp";
import { fetchJson } from "../http";
import { inferLocationType } from "../location";
import type { AtsAdapter } from "./types";

interface AshbyAddress {
  postalAddress?: { addressCountry?: string; addressLocality?: string; addressRegion?: string };
}
interface AshbyJob {
  id: string;
  title: string;
  department?: string;
  team?: string;
  location?: string;
  secondaryLocations?: { location: string; address?: AshbyAddress }[];
  publishedAt?: string;
  isListed?: boolean;
  isRemote?: boolean;
  workplaceType?: "OnSite" | "Hybrid" | "Remote" | null;
  address?: AshbyAddress;
  jobUrl: string;
  applyUrl: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  compensation?: {
    summaryComponents?: { compensationType: string; interval: string; currencyCode: string | null; minValue: number | null; maxValue: number | null }[];
  };
}

function comp(job: AshbyJob): Comp | null {
  const salary = job.compensation?.summaryComponents?.find((c) => c.compensationType === "Salary");
  if (!salary || (salary.minValue === null && salary.maxValue === null)) return null;
  return {
    min: salary.minValue,
    max: salary.maxValue,
    currency: salary.currencyCode,
    interval: /hour/i.test(salary.interval) ? "hour" : "year",
  };
}

const WORKPLACE = { OnSite: "onsite", Hybrid: "hybrid", Remote: "remote" } as const;

export const ashby: AtsAdapter = {
  type: "ashby",
  detect(url) {
    const m = url.match(/(?:jobs\.ashbyhq\.com|api\.ashbyhq\.com\/posting-api\/job-board)\/([\w.%-]+)/i);
    return m?.[1] ? { slug: decodeURIComponent(m[1]) } : null;
  },
  async listJobs(slug) {
    const data = await fetchJson<{ jobs: AshbyJob[] }>(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`,
    );
    const jobs = data.jobs
      .filter((j) => j.isListed !== false)
      .map((j): NormalizedJob => {
        const all = [
          { location: j.location ?? "", address: j.address },
          ...(j.secondaryLocations ?? []),
        ].filter((l) => l.location);
        const locations = all.map((l) => l.location);
        const locationType = j.workplaceType ? WORKPLACE[j.workplaceType] : j.isRemote ? "remote" : inferLocationType(locations);
        const remoteCountries = all
          .filter((l) => /remote/i.test(l.location) || (j.isRemote && all.length === 1))
          .map((l) => l.address?.postalAddress?.addressCountry?.toLowerCase())
          .filter((c): c is string => !!c)
          .map((c) => (c === "usa" || c === "us" ? "united states" : c));
        const text = j.descriptionPlain ?? "";
        return {
          externalId: j.id,
          title: j.title.trim(),
          url: j.jobUrl,
          applyUrl: j.applyUrl,
          locations,
          locationType,
          remoteCountries,
          department: j.department ?? j.team ?? null,
          comp: comp(j) ?? parseCompFromText(text),
          descriptionHtml: j.descriptionHtml ?? "",
          descriptionText: text,
          postedAt: j.publishedAt ? new Date(j.publishedAt) : null,
        };
      });
    return { companyName: null, jobs };
  },
};
