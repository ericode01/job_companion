import { describe, expect, it } from "vitest";

// Behaviour that changed meaning when the database moved from SQLite to Postgres. Each of these
// compiled and passed before the fix; they're pinned here so they stay fixed.

const { useTestDb } = await import("@jd/core/testing");
await useTestDb("jd-pg-");

const { getDb, returned, schema } = await import("@jd/core/db");
const sources = await import("../src");

const posting = (externalId: string, title: string) => ({
  externalId,
  title,
  url: `https://x/${externalId}`,
  applyUrl: `https://x/${externalId}/apply`,
  locations: ["Remote - US"],
  locationType: "remote" as const,
  remoteCountries: ["US"],
  department: null,
  comp: null,
  descriptionHtml: "",
  descriptionText: "",
  postedAt: new Date(),
});

const addCompany = async (slug: string, lastCrawledAt: Date | null) =>
  (await returned(getDb().insert(schema.company).values({ name: slug, atsType: "lever", atsSlug: slug, source: "manual", lastCrawledAt }).returning())).id;

describe("on Postgres", () => {
  it("crawls never-crawled companies first, though Postgres sorts nulls last", async () => {
    const longAgo = new Date(Date.now() - 30 * 86_400_000);
    await addCompany("crawled-long-ago", longAgo);
    const fresh = await addCompany("never-crawled", null);
    const stale = await sources.staleCompanies();
    expect(stale[0]?.id).toBe(fresh);
  });

  it("finds a mixed-case title with a lowercase keyword: LIKE is case-sensitive here", async () => {
    const companyId = await addCompany("casing", new Date());
    await sources.storeCompanyJobs(companyId, "lever", [posting("c1", "Senior SOFTWARE Engineer, Payments")]);
    const filter = { roleKeywords: ["software engineer"], levelKeywords: [], excludeKeywords: [], locations: [], includeRemoteUS: true, remoteOnly: false, postedWithinDays: null };
    const results = await sources.runSearch(null, filter);
    expect(results.map((r) => r.title)).toContain("Senior SOFTWARE Engineer, Payments");
  });

  it("counts closed jobs and inserted companies from RETURNING, not SQLite's .changes", async () => {
    const companyId = await addCompany("closing", new Date());
    await sources.storeCompanyJobs(companyId, "lever", [posting("k1", "Engineer"), posting("k2", "Engineer"), posting("k3", "Engineer")]);
    // k2 and k3 disappeared from the board.
    expect(await sources.storeCompanyJobs(companyId, "lever", [posting("k1", "Engineer")])).toEqual({ upserted: 1, closed: 2 });

    const seed = [{ name: "Seeded", ats: "lever" as const, slug: "seeded" }];
    expect(await sources.importSeedCompanies(seed)).toBe(1);
    expect(await sources.importSeedCompanies(seed)).toBe(0); // already there: ON CONFLICT DO NOTHING
  });

  it("returns counts as numbers, though node-postgres reads count(*) as a string", async () => {
    const { jobs, companies } = await sources.countOpenJobs();
    expect(typeof jobs).toBe("number");
    expect(typeof companies).toBe("number");
    expect(jobs).toBeGreaterThan(0);
  });
});
