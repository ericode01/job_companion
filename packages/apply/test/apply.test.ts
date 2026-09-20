import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { FormQuestion } from "@jd/core";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "jd-apply-"));

const parseQueue: unknown[] = [];
const calls: Anthropic.MessageCreateParams[] = [];
const usage = { input_tokens: 10, output_tokens: 10 } as Anthropic.Usage;
vi.mock("@jd/llm", async (orig) => ({
  ...(await orig<typeof import("@jd/llm")>()),
  hasApiKey: () => true,
  getClient: () => ({
    messages: {
      parse: async (p: Anthropic.MessageCreateParams) => {
        calls.push(p);
        return { stop_reason: "end_turn", content: [], usage, parsed_output: parseQueue.shift() };
      },
    },
  }),
}));

const apply = await import("../src");
const rules = await import("../src/rules");
const { getDb, schema } = await import("@jd/core/db");
const { storeCompanyJobs } = await import("@jd/sources");

let jobId: number;
let applicationId: number;
let userId: number;
let otherId: number;

beforeAll(() => {
  const db = getDb();
  userId = db.insert(schema.user).values({ email: "sam@example.com", name: "Sam", passwordHash: "x", role: "member" }).returning().get().id;
  otherId = db.insert(schema.user).values({ email: "alex@example.com", name: "Alex", passwordHash: "x", role: "member" }).returning().get().id;
  const companyId = db.insert(schema.company).values({ name: "Acme", atsType: "lever", atsSlug: "acme", source: "manual" }).returning().get().id;
  storeCompanyJobs(companyId, "lever", [
    {
      externalId: "a4ca6614-e302-48f9-800c-fc9903ea5b5a",
      title: "Staff Engineer",
      url: "https://jobs.lever.co/acme/a4ca6614-e302-48f9-800c-fc9903ea5b5a",
      applyUrl: "https://jobs.lever.co/acme/a4ca6614-e302-48f9-800c-fc9903ea5b5a/apply",
      locations: ["New York"],
      locationType: "onsite",
      remoteCountries: [],
      department: null,
      comp: null,
      descriptionHtml: "",
      descriptionText: "Build things in Go.",
      postedAt: new Date(),
    },
  ]);
  jobId = db.select().from(schema.job).get()!.id;
  db.insert(schema.profile).values({ userId, name: "SAM Q RIVERA", email: "sam@example.com", phone: "555-0100", links: { linkedin: "https://linkedin.com/in/sam" } }).run();
  applicationId = apply.prepareApplication(userId, jobId, { coverLetter: "no" }).id;
});

describe("rules", () => {
  it("maps answers onto real option wording", () => {
    expect(rules.pickOptions("No", ["Yes, I will require sponsorship", "No, I will not require sponsorship"])).toEqual(["No, I will not require sponsorship"]);
    expect(rules.pickOptions("Decline to self-identify", ["Male", "Female", "I don't wish to answer"])).toEqual(["I don't wish to answer"]);
    expect(rules.pickOptions("Yes", ["Maybe"])).toEqual([]);
  });
  it("detects consent and EEO questions", () => {
    expect(rules.isConsentQuestion('By selecting "I agree", I understand that my information will be processed')).toBe(true);
    expect(rules.isConsentQuestion("Palantir has my consent to contact me about future job opportunities.")).toBe(true);
    expect(rules.isConsentQuestion("Why do you want to work here?")).toBe(false);
    expect(rules.isEeoQuestion("Race/Ethnicity (Select all that apply)")).toBe(true);
    expect(rules.standardCategoryOf("Will you now or in the future require sponsorship for employment visa status (e.g. H-1B visa status)?")).toBe("sponsorship");
    expect(rules.standardCategoryOf("Are you able to work in the US without sponsorship?")).toBeNull();
    expect(rules.standardCategoryOf("Are you legally authorized to work in the United States?")).toBe("work_auth");
  });
});

