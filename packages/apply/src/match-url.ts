import { getDb, schema } from "@jd/core/db";
import { and, eq } from "drizzle-orm";

/** Finds the job an application page belongs to, from its URL. */
export function matchJobByUrl(rawUrl: string): { jobId: number } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname;
  let ats: "greenhouse" | "lever" | "ashby" | "workday" | "smartrecruiters" | null = null;
  let slug: string | null = null;
  let externalId: string | null = null;
  const parts = url.pathname.split("/").filter(Boolean);

  if (/\.myworkdayjobs\.com$/.test(host)) {
    // {tenant}.wdN.myworkdayjobs.com/{site}/job/{location}/{Title}_{REQ-ID}; the slug starts with the host.
    const jobAt = parts.indexOf("job");
    const last = jobAt >= 0 ? parts.at(-1) : undefined;
    if (last?.includes("_")) {
      ats = "workday";
      slug = host;
      externalId = decodeURIComponent(last.slice(last.lastIndexOf("_") + 1));
    }
  } else if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") {
    // jobs.smartrecruiters.com/{Company}/{id}-{title-slug}
    const id = parts[1]?.match(/^(\d+)/)?.[1];
    if (id) {
      ats = "smartrecruiters";
      slug = parts[0] ?? null;
      externalId = id;
    }
  } else if (/greenhouse\.io$/.test(host)) {
    ats = "greenhouse";
    // job-boards.greenhouse.io/{slug}/jobs/{id} or /embed/job_app?for={slug}&token={id}
    if (parts[0] === "embed") {
      slug = url.searchParams.get("for");
      externalId = url.searchParams.get("token");
    } else {
      slug = parts[0] ?? null;
      externalId = parts[2] ?? url.searchParams.get("gh_jid");
    }
  } else if (host === "jobs.lever.co") {
    ats = "lever";
    [slug = null, externalId = null] = parts;
  } else if (host === "jobs.ashbyhq.com") {
    ats = "ashby";
    slug = parts[0] ? decodeURIComponent(parts[0]) : null;
    externalId = parts[1] ?? null;
  } else if (url.searchParams.get("gh_jid")) {
    ats = "greenhouse";
    externalId = url.searchParams.get("gh_jid");
  }
  if (!ats || !externalId) return null;

  const db = getDb();
  const rows = db
    .select({ id: schema.job.id, slug: schema.company.atsSlug })
    .from(schema.job)
    .innerJoin(schema.company, eq(schema.company.id, schema.job.companyId))
    .where(and(eq(schema.job.atsType, ats), eq(schema.job.externalId, externalId)))
    .all();
  const sameSlug = (r: { slug: string }) =>
    !slug || r.slug.toLowerCase() === slug.toLowerCase() || (ats === "workday" && r.slug.toLowerCase().startsWith(`${slug.toLowerCase()}/`));
  const hit = rows.find(sameSlug) ?? (rows.length === 1 ? rows[0] : undefined);
  return hit ? { jobId: hit.id } : null;
}
