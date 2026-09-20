import { afterEach, describe, expect, it, vi } from "vitest";
import { boardUrl, detectAts } from "../src/adapters";
import { smartrecruiters } from "../src/adapters/smartrecruiters";
import { parsePostedOn, workday } from "../src/adapters/workday";
import { boardsIn, originOf, urlsIn } from "../src/detect-site";

/** Replaces global fetch with a router keyed on a substring of the URL. */
function mockFetch(routes: Record<string, unknown>) {
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    const body = routes[key];
    return typeof body === "string"
      ? new Response(body, { status: 200, headers: { "content-type": "text/html" } })
      : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  return spy;
}

afterEach(() => vi.restoreAllMocks());

describe("detectAts", () => {
  const cases: [string, string, string][] = [
    ["https://boards.greenhouse.io/doordash", "greenhouse", "doordash"],
    ["https://job-boards.greenhouse.io/vercel/jobs/4567", "greenhouse", "vercel"],
    ["https://jobs.lever.co/matchgroup/abc-123", "lever", "matchgroup"],
    ["https://jobs.ashbyhq.com/ramp/34413f8d", "ashby", "ramp"],
    [
      "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Eng_JR1",
      "workday",
      "nvidia.wd5.myworkdayjobs.com/nvidia/NVIDIAExternalCareerSite",
    ],
    [
      "https://salesforce.wd12.myworkdayjobs.com/External_Career_Site",
      "workday",
      "salesforce.wd12.myworkdayjobs.com/salesforce/External_Career_Site",
    ],
    [
      "https://wd1.myworkdaysite.com/en-US/recruiting/acme/AcmeCareers",
      "workday",
      "wd1.myworkdaysite.com/acme/AcmeCareers",
    ],
    [
      "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs",
      "workday",
      "nvidia.wd5.myworkdayjobs.com/nvidia/NVIDIAExternalCareerSite",
    ],
    ["https://jobs.smartrecruiters.com/BoschGroup/744000150275869-claims", "smartrecruiters", "BoschGroup"],
  ];
  for (const [url, type, slug] of cases) {
    it(`reads ${type} from ${url.slice(8, 48)}`, () => expect(detectAts(url)).toEqual({ type, slug }));
  }

  it("ignores unrelated URLs", () => {
    expect(detectAts("https://www.databricks.com/company/careers")).toBeNull();
    expect(detectAts("https://greenhouse.io/ai_opt_out_request/job_post/5039945004")).toBeNull();
  });

  it("round-trips a slug back to a board URL", () => {
    expect(boardUrl("workday", "nvidia.wd5.myworkdayjobs.com/nvidia/NVIDIAExternalCareerSite")).toBe(
      "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite",
    );
    expect(boardUrl("smartrecruiters", "BoschGroup")).toBe("https://jobs.smartrecruiters.com/BoschGroup");
  });
});

