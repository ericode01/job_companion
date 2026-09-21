import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { returned } from "@jd/core/db";

const { useTestDb } = await import("@jd/core/testing");
await useTestDb("jd-digest-");

const core = await import("@jd/core");
const { getDb, schema } = await import("@jd/core/db");
const { storeCompanyJobs } = await import("@jd/sources");
const digest = await import("../src");

const filter = {
  roleKeywords: ["engineer"],
  levelKeywords: ["staff"],
  excludeKeywords: [],
  locations: [{ label: "New York City", aliases: ["new york"] }],
  includeRemoteUS: true,
  remoteOnly: false,
  postedWithinDays: 30,
};

let jobIds: number[] = [];
let me = 0;
let other = 0;
let followedId = 0;

beforeAll(async () => {
  const db = getDb();
  me = (await core.createFirstAdmin({ name: "Me", email: "me@example.com", password: "correct horse battery", timezone: "America/New_York" })).id;
  other = (await returned(db.insert(schema.user).values({ email: "other@example.com", name: "Other", passwordHash: "x", role: "member" }).returning())).id;
  const companyId = (await returned(db.insert(schema.company).values({ name: "Acme", atsType: "lever", atsSlug: "acme", source: "manual" }).returning())).id;
  await storeCompanyJobs(companyId, "lever", [1, 2].map((n) => ({
    externalId: `j${n}`,
    title: `Staff Engineer ${n}`,
    url: `https://x/${n}`,
    applyUrl: `https://x/${n}/apply`,
    locations: ["New York, NY"],
    locationType: "onsite" as const,
    remoteCountries: [],
    department: null,
    comp: { min: 220000, max: 260000, currency: "USD", interval: "year" as const },
    descriptionHtml: "",
    descriptionText: "Go, Kafka",
    postedAt: new Date(),
  })));
  jobIds = (await db.select({ id: schema.job.id }).from(schema.job)).map((r) => r.id);
  followedId = (await returned(db.insert(schema.savedSearch).values({ userId: me, rawQuery: "staff engineer in NYC", filter, parsedBy: "rules", notify: true }).returning())).id;
  await db.insert(schema.savedSearch).values({ userId: me, rawQuery: "not followed", filter, parsedBy: "rules", notify: false });
  // Someone else's followed search must never show up in my email.
  await db.insert(schema.savedSearch).values({ userId: other, rawQuery: "someone else's search", filter, parsedBy: "rules", notify: true });
});

describe("buildDigest", () => {
  it("includes new jobs from my followed searches only", async () => {
    const d = await digest.buildDigest(me);
    expect(d.sections).toHaveLength(1);
    expect(d.sections[0]!.query).toBe("staff engineer in NYC");
    expect(d.total).toBe(2);
    expect(d.sections[0]!.jobs[0]).toMatchObject({ companyName: "Acme", fitScore: null });
  });

  it("renders text and HTML with links back to the dashboard, and pay", async () => {
    const d = await digest.buildDigest(me);
    const text = digest.renderText(d);
    expect(text).toContain("Staff Engineer 1");
    expect(text).toContain(`http://127.0.0.1:4317/jobs/${jobIds[0]}?d=${followedId}`);
    const html = digest.renderHtml(d);
    expect(html).toContain("$220k–260k");
    expect(html).toContain("2 new matches");
    expect(digest.subjectFor(d)).toContain("2 new matches");
  });

  it("uses each dashboard's own fit threshold", async () => {
    const d = await digest.buildDigest(me);
    expect(d.sections[0]!.minFitScore).toBe(60); // the person's default
    await getDb().update(schema.savedSearch).set({ digestMinFit: 80 }).where(eq(schema.savedSearch.id, followedId));
    expect((await digest.buildDigest(me)).sections[0]!.minFitScore).toBe(80);
  });

  it("skips when nothing is new and records the window, per person", async () => {
    await core.saveUserSettings(me, "digest", { enabled: true, to: "me@example.com", skipWhenEmpty: true });
    const first = await digest.runDigest(me, { now: new Date() });
    expect(first.status).toBe("failed"); // no SMTP credentials in tests
    expect((await digest.buildDigest(me)).total).toBe(0); // my window moved past the jobs already reported
    expect((await digest.buildDigest(other)).total).toBe(2); // theirs didn't
    const empty = await digest.runDigest(me);
    expect(empty).toMatchObject({ status: "skipped", reason: "No new matches or email updates." });
  });

  it("sends at the person's own local time, once a day", async () => {
    // 12:30 UTC is 08:30 in New York (EDT) — past an 08:00 send time there, not yet in Los Angeles.
    const noonish = new Date("2026-09-18T12:30:00Z");
    expect(digest.clockIn("America/New_York", noonish)).toMatchObject({ h: 8, m: 30, ymd: "2026-09-18" });
    await core.saveUserSettings(other, "digest", { enabled: true, to: "other@example.com", sendTime: "08:00" });
    await getDb().update(schema.user).set({ timezone: "America/New_York" }).where(eq(schema.user.id, other));
    expect(await digest.digestDue(other, noonish)).toBe(true);
    await getDb().update(schema.user).set({ timezone: "America/Los_Angeles" }).where(eq(schema.user.id, other));
    expect(await digest.digestDue(other, noonish)).toBe(false);
    await core.saveUserSettings(other, "digest", { enabled: false, to: "other@example.com" });
    expect(await digest.digestDue(other, new Date("2026-09-18T23:00:00Z"))).toBe(false);
  });
});
