import type Anthropic from "@anthropic-ai/sdk";
import type { FitResult, JobAnalysis, ResumeSource } from "@jd/core";
import type { StructuredNotes } from "../src/company";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makePdf, useTempDataDir } from "./helpers";

useTempDataDir();

/* ---- fake Claude client ---- */
const parseQueue: unknown[] = [];
const streamQueue: Partial<Anthropic.Message>[] = [];
const calls: { kind: "parse" | "stream"; params: Anthropic.MessageCreateParams }[] = [];
const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } as Anthropic.Usage;

const fakeClient = {
  messages: {
    parse: vi.fn(async (params: Anthropic.MessageCreateParams) => {
      calls.push({ kind: "parse", params });
      const next = parseQueue.shift();
      if (next instanceof Error) throw next;
      return { stop_reason: "end_turn", content: [], usage, parsed_output: next };
    }),
    stream: vi.fn((params: Anthropic.MessageCreateParams) => {
      // Copy messages: the caller mutates the array after the call.
      calls.push({ kind: "stream", params: { ...params, messages: [...params.messages] } });
      const next = streamQueue.shift()!;
      return { finalMessage: async () => ({ usage, content: [], ...next }) };
    }),
  },
};

vi.mock("@jd/llm", async (orig) => ({
  ...(await orig<typeof import("@jd/llm")>()),
  getClient: () => fakeClient,
  hasApiKey: () => true,
}));

const core = await import("@jd/core");
const { getDb, schema } = await import("@jd/core/db");
const research = await import("../src");
const { storeCompanyJobs } = await import("@jd/sources");

let companyId: number;
let jobId: number;

const RESUME: ResumeSource = {
  contact: { name: "Sam Rivera", email: "sam@example.com", phone: null, location: "Brooklyn, NY", links: ["https://github.com/samr", "linkedin.com/in/samr"] },
  summary: "Backend engineer",
  experience: [
    { id: "e1", company: "Acme", title: "Senior Software Engineer", location: "NYC", start: "2021", end: "Present", bullets: [{ id: "e1b1", text: "Built payments ledger in Go" }] },
  ],
  education: [],
  skills: [{ category: "Languages", items: ["Go", "Python"] }],
  projects: [],
  certifications: [],
  additional: [{ heading: "Entrepreneurial experience", items: ["Co-founded a RAG-based app"] }],
};

let userId = 0;

beforeAll(() => {
  const db = getDb();
  userId = db.insert(schema.user).values({ email: "sam@example.com", name: "Sam", passwordHash: "x", role: "member" }).returning().get().id;
  companyId = db.insert(schema.company).values({ name: "Acme", domain: "acme.com", atsType: "greenhouse", atsSlug: "acme", source: "manual" }).returning().get().id;
  storeCompanyJobs(companyId, "greenhouse", [
    {
      externalId: "1",
      title: "Staff Software Engineer, Payments",
      url: "https://x/1",
      applyUrl: "https://x/1",
      locations: ["New York, NY"],
      locationType: "hybrid",
      remoteCountries: [],
      department: "Payments",
      comp: null,
      descriptionHtml: "<p>Go, Kafka. 8+ years.</p>",
      descriptionText: "Go, Kafka. 8+ years.",
      postedAt: new Date(),
    },
  ]);
  jobId = db.select().from(schema.job).get()!.id;
});

beforeEach(() => {
  parseQueue.length = 0;
  streamQueue.length = 0;
  calls.length = 0;
});

describe("task queue", () => {
  it("dedupes queued tasks and promotes background tasks a user asks for", () => {
    const a = core.enqueueTask("analyze_job", "job:q1", { jobId: 1 }, { background: true });
    const b = core.enqueueTask("analyze_job", "job:q1", { jobId: 1 }, { background: true });
    expect(b.id).toBe(a.id);
    const promoted = core.enqueueTask("analyze_job", "job:q1", { jobId: 1 }, { background: false });
    expect(promoted).toMatchObject({ id: a.id, background: false, priority: 10 });
  });

  it("claims by priority and schedules retries", () => {
    const low = core.enqueueTask("score_fit", "fit:q2", {}, { background: true });
    const high = core.enqueueTask("score_fit", "fit:q3", {}, { background: false });
    expect(core.claimTask(["score_fit"])?.id).toBe(high.id);
    const claimed = core.claimTask(["score_fit"])!;
    expect(claimed.id).toBe(low.id);
    core.failTask(claimed.id, "rate limited", new Date(Date.now() + 60_000));
    expect(core.claimTask(["score_fit"])).toBeNull(); // not runnable yet
    getDb().delete(schema.task).run();
  });
});