describe("workday", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  const day = 86_400_000;

  it("reads Workday's relative posting dates", () => {
    expect(parsePostedOn("Posted Today", now)).toEqual(now);
    expect(parsePostedOn("Posted Yesterday", now)).toEqual(new Date(now.getTime() - day));
    expect(parsePostedOn("Posted 3 Days Ago", now)).toEqual(new Date(now.getTime() - 3 * day));
    expect(parsePostedOn("Posted 30+ Days Ago", now)).toEqual(new Date(now.getTime() - 30 * day));
    expect(parsePostedOn("Posted last month", now)).toBeNull();
    expect(parsePostedOn(undefined, now)).toBeNull();
  });

  const slug = "acme.wd5.myworkdayjobs.com/acme/AcmeCareers";
  const listing = {
    total: 2,
    jobPostings: [
      {
        title: "Staff Software Engineer",
        externalPath: "/job/US-NY-New-York/Staff-Software-Engineer_JR100",
        locationsText: "3 Locations",
        postedOn: "Posted Yesterday",
        bulletFields: ["JR100"],
      },
      {
        title: "Data Scientist",
        externalPath: "/job/US-CA-Remote/Data-Scientist_JR101",
        locationsText: "US, CA, Remote",
        postedOn: "Posted Today",
        bulletFields: ["JR101"],
      },
    ],
  };

  it("lists jobs, flags the ones whose locations are hidden behind a count", async () => {
    mockFetch({ "/wday/cxs/acme/AcmeCareers/jobs": listing });
    const { jobs } = await workday.listJobs(slug);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: "JR100",
      title: "Staff Software Engineer",
      url: "https://acme.wd5.myworkdayjobs.com/AcmeCareers/job/US-NY-New-York/Staff-Software-Engineer_JR100",
      locations: [],
      locationType: "unknown",
      needsDetail: true,
    });
    // A single-location posting keeps what the list gave us, but still needs its description.
    expect(jobs[1]).toMatchObject({ locations: ["US, CA, Remote"], locationType: "remote", needsDetail: true });
  });

  it("stops at maxJobs instead of paging through a huge tenant", async () => {
    const fetchSpy = mockFetch({ "/wday/cxs/acme/AcmeCareers/jobs": { ...listing, total: 5000 } });
    await workday.listJobs(slug, { maxJobs: 20 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("fills in the real locations and description on hydrate", async () => {
    mockFetch({
      "/wday/cxs/acme/AcmeCareers/jobs": listing,
      "/wday/cxs/acme/AcmeCareers/job/US-NY-New-York": {
        jobPostingInfo: {
          title: "Staff Software Engineer",
          jobDescription: "<p>Build <b>things</b>. Base pay $220,000 - $260,000 USD.</p>",
          location: "US, NY, New York",
          additionalLocations: ["US, CA, Santa Clara", "US, WA, Remote"],
          startDate: "2026-09-17",
          externalUrl: "https://acme.wd5.myworkdayjobs.com/AcmeCareers/job/US-NY-New-York/Staff-Software-Engineer_JR100",
        },
      },
    });
    const { jobs } = await workday.listJobs(slug);
    const full = await workday.hydrate!(slug, jobs[0]!);
    expect(full.locations).toEqual(["US, NY, New York", "US, CA, Santa Clara", "US, WA, Remote"]);
    expect(full.descriptionText).toContain("Build things");
    expect(full.comp).toMatchObject({ min: 220000, max: 260000 });
    expect(full.postedAt).toEqual(new Date("2026-09-17"));
    expect(full.needsDetail).toBe(false);
  });

  it("marks a posting done when its detail page has nothing", async () => {
    mockFetch({ "/wday/cxs/acme/AcmeCareers/jobs": listing, "/wday/cxs/acme/AcmeCareers/job/": {} });
    const { jobs } = await workday.listJobs(slug);
    expect((await workday.hydrate!(slug, jobs[0]!)).needsDetail).toBe(false);
  });

  it("lets a failed detail request through so the job stays pending", async () => {
    mockFetch({ "/wday/cxs/acme/AcmeCareers/jobs": listing });
    const { jobs } = await workday.listJobs(slug);
    await expect(workday.hydrate!(slug, jobs[0]!)).rejects.toThrow(/404/);
  });
});

describe("smartrecruiters", () => {
  const postings = {
    totalFound: 1,
    content: [
      {
        id: "744000150275429",
        name: "Senior Sales Account Manager",
        company: { name: "Bosch Group" },
        location: { city: "Sunnyvale", region: "CA", country: "us", remote: false, fullLocation: "Sunnyvale, CA, United States" },
        department: { label: "Sales" },
        releasedDate: "2026-09-18T04:40:42.707Z",
        postingUrl: "https://jobs.smartrecruiters.com/BoschGroup/744000150275429-senior-sales",
        applyUrl: "https://jobs.smartrecruiters.com/BoschGroup/744000150275429-senior-sales?oga=true",
      },
    ],
  };

  it("maps a posting", async () => {
    mockFetch({ "/companies/BoschGroup/postings?limit": postings });
    const { companyName, jobs } = await smartrecruiters.listJobs("BoschGroup");
    expect(companyName).toBe("Bosch Group");
    expect(jobs[0]).toMatchObject({
      externalId: "744000150275429",
      title: "Senior Sales Account Manager",
      locations: ["Sunnyvale, CA, United States"],
      department: "Sales",
      needsDetail: true,
    });
  });

  it("treats an unknown company's empty page as a missing board", async () => {
    mockFetch({ "/companies/Nope/postings?limit": { totalFound: 0, content: [] } });
    await expect(smartrecruiters.listJobs("Nope")).rejects.toThrow(/404/);
  });

  it("joins the job-ad sections on hydrate", async () => {
    mockFetch({
      "/companies/BoschGroup/postings?limit": postings,
      "/postings/744000150275429": {
        jobAd: {
          sections: {
            jobDescription: { title: "Job Description", text: "<p>Sell things.</p>" },
            qualifications: { title: "Qualifications", text: "<p>Ten years of selling.</p>" },
          },
        },
      },
    });
    const { jobs } = await smartrecruiters.listJobs("BoschGroup");
    const full = await smartrecruiters.hydrate!("BoschGroup", jobs[0]!);
    expect(full.descriptionText).toContain("Sell things.");
    expect(full.descriptionText).toContain("Qualifications");
    expect(full.needsDetail).toBe(false);
  });
});

describe("career-site detection", () => {
  it("normalizes whatever the user pastes into an origin", () => {
    expect(originOf("ramp.com")).toBe("https://ramp.com");
    expect(originOf("https://www.figma.com/careers/")).toBe("https://www.figma.com");
    expect(originOf("  ")).toBeNull();
  });

  it("finds URLs hidden in escaped JSON", () => {
    const html = String.raw`{"jobUrl":"https://jobs.ashbyhq.com/ramp/34413f8d"} <a href="//boards.greenhouse.io/acme">`;
    expect(urlsIn(html)).toContain("https://jobs.ashbyhq.com/ramp/34413f8d");
    expect(urlsIn(html)).toContain("//boards.greenhouse.io/acme");
  });

  it("ranks boards by how often a page points at them", () => {
    const html = `
      <a href="https://jobs.ashbyhq.com/ramp/aaa">One</a>
      <a href="https://jobs.ashbyhq.com/ramp/bbb">Two</a>
      <a href="https://boards.greenhouse.io/someoneelse">Partner jobs</a>`;
    expect(boardsIn(html)[0]).toEqual({ type: "ashby", slug: "ramp", hits: 2 });
  });

  it("skips boilerplate ATS links that aren't boards", () => {
    expect(boardsIn('<a href="https://boards.greenhouse.io/privacy">Privacy</a>')).toEqual([]);
  });
});
