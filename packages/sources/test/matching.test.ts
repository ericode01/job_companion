import { describe, expect, it } from "vitest";
import { detectAts } from "../src/adapters";
import { parseCompFromText } from "../src/comp";
import { isRemoteUSString, matchLocation } from "../src/location";
import { matchJob, type MatchableJob } from "../src/match";
import { PLACES, parseQueryWithRules } from "../src/query-rules";

const defaults = { includeRemoteUS: true, postedWithinDays: 30 };
const nycStaff = parseQueryWithRules("staff software engineer in NYC", defaults);
const now = new Date("2026-09-16T12:00:00Z");

function job(title: string, locations: string[], extra: Partial<MatchableJob> = {}): MatchableJob {
  return { title, locations, locationType: "onsite", remoteCountries: [], postedAt: now, companyName: "Acme", ...extra };
}

describe("parseQueryWithRules", () => {
  it("parses level, role, and place", () => {
    expect(nycStaff.levelKeywords).toEqual(["staff"]);
    expect(nycStaff.roleKeywords).toContain("software engineer");
    expect(nycStaff.locations).toEqual([PLACES.nyc]);
    expect(nycStaff.includeRemoteUS).toBe(true);
    expect(nycStaff.excludeKeywords).toContain("manager");
  });

  it("does not exclude the requested level", () => {
    const f = parseQueryWithRules("software engineering intern in seattle", defaults);
    expect(f.levelKeywords).toContain("intern");
    expect(f.excludeKeywords).not.toContain("intern");
  });
});

describe("matchJob", () => {
  const cases: [string, string[], boolean][] = [
    ["Staff Software Engineer, Payments", ["New York, NY"], true],
    ["Staff Engineer - Infrastructure", ["NYC"], true],
    ["Senior Staff Backend Engineer", ["Brooklyn, New York"], true],
    ["Staff Software Engineer", ["Remote - US"], true],
    ["Staff Software Engineer", ["Remote (Canada)"], false],
    ["Staff Software Engineer", ["San Francisco, CA"], false],
    ["Senior Software Engineer", ["New York, NY"], false],
    ["Staff Engineering Manager", ["New York, NY"], false],
    ["Staff Solutions Engineer", ["New York, NY"], false],
    ["Staff Product Designer", ["New York, NY"], false],
  ];
  it.each(cases)("%s @ %j → %s", (title, locations, expected) => {
    expect(matchJob(job(title, locations), nycStaff, { now }).pass).toBe(expected);
  });

  it("uses structured remote countries", () => {
    const j = job("Staff Software Engineer", ["Anywhere"], { locationType: "remote", remoteCountries: ["united states"] });
    expect(matchJob(j, nycStaff, { now }).location).toMatchObject({ match: true, reason: "remote_us" });
  });

  it("respects the remote-US toggle", () => {
    const onsiteOnly = { ...nycStaff, includeRemoteUS: false };
    expect(matchJob(job("Staff Software Engineer", ["Remote - US"]), onsiteOnly, { now }).pass).toBe(false);
  });

  it("filters by posting age", () => {
    const old = job("Staff Software Engineer", ["New York"], { postedAt: new Date("2026-07-01") });
    expect(matchJob(old, nycStaff, { now })).toMatchObject({ pass: false, failed: "age" });
  });

  it("applies excluded companies from settings", () => {
    expect(matchJob(job("Staff Software Engineer", ["NYC"]), nycStaff, { now, excludedCompanies: ["acme"] }).pass).toBe(false);
  });
});

describe("location helpers", () => {
  it.each([
    ["Remote - United States", true],
    ["US Remote", true],
    ["Remote", true],
    ["Remote, EMEA", false],
    ["Remote (Canada)", false],
    ["New York, NY", false],
  ])("isRemoteUSString(%s) → %s", (s, expected) => {
    expect(isRemoteUSString(s)).toBe(expected);
  });

  it("does not match short aliases inside words", () => {
    expect(matchLocation(job("x", ["Sfax, Tunisia"]), [PLACES.sf!], false).match).toBe(false);
  });
});

describe("parseCompFromText", () => {
  it("reads full and k-suffixed ranges", () => {
    expect(parseCompFromText("The base salary range is $230,000 - $280,000 USD")).toMatchObject({ min: 230000, max: 280000 });
    expect(parseCompFromText("$211.4K – $290.6K • Offers Equity")).toMatchObject({ min: 211400, max: 290600 });
  });
  it("ignores hourly and non-salary amounts", () => {
    expect(parseCompFromText("$25 - $40 per hour")).toBeNull();
  });
});

describe("detectAts", () => {
  it.each([
    ["https://job-boards.greenhouse.io/stripe/jobs/123", "greenhouse", "stripe"],
    ["https://boards.greenhouse.io/embed/job_board?for=airbnb", "greenhouse", "airbnb"],
    ["https://jobs.lever.co/palantir/abc-123", "lever", "palantir"],
    ["https://jobs.ashbyhq.com/ramp/34413f8d", "ashby", "ramp"],
  ])("%s", (url, type, slug) => {
    expect(detectAts(url)).toEqual({ type, slug });
  });
  it("returns null for other sites", () => {
    expect(detectAts("https://careers.example.com/jobs")).toBeNull();
  });
});

describe("remote only", () => {
  const remote = parseQueryWithRules("senior backend engineer remote", defaults);
  it("parses a bare remote query as remote-only", () => {
    expect(remote).toMatchObject({ remoteOnly: true, locations: [] });
    expect(parseQueryWithRules("staff engineer in NYC or remote", defaults).remoteOnly).toBe(false);
  });
  it("rejects onsite jobs when remote-only", () => {
    expect(matchJob(job("Senior Backend Engineer", ["Austin, TX"]), remote, { now }).pass).toBe(false);
    expect(matchJob(job("Senior Backend Engineer", ["Remote - US"]), remote, { now }).pass).toBe(true);
    expect(matchJob(job("Senior Backend Engineer", ["Remote - Canada"]), remote, { now }).pass).toBe(false);
  });
});