describe("resume", () => {
  it("stores the PDF, extracts text, parses sections, and prefills the profile without overwriting", async () => {
    core.saveProfile(userId, { name: "Samantha R.", links: {} });
    const row = await research.saveMasterResume(userId, makePdf(["Sam Rivera", "Senior Software Engineer at Acme"]), "../../etc/sam.pdf");
    expect(row.fileName).toBe("sam.pdf");
    expect(row.parsedText).toContain("Senior Software Engineer at Acme");
    expect(row.parseStatus).toBe("pending");

    parseQueue.push(RESUME);
    const parsed = await research.parseResume(row.id, { background: false });
    expect(parsed.parseStatus).toBe("done");
    expect(parsed.source?.experience[0]?.bullets[0]?.id).toBe("e1b1");
    const docBlock = (calls[0]!.params.messages[0]!.content as Anthropic.ContentBlockParam[])[0]!;
    expect(docBlock.type).toBe("document");

    const profile = core.getProfile(userId)!;
    expect(profile.name).toBe("Samantha R."); // kept
    expect(profile.email).toBe("sam@example.com"); // filled
    expect(profile.links).toMatchObject({ github: "https://github.com/samr", linkedin: "linkedin.com/in/samr" });
  });

  it("rejects non-PDF uploads", async () => {
    await expect(research.saveMasterResume(userId, new TextEncoder().encode("hello"), "x.pdf")).rejects.toThrow("isn't a PDF");
  });

  it("changing the resume changes its hash", () => {
    const cur = research.currentMasterResume(userId)!;
    const edited = research.updateResumeSource(cur.id, { ...RESUME, summary: "Changed" });
    expect(edited.sourceHash).not.toBe(cur.sourceHash);
  });
});

describe("job analysis and fit", () => {
  it("stores analysis keyed to the job's content hash", async () => {
    const analysis: JobAnalysis = {
      summary: "Own the payments ledger",
      level: "Staff",
      team: "Payments",
      techStack: ["Go", "Kafka"],
      mustHave: ["8+ years"],
      niceToHave: [],
      minYearsExperience: 8,
      workplacePolicy: null,
      visaSponsorship: "unspecified",
      compensation: null,
    };
    parseQueue.push(analysis);
    const row = await research.analyzeJob(jobId, { background: false });
    expect(row.data.techStack).toEqual(["Go", "Kafka"]);
    expect(row.contentHash).toBe(getDb().select().from(schema.job).get()!.contentHash);
  });

  it("scores fit with the resume in a cached system prefix and clamps the score", async () => {
    const resume = research.currentMasterResume(userId)!;
    const fit: FitResult = { score: 104.6, verdict: "strong", summary: "Great", strengths: [{ point: "Payments", evidence: "ledger in Go" }], gaps: [], talkingPoints: [] };
    parseQueue.push(fit);
    const row = await research.scoreFit(jobId, resume.id, { background: true });
    expect(row.score).toBe(100);
    const system = calls[0]!.params.system as Anthropic.TextBlockParam[];
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(system[0]!.text).toContain("Built payments ledger in Go");
    expect(system[0]!.text).toContain("ENTREPRENEURIAL EXPERIENCE\n- Co-founded a RAG-based app");
    expect(research.getFitScores([jobId], resume.sourceHash).get(jobId)).toBe(100);
  });

  it("enqueueFitScores skips jobs already scored for this resume", () => {
    expect(research.enqueueFitScores(userId, [jobId], true)).toBe(0);
  });

  it("stops background work when the spend cap is reached", async () => {
    core.saveSettings("ai", { dailyCapUsd: 0 });
    await expect(research.analyzeJob(jobId, { background: true })).rejects.toThrow("daily limit");
    core.saveSettings("ai", {});
  });

  it("holds a member to their own daily cap, and records spend against them", async () => {
    core.saveSettings("ai", { perUserDailyCapUsd: 0 });
    await core.runAs(userId, () => expect(research.analyzeJob(jobId, { background: false })).rejects.toThrow("your daily limit"));
    core.saveSettings("ai", {});
    core.runAs(userId, () => core.recordUsage({ purpose: "test", model: "claude-haiku-4-5", inputTokens: 1000, outputTokens: 0 }));
    expect(core.getSpendStatus(new Date(), userId).userTodayUsd).toBeGreaterThan(0);
  });
});

