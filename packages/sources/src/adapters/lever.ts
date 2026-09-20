import type { NormalizedJob } from "@jd/core";
import { parseCompFromText } from "../comp";
import { fetchJson } from "../http";
import { inferLocationType } from "../location";
import type { AtsAdapter } from "./types";

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl: string;
  createdAt: number;
  country?: string | null;
  workplaceType?: "onsite" | "hybrid" | "remote" | "unspecified";
  categories: { location?: string; allLocations?: string[]; team?: string; department?: string };
  description?: string;
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
  additional?: string;
  additionalPlain?: string;
  salaryRange?: { min: number; max: number; currency: string; interval: string };
}

export const lever: AtsAdapter = {
  type: "lever",
  detect(url) {
    const m = url.match(/(?:jobs|api)\.lever\.co\/(?:v0\/postings\/)?([\w-]+)/i);
    return m?.[1] ? { slug: m[1].toLowerCase() } : null;
  },
  async listJobs(slug) {
    const data = await fetchJson<LeverPosting[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
    const jobs = data.map((p): NormalizedJob => {
      const lists = (p.lists ?? []).map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`).join("");
      const html = `${p.description ?? ""}${lists}${p.additional ?? ""}`;
      const text = [p.descriptionPlain, ...(p.lists ?? []).map((l) => `${l.text}\n${l.content.replace(/<[^>]+>/g, " ")}`), p.additionalPlain]
        .filter(Boolean)
        .join("\n\n");
      const locations = p.categories.allLocations?.length
        ? p.categories.allLocations
        : p.categories.location
          ? [p.categories.location]
          : [];
      const locationType =
        p.workplaceType && p.workplaceType !== "unspecified" ? p.workplaceType : inferLocationType(locations);
      const sr = p.salaryRange;
      return {
        externalId: p.id,
        title: p.text.trim(),
        url: p.hostedUrl,
        applyUrl: p.applyUrl,
        locations,
        locationType,
        remoteCountries: locationType === "remote" && p.country ? [p.country === "US" ? "united states" : p.country] : [],
        department: p.categories.team ?? p.categories.department ?? null,
        comp: sr
          ? { min: sr.min, max: sr.max, currency: sr.currency, interval: /hour/i.test(sr.interval) ? "hour" : "year" }
          : parseCompFromText(text),
        descriptionHtml: html,
        descriptionText: text,
        postedAt: new Date(p.createdAt),
      };
    });
    return { companyName: null, jobs };
  },
};