describe("grounding", () => {
  it("rejects numbers that aren't in the facts", () => {
    expect(apply.isGrounded("10019", "350 Fifth Ave, New York, NY")).toBe(false);
    expect(apply.isGrounded("8 years", "Senior Engineer 2016 - Present, 8 years of Go")).toBe(true);
    expect(apply.isGrounded("$1,200,000", "raised 1200000")).toBe(true);
    expect(apply.isGrounded("Initech", "anything")).toBe(true);
  });
});

describe("answer bank", () => {
  it("seeds defaults once and matches known wordings", () => {
    const first = apply.listAnswers(userId).length;
    expect(first).toBeGreaterThanOrEqual(7);
    expect(apply.listAnswers(userId).length).toBe(first);
    expect(apply.findExactAnswer(userId, "Are you legally authorized to work in the country where this job is located?*", jobId)?.answer).toBe("Yes");
  });

  it("job-scoped answers win for that job only", () => {
    apply.saveAnswer(userId, { question: "What are your salary expectations?", answer: "$250k", category: "salary", scope: "global" });
    apply.saveAnswer(userId, { question: "What are your salary expectations?", answer: "$300k", category: "salary", scope: "job", jobId });
    expect(apply.findExactAnswer(userId, "What are your salary expectations?", jobId)?.answer).toBe("$300k");
    expect(apply.findExactAnswer(userId, "What are your salary expectations?", null)?.answer).toBe("$250k");
  });
});

describe("resolveQuestions", () => {
  const q = (index: number, label: string, kind: FormQuestion["kind"], options: string[] = [], required = true): FormQuestion => ({ index, label, kind, required, options });

  it("answers from bank and rules without calling Claude, and never answers consents", async () => {
    calls.length = 0;
    const { answers } = await apply.resolveQuestions(userId, applicationId, [
      q(0, "Will you now or in the future require sponsorship for employment visa status (e.g. H-1B visa status)?", "radio", ["Yes", "No"]),
      q(1, "Gender", "select", ["Male", "Female", "Decline to self-identify"], false),
      q(2, "Veteran Status", "select", ["I am a protected veteran", "I am not a protected veteran", "I don't wish to answer"], false),
      q(3, "Palantir has my consent to contact me about future job opportunities.", "boolean", ["Yes", "No"], false),
    ]);
    expect(calls).toHaveLength(0);
    expect(answers[0]).toMatchObject({ value: "No", source: "bank", status: "filled", category: "sponsorship" });
    expect(answers[1]).toMatchObject({ value: "Decline to self-identify", status: "filled" });
    expect(answers[2]).toMatchObject({ value: "I don't wish to answer", status: "filled" });
    expect(answers[3]).toMatchObject({ value: null, status: "needs_user", saveable: false });
  });

  it("uses Claude for the rest: semantic bank match, drafts, and inbox for unknown recurring facts", async () => {
    calls.length = 0;
    const bank = apply.listAnswers(userId);
    const workAuth = bank.find((b) => b.category === "work_auth")!;
    parseQueue.push({
      items: [
        { index: 0, type: "recurring_fact", category: "work_auth", bankId: workAuth.id, answer: null, selectedOptions: [], confidence: "high", note: null },
        { index: 1, type: "job_specific", category: "custom", bankId: null, answer: "I built payments systems in Go.", selectedOptions: [], confidence: "low", note: null },
        { index: 2, type: "recurring_fact", category: "relocation", bankId: null, answer: null, selectedOptions: [], confidence: "low", note: null },
        { index: 3, type: "recurring_fact", category: "logistics", bankId: null, answer: null, selectedOptions: ["Not an option"], confidence: "low", note: null },
      ],
    });
    const { answers, inboxAdded } = await apply.resolveQuestions(userId, applicationId, [
      q(0, "Can you legally work for us in the US without restriction?", "select", ["Yes", "No"]),
      q(1, "Why Acme?", "textarea"),
      q(2, "Are you open to relocating to New York?", "radio", ["Yes", "No"]),
      q(3, "How did you hear about us?", "select", ["LinkedIn", "Referral"]),
    ]);
    expect(calls).toHaveLength(1);
    expect(answers[0]).toMatchObject({ value: "Yes", source: "bank", status: "filled" });
    expect(answers[1]).toMatchObject({ source: "ai_draft", status: "review", saveable: false });
    expect(answers[2]).toMatchObject({ value: null, status: "needs_user", category: "relocation" });
    expect(answers[3]).toMatchObject({ value: null, status: "needs_user" }); // invented option rejected
    expect(inboxAdded).toBe(2);
    expect(apply.listInbox(userId).map((i) => i.question)).toEqual(expect.arrayContaining(["Are you open to relocating to New York?", "How did you hear about us?"]));
    // The new wording is remembered for next time.
    expect(apply.findExactAnswer(userId, "Can you legally work for us in the US without restriction?", jobId)?.id).toBe(workAuth.id);
  });

  it("answering an inbox item saves it and closes the item", () => {
    const item = apply.listInbox(userId).find((i) => i.category === "relocation")!;
    apply.answerInboxItem(userId, item.id, "Yes", "global");
    expect(apply.listInbox(userId).some((i) => i.id === item.id)).toBe(false);
    expect(apply.findExactAnswer(userId, "Are you open to relocating to New York?", jobId)?.answer).toBe("Yes");
  });
});