describe("company research", () => {
  const structured: StructuredNotes = {
    overview: "Acme makes payments software.",
    products: [
      { name: "Ledger", description: "Double-entry ledger", sourceUrl: "https://acme.com/ledger" },
      { name: "Made up", description: "x", sourceUrl: "https://invented.example/page" },
    ],
    facts: [
      { key: "customers", value: "Fintechs", sourceUrl: "https://acme.com/customers" },
      { key: "founded", value: "2015", sourceUrl: "https://acme.com/about/" },
      { key: "headquarters", value: "New York", sourceUrl: "https://acme.com/about" },
      { key: "headcount", value: "~500 (2026)", sourceUrl: "https://hallucinated.example" },
      { key: "stage", value: "Series C", sourceUrl: "https://news.example/acme-series-c" },
      { key: "totalFunding", value: "$200M", sourceUrl: "https://news.example/acme-series-c" },
      { key: "lastRound", value: "Series C, $120M, 2025", sourceUrl: "https://news.example/acme-series-c" },
    ],
    competitors: ["Globex"],
    investors: ["Initech Ventures"],
    recentNews: [{ headline: "Fake news", date: null, sourceUrl: "https://nowhere.example" }],
    confidence: "medium",
    notes: null,
  };

  it("resumes paused turns, then keeps only sources that were actually consulted", async () => {
    streamQueue.push({
      stop_reason: "pause_turn",
      content: [
        {
          type: "web_search_tool_result",
          tool_use_id: "s1",
          content: [{ type: "web_search_result", url: "https://news.example/acme-series-c", title: "t", encrypted_content: "", page_age: null }],
        } as unknown as Anthropic.ContentBlock,
      ],
    });
    streamQueue.push({
      stop_reason: "end_turn",
      content: [
        {
          type: "web_fetch_tool_result",
          tool_use_id: "f1",
          content: { type: "web_fetch_result", url: "https://acme.com/about", retrieved_at: null, content: {} },
        } as unknown as Anthropic.ContentBlock,
        { type: "text", text: "Acme makes payments software [https://acme.com/ledger]. Customers are fintechs [https://acme.com/customers].", citations: null } as Anthropic.TextBlock,
      ],
    });
    parseQueue.push(structured);

    const row = await research.researchCompany(companyId, { background: false });

    const streams = calls.filter((c) => c.kind === "stream");
    expect(streams).toHaveLength(2);
    expect(streams[1]!.params.messages.at(-1)!.role).toBe("assistant"); // paused turn sent back, no extra user message
    const tools = streams[0]!.params.tools!.map((t) => ("type" in t ? t.type : ""));
    expect(tools).toEqual(["web_search_20250305"]); // basic search; page fetches are off by default
    expect(streams[0]!.params.cache_control).toEqual({ type: "ephemeral" });

    const d = row.data;
    expect(d.products.map((p) => p.sourceUrl)).toEqual(["https://acme.com/ledger", null]);
    expect(d.headcount).toEqual({ value: "~500 (2026)", sourceUrl: null });
    expect(d.founded.sourceUrl).toBe("https://acme.com/about/"); // trailing slash normalized
    expect(d.lastRound.sourceUrl).toBe("https://news.example/acme-series-c");
    expect(d.recentNews).toEqual([]);
    expect(d.stage.value).toBe("series-c");
    expect(d.businessModel).toEqual({ value: null, sourceUrl: null });

    expect(row.consultedUrls).toEqual(expect.arrayContaining(["https://news.example/acme-series-c", "https://acme.com/about"]));
    expect(research.isProfileStale(row)).toBe(false);
  });

  it("reuses cached notes when structuring is retried", async () => {
    parseQueue.push(new Error("grammar too large"));
    await expect(research.researchCompany(companyId, { background: false })).rejects.toThrow("grammar");
    expect(calls.filter((c) => c.kind === "stream")).toHaveLength(0); // no queued stream: would throw if research re-ran
  });
});

describe("unsupportedClaims", () => {
  it("flags numbers and counted phrases that aren't in the facts", async () => {
    const { unsupportedClaims } = await import("../src/util");
    const facts = "Senior Engineer Apr 2018 - present. Monitoring for 1M+ devices; cut toil by 70%. Walmart, BlackRock.";
    expect(unsupportedClaims("For the past six years I monitored 1M devices across 200+ data centers and cut toil 70%.", facts)).toEqual(["200+", "six years"]);
    expect(unsupportedClaims("Since 2018 I've cut toil by 70%.", facts)).toEqual([]);
    expect(unsupportedClaims("across 200+ data centers", "Graduated 2008, salary 200,000")).toEqual(["200+"]);
    // Everyday small numbers and suffixed figures that are in the facts must not be flagged.
    expect(unsupportedClaims("Owned Tier 0 systems for 1M+ devices at 99%+ coverage across 3 teams", "Tier 0 backbone, 1M network devices, 99% of devices")).toEqual([]);
  });
});

describe("resume tailoring", () => {
  const master: ResumeSource = {
    contact: { name: "Sam Rivera", email: null, phone: null, location: null, links: [] },
    summary: "Backend engineer with 8 years building payments systems.",
    experience: [
      {
        id: "e1",
        company: "Acme",
        title: "Senior Engineer",
        location: null,
        start: "2019",
        end: "Present",
        bullets: [
          { id: "e1b1", text: "Built a double-entry ledger in Go handling 12k transactions per second." },
          { id: "e1b2", text: "Ran the on-call rotation and cut paging volume by 40%." },
          { id: "e1b3", text: "Mentored three engineers." },
        ],
      },
      { id: "e2", company: "Initech", title: "Engineer", location: null, start: "2016", end: "2019", bullets: [{ id: "e2b1", text: "Maintained a billing service in Python." }] },
    ],
    education: [],
    skills: [{ category: "Languages", items: ["Go", "Python", "SQL"] }],
    projects: [],
    certifications: [],
    additional: [],
  };

  it("keeps rewrites truthful and reports what it reverted", async () => {
    const { applyTailoring } = await import("../src/tailor");
    const { source, warnings } = applyTailoring(master, {
      summary: "Backend engineer with 8 years building payments systems at scale.",
      experience: [
        {
          id: "e1",
          bullets: [
            { sourceId: "e1b2", text: "Owned on-call and cut paging volume by 40%." }, // fine: reordered + reworded
            { sourceId: "e1b1", text: "Built a distributed ledger in Go handling 50k transactions per second." }, // invented number
            { sourceId: "e1b3", text: "Led a team of twelve engineers across three continents." }, // drifted + invented
            { sourceId: "nope", text: "Designed Kubernetes operators." }, // no source
          ],
        },
      ],
      skills: [{ category: "Languages", items: ["Go", "Rust"] }],
      changes: [{ section: "Summary", sourceId: null, after: "…", reason: "Matches the posting" }],
    });

    const bullets = source.experience[0]!.bullets.map((b) => b.text);
    expect(bullets[0]).toBe("Owned on-call and cut paging volume by 40%.");
    expect(bullets[1]).toBe(master.experience[0]!.bullets[0]!.text); // reverted: 50k isn't in the resume
    expect(bullets[2]).toBe(master.experience[0]!.bullets[2]!.text); // reverted: invented team size
    expect(bullets).toHaveLength(3); // the sourceless bullet is dropped
    expect(source.experience[1]).toEqual(master.experience[1]); // untouched roles are kept
    expect(source.skills.flatMap((s) => s.items)).toEqual(expect.arrayContaining(["Go", "Python", "SQL"]));
    expect(source.skills.flatMap((s) => s.items)).not.toContain("Rust");
    expect(warnings).toHaveLength(4);
    expect(warnings.join(" ")).toMatch(/didn't come from your resume/);
  });

  it("fills in the original text for each reported change", async () => {
    const { applyTailoring } = await import("../src/tailor");
    const { changes } = applyTailoring(master, {
      summary: null,
      experience: [{ id: "e1", bullets: [{ sourceId: "e1b1", text: "Built a double-entry ledger in Go." }] }],
      skills: master.skills,
      changes: [{ section: "Acme", sourceId: "e1b1", after: "Built a double-entry ledger in Go.", reason: "Shorter" }],
    });
    expect(changes[0]!.before).toBe(master.experience[0]!.bullets[0]!.text);
  });

  it("keeps a role's strongest bullet when tailoring empties it", async () => {
    const { applyTailoring } = await import("../src/tailor");
    const { source, warnings } = applyTailoring(master, { summary: null, experience: [{ id: "e1", bullets: [] }], skills: master.skills, changes: [] });
    expect(source.experience[0]!.bullets).toHaveLength(1);
    expect(warnings.join(" ")).toMatch(/kept its first bullet/);
  });

  it("renders a PDF and plain text", async () => {
    const { renderResumePdf, resumeToText } = await import("../src/resume-pdf");
    const pdf = await renderResumePdf(master);
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(resumeToText(master)).toContain("double-entry ledger");
  });
});