describe("packet, URL matching, and pairing", () => {
  it("builds a packet with a readable name and split first/last", async () => {
    const packet = (await apply.buildPacket(userId, applicationId))!;
    expect(packet.profile).toMatchObject({ fullName: "Sam Q Rivera", firstName: "Sam", lastName: "Rivera", linkedin: "https://linkedin.com/in/sam" });
    expect(packet.resume).toBeNull();
    expect(packet.coverLetter).toBeNull();
  });

  it("renders a valid cover letter PDF", async () => {
    const bytes = await apply.coverLetterPdf("Dear Hiring Team,\n\n" + "I build reliable systems — at scale. ".repeat(80) + "\n\nSincerely,\nSam");
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
  });

  it("matches application URLs to jobs", () => {
    expect(apply.matchJobByUrl("https://jobs.lever.co/acme/a4ca6614-e302-48f9-800c-fc9903ea5b5a/apply")).toEqual({ jobId });
    expect(apply.matchJobByUrl("https://jobs.lever.co/other/unknown")).toBeNull();
    expect(apply.matchJobByUrl("not a url")).toBeNull();
  });

  it("maps each pairing token to its person, and rotates it", () => {
    const { token } = apply.getExtensionState(userId);
    const { token: theirs } = apply.getExtensionState(otherId);
    expect(apply.userForExtensionToken(token)).toBe(userId);
    expect(apply.userForExtensionToken(theirs)).toBe(otherId);
    expect(apply.userForExtensionToken("nope")).toBeNull();
    apply.rotateExtensionToken(userId);
    expect(apply.userForExtensionToken(token)).toBeNull();
    expect(apply.userForExtensionToken(theirs)).toBe(otherId);
  });

  it("keeps one person's answers, inbox and applications away from another", async () => {
    apply.saveAnswer(userId, { question: "Preferred pronouns?", answer: "they/them", category: "custom", scope: "global" });
    expect(apply.findExactAnswer(otherId, "Preferred pronouns?", jobId)).toBeNull();
    expect(apply.listInbox(otherId)).toEqual([]);
    expect(apply.getApplication(otherId, applicationId)).toBeNull();
    expect(await apply.buildPacket(otherId, applicationId)).toBeNull();
    // Each person gets their own starting answers, not someone else's edits.
    expect(apply.listAnswers(otherId).some((a) => a.question === "Preferred pronouns?")).toBe(false);
  });
});

describe("pickOptions with decorated options", () => {
  it("prefers the option that only adds a dial code", async () => {
    const { pickOptions } = await import("../src/rules");
    expect(pickOptions("United States", ["United States Minor Outlying Islands +1", "United States +1", "Uruguay +598"])).toEqual(["United States +1"]);
  });
});
