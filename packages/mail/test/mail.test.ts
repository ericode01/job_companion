import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { EmailClassification } from "@jd/core";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "jd-mail-"));
process.env.SECRET_KEY = "test-secret-key-for-mail-sync";
const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jd-mail-eml-"));
process.env.MAIL_FAKE_DIR = fakeDir;

const parseQueue: EmailClassification[] = [];
const calls: Anthropic.MessageCreateParams[] = [];
vi.mock("@jd/llm", async (orig) => ({
  ...(await orig<typeof import("@jd/llm")>()),
  hasApiKey: () => true,
  getClient: () => ({
    messages: {
      parse: async (p: Anthropic.MessageCreateParams) => {
        calls.push(p);
        return { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 10 }, parsed_output: parseQueue.shift() };
      },
    },
  }),
}));

const mail = await import("../src");
const { decryptSecret, encryptSecret, resetSecretKeyCache } = await import("@jd/core");
const { getDb, schema } = await import("@jd/core/db");
const { setStatus, recordCreated, undoEvent, applicationEvents } = await import("@jd/apply");
const { storeCompanyJobs } = await import("@jd/sources");
const { eq } = await import("drizzle-orm");

const cls = (over: Partial<EmailClassification>): EmailClassification => ({
  jobRelated: true,
  kind: "application_received",
  round: null,
  roundLabel: null,
  companyName: "Acme",
  jobTitle: "Staff Engineer",
  applicationRef: null,
  eventAt: null,
  action: { needed: false, type: null, text: null, dueAt: null },
  summary: "Something happened.",
  confidence: 0.95,
  ...over,
});

let userId: number;
let otherId: number;
let searchId: number;
let pmSearchId: number;
let acmeJob: number;
let globexJob: number;
let conn: typeof schema.mailboxConnection.$inferSelect;
let otherConn: typeof schema.mailboxConnection.$inferSelect;
let seq = 0;

function email(over: Partial<import("../src").RawEmail> = {}): import("../src").RawEmail {
  seq++;
  return {
    providerId: `m${seq}`,
    rfcMessageId: `<m${seq}@example.com>`,
    threadId: `t${seq}`,
    fromName: "Acme Recruiting",
    fromAddress: "no-reply@acme.com",
    subject: "Thanks for applying",
    receivedAt: new Date(Date.now() - 60_000),
    text: "We received your application.",
    links: [],
    ...over,
  };
}

function newApp(values: Partial<typeof schema.application.$inferInsert>) {
  const row = getDb()
    .insert(schema.application)
    .values({ userId, status: "applying", searchId, ...values })
    .returning()
    .get();
  recordCreated(row.id, row.status, "manual");
  return row;
}

const app = (id: number) => getDb().select().from(schema.application).where(eq(schema.application.id, id)).get()!;

beforeAll(() => {
  const db = getDb();
  userId = db.insert(schema.user).values({ email: "sam@example.com", name: "Sam", passwordHash: "x" }).returning().get().id;
  otherId = db.insert(schema.user).values({ email: "alex@example.com", name: "Alex", passwordHash: "x" }).returning().get().id;
  const acme = db.insert(schema.company).values({ name: "Acme", domain: "acme.com", atsType: "lever", atsSlug: "acme", source: "manual" }).returning().get().id;
  const globex = db.insert(schema.company).values({ name: "Globex Corporation", domain: "globex.com", atsType: "greenhouse", atsSlug: "globex", source: "manual" }).returning().get().id;
  const base = { locations: ["New York, NY"], locationType: "onsite" as const, remoteCountries: [], department: null, comp: null, descriptionHtml: "<p>x</p>", descriptionText: "x", postedAt: new Date() };
  storeCompanyJobs(acme, "lever", [{ ...base, externalId: "a1", title: "Staff Engineer", url: "https://jobs.lever.co/acme/a1", applyUrl: "https://jobs.lever.co/acme/a1/apply" }]);
  storeCompanyJobs(globex, "greenhouse", [{ ...base, externalId: "4001", title: "Senior Product Manager", url: "https://job-boards.greenhouse.io/globex/jobs/4001", applyUrl: "https://job-boards.greenhouse.io/globex/jobs/4001" }]);
  acmeJob = db.select().from(schema.job).where(eq(schema.job.externalId, "a1")).get()!.id;
  globexJob = db.select().from(schema.job).where(eq(schema.job.externalId, "4001")).get()!.id;
  const filter = (role: string[]) => ({ roleKeywords: role, levelKeywords: [], excludeKeywords: [], locations: [], includeRemoteUS: true, remoteOnly: false, postedWithinDays: null });
  searchId = db.insert(schema.savedSearch).values({ userId, rawQuery: "staff engineer", filter: filter(["engineer"]), parsedBy: "rules" }).returning().get().id;
  pmSearchId = db.insert(schema.savedSearch).values({ userId, rawQuery: "product manager", filter: filter(["product manager"]), parsedBy: "rules" }).returning().get().id;
  conn = db.insert(schema.mailboxConnection).values({ userId, provider: "imap", address: "sam@example.com", secret: encryptSecret("pw"), imapHost: "fake.local", imapPort: 993 }).returning().get();
  otherConn = db.insert(schema.mailboxConnection).values({ userId: otherId, provider: "imap", address: "alex@example.com", secret: encryptSecret("pw"), imapHost: "fake.local", imapPort: 993 }).returning().get();
});

describe("prefilter", () => {
  const ctx = { companyDomains: new Set(["acme.com"]), trackedThreads: new Set(["known"]), selfAddresses: new Set(["sam@example.com"]), digestFrom: new Set(["digest@jc.dev"]) };
  const h = (over: Partial<import("../src").EmailHeaders>) => ({ providerId: "x", threadId: null, fromName: null, fromAddress: "a@b.com", subject: "Hello", receivedAt: new Date(), ...over });

  it("keeps ATS mail, company mail with job words, LinkedIn applications and tracked threads", () => {
    expect(mail.prefilter(h({ fromAddress: "no-reply@us.greenhouse-mail.io", subject: "Thank you for applying to Stripe" }), ctx).keep).toBe(true);
    expect(mail.prefilter(h({ fromAddress: "jane@acme.com", subject: "Next steps" }), ctx).keep).toBe(true);
    expect(mail.prefilter(h({ fromAddress: "jobs-noreply@linkedin.com", subject: "Sam, your application was sent to Globex" }), ctx).keep).toBe(true);
    expect(mail.prefilter(h({ fromAddress: "friend@gmail.com", subject: "Re: lunch", threadId: "known" }), ctx).keep).toBe(true);
    // A vague subject from an unknown domain, saved by Gmail's preview.
    expect(mail.prefilter(h({ fromAddress: "morgan@talentbridge.io", subject: "Following up", snippet: "The hiring team had thoughts on your application" }), ctx).keep).toBe(true);
    expect(mail.prefilter(h({ fromAddress: "morgan@talentbridge.io", subject: "Following up" }), ctx).keep).toBe(false);
  });

  it("drops job alerts, our own digests, your own mail and newsletters", () => {
    expect(mail.prefilter(h({ fromAddress: "jobalerts-noreply@linkedin.com", subject: "30 new jobs for staff engineer" }), ctx).keep).toBe(false);
    expect(mail.prefilter(h({ fromAddress: "digest@jc.dev", subject: "5 new matches", fromJobCompanion: true }), ctx).keep).toBe(false);
    expect(mail.prefilter(h({ fromAddress: "sam@example.com", subject: "My application" }), ctx).keep).toBe(false);
    expect(mail.prefilter(h({ fromAddress: "news@shop.com", subject: "A great opportunity to save", listId: "<promo.shop.com>" }), ctx).keep).toBe(false);
  });

  it("builds a Gmail query for the first look-back and for later checks", () => {
    expect(mail.gmailQuery({ newerThanDays: 60, companyDomains: ["acme.com"] })).toMatch(/newer_than:60d/);
    const later = mail.gmailQuery({ afterEpochSec: 1_700_000_000, companyDomains: [] });
    expect(later).toMatch(/after:1700000000/);
    expect(later).toMatch(/-category:promotions/);
  });
});

describe("rules classifier and text", () => {
  const e = (subject: string, text: string, from = "no-reply@us.greenhouse-mail.io", fromName = "Acme Recruiting") => email({ subject, text, fromAddress: from, fromName });

  it("recognizes the common kinds, always with low confidence", () => {
    expect(mail.classifyWithRules(e("Thank you for applying to Acme", "We have received your application.")).kind).toBe("application_received");
    expect(mail.classifyWithRules(e("Your application", "Unfortunately we have decided to move forward with other candidates.")).kind).toBe("rejection");
    expect(mail.classifyWithRules(e("Offer", "We are pleased to extend an offer.")).kind).toBe("offer");
    expect(mail.classifyWithRules(e("Next step", "Please complete this HackerRank coding challenge.")).kind).toBe("assessment");
    const req = mail.classifyWithRules(e("Chat with our recruiter", "Could you share your availability for a call with our recruiter?"));
    expect(req).toMatchObject({ kind: "interview_request", round: "recruiter_call", confidence: 0.5, companyName: "Acme" });
    expect(req.action.needed).toBe(true);
    expect(mail.classifyWithRules(e("Weekly newsletter", "Top stories")).kind).toBe("unrelated");
    expect(mail.classifyWithRules(email({ fromAddress: "jobs-noreply@linkedin.com", fromName: "LinkedIn", subject: "Your application was sent to Globex", text: "" })).companyName).toBe("Globex");
  });

  it("names the hiring company, not the vendor", () => {
    expect(mail.companyFromSender("Stripe Recruiting", "no-reply@us.greenhouse-mail.io")).toBe("Stripe");
    expect(mail.companyFromSender("Greenhouse", "no-reply@greenhouse.io")).toBeNull();
    expect(mail.companyFromSender(null, "talent@ramp.com")).toBe("Ramp");
  });

  it("trims quoted replies and collects links", () => {
    expect(mail.stripQuoted("Sounds good!\n\nOn Mon, Sep 1, 2026 at 9:00 AM Jane <j@acme.com> wrote:\n> old stuff")).toBe("Sounds good!");
    expect(mail.extractLinks('<a href="https://jobs.lever.co/acme/a1">job</a>', "see https://acme.com/x.")).toEqual(["https://jobs.lever.co/acme/a1", "https://acme.com/x"]);
  });

  it("matches companies and titles loosely but not wrongly", () => {
    expect(mail.sameCompany("Globex Corporation", "Globex")).toBe(true);
    expect(mail.sameCompany("Block", "Cityblock Health")).toBe(false);
    expect(mail.titleSimilarity("Sr. Software Engineer", "Senior Software Engineer")).toBe(1);
    expect(mail.titleSimilarity("Staff Engineer", "Product Designer")).toBe(0);
    expect(mail.findJobForExternal("Globex", "Senior Product Manager, Payments Risk", null)).toBeNull();
    expect(mail.findJobForExternal("Globex", "Sr. Product Manager", "talent@globex.com")).toBe(globexJob);
  });
});

describe("status rules", () => {
  const e = (kind: EmailClassification["kind"], over: Partial<{ receivedAt: Date; confidence: number; classifiedBy: "llm" | "rules" }> = {}) => ({
    kind,
    receivedAt: new Date(),
    confidence: 0.9,
    classifiedBy: "llm" as const,
    ...over,
  });
  const ctx = { lastManualMove: null, threshold: 0.75 };

  it("only moves forward", () => {
    expect(mail.decide({ status: "applying", confirmedAt: null }, e("application_received"), ctx)).toEqual({ move: "applied", confirm: true, review: null });
    expect(mail.decide({ status: "interview", confirmedAt: null }, e("application_received"), ctx)).toEqual({ move: null, confirm: true, review: null });
    expect(mail.decide({ status: "applied", confirmedAt: null }, e("interview_request"), ctx).move).toBe("interview");
    expect(mail.decide({ status: "offer", confirmedAt: null }, e("interview_update"), ctx).move).toBeNull();
  });

  it("ends applications on rejection, except over an offer, and questions contradictions", () => {
    expect(mail.decide({ status: "interview", confirmedAt: null }, e("rejection"), ctx).move).toBe("rejected");
    expect(mail.decide({ status: "offer", confirmedAt: null }, e("rejection"), ctx).review).toBeTruthy();
    expect(mail.decide({ status: "rejected", confirmedAt: null }, e("interview_request"), ctx).review).toBeTruthy();
    expect(mail.decide({ status: "applied", confirmedAt: null }, e("offer"), ctx).move).toBe("offer");
  });

  it("leaves cards alone when unsure, sorted without AI, or moved by hand afterwards", () => {
    expect(mail.decide({ status: "applied", confirmedAt: null }, e("rejection", { confidence: 0.5 }), ctx).review).toBeTruthy();
    expect(mail.decide({ status: "applied", confirmedAt: null }, e("rejection", { classifiedBy: "rules" }), ctx).review).toBeTruthy();
    const old = new Date(Date.now() - 86_400_000);
    expect(mail.decide({ status: "applied", confirmedAt: null }, e("rejection", { receivedAt: old }), { ...ctx, lastManualMove: new Date() }).move).toBeNull();
    expect(mail.decide({ status: "applied", confirmedAt: null }, e("rejection", { confidence: 0.5 }), { ...ctx, confirmedByPerson: true }).move).toBe("rejected");
  });
});

describe("dates from the classifier", () => {
  it("reads bare dates as end of day and offset-less times in the person's zone", () => {
    expect(mail.parseEmailDate("2026-09-22", "America/New_York")!.toISOString()).toBe("2026-09-23T03:59:00.000Z");
    expect(mail.parseEmailDate("2026-09-24T14:00:00", "America/New_York")!.toISOString()).toBe("2026-09-24T18:00:00.000Z");
    expect(mail.parseEmailDate("2026-09-24T14:00:00-07:00", "America/New_York")!.toISOString()).toBe("2026-09-24T21:00:00.000Z");
    expect(mail.parseEmailDate("2026-12-01", "Not/AZone")!.toISOString()).toBe("2026-12-01T23:59:00.000Z");
    expect(mail.parseEmailDate("soon", "UTC")).toBeNull();
  });
});

describe("rounds", () => {
  it("orders rounds and marks earlier ones done", () => {
    const d = (n: number) => new Date(Date.UTC(2026, 8, n));
    const rounds = mail.roundsFrom(
      [
        { id: 1, kind: "interview_request", round: "recruiter_call", roundLabel: null, eventAt: null, receivedAt: d(1) },
        { id: 2, kind: "interview_scheduled", round: "screening", roundLabel: null, eventAt: d(5), receivedAt: d(3) },
        { id: 3, kind: "interview_request", round: "onsite_virtual", roundLabel: null, eventAt: null, receivedAt: d(8) },
      ],
      d(9),
    );
    expect(rounds.map((r) => [r.round, r.state])).toEqual([
      ["recruiter_call", "done"],
      ["screening", "done"],
      ["onsite_virtual", "scheduling"],
    ]);
  });
});

describe("processing emails into the pipeline", () => {
  it("confirms an application found by its job link and moves it to Applied", () => {
    const a = newApp({ jobId: acmeJob });
    const out = mail.processEmail(conn, email({ links: ["https://jobs.lever.co/acme/a1"] }), cls({ kind: "application_received" }), "llm", mail.trackedApplications(userId));
    expect(out.row?.applicationId).toBe(a.id);
    expect(app(a.id)).toMatchObject({ status: "applied" });
    expect(app(a.id).confirmedAt).toBeTruthy();
    expect(applicationEvents(a.id)[0]).toMatchObject({ source: "email", fromStatus: "applying", toStatus: "applied" });
  });

  it("follows a thread, sorts interview rounds and raises actions", () => {
    const a = mail.trackedApplications(userId).find((x) => x.jobId === acmeJob)!;
    const first = mail.processEmail(
      conn,
      email({ threadId: "thread-acme", subject: "Chat about Staff Engineer" }),
      cls({ kind: "interview_request", round: "recruiter_call", action: { needed: true, type: "schedule", text: "Reply with your availability", dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString() } }),
      "llm",
      mail.trackedApplications(userId),
    );
    expect(first.row?.applicationId).toBe(a.id);
    expect(app(a.id).status).toBe("interview");
    // A reply in the same thread links by thread even without a company name.
    const reply = mail.processEmail(conn, email({ threadId: "thread-acme", fromAddress: "jane@gmail.com", fromName: "Jane" }), cls({ kind: "interview_scheduled", round: "recruiter_call", companyName: null, jobTitle: null, eventAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }), "llm", mail.trackedApplications(userId));
    expect(reply.row?.applicationId).toBe(a.id);
    const actions = mail.openActions(userId);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ company: "Acme", actionText: "Reply with your availability", searchId });
    const card = mail.mailForCards(userId, [a.id]).get(a.id)!;
    expect(card).toMatchObject({ emailCount: 3, openActions: 1 });
    expect(card.rounds[0]).toMatchObject({ round: "recruiter_call", state: "scheduled" });

    // The next round makes the recruiter-call request moot.
    mail.processEmail(conn, email({ threadId: "thread-acme-2", receivedAt: new Date() }), cls({ kind: "interview_scheduled", round: "screening" }), "llm", mail.trackedApplications(userId));
    expect(mail.openActions(userId).some((x) => x.emailId === first.row!.id)).toBe(false);
  });

  it("adds applications made elsewhere, linked to the job when it's known", () => {
    const out = mail.processEmail(
      conn,
      email({ fromAddress: "no-reply@us.greenhouse-mail.io", fromName: "Globex Recruiting" }),
      cls({ kind: "application_received", companyName: "Globex", jobTitle: "Sr Product Manager" }),
      "llm",
      mail.trackedApplications(userId),
    );
    expect(out.created).toMatchObject({ jobId: globexJob, status: "applied" });
    const row = app(out.created!.id);
    expect(row).toMatchObject({ source: "email", searchId: pmSearchId });
    expect(row.confirmedAt).toBeTruthy();

    const unknown = mail.processEmail(conn, email({ fromAddress: "careers@initech.com", fromName: "Initech" }), cls({ kind: "rejection", companyName: "Initech", jobTitle: "Staff Engineer" }), "llm", mail.trackedApplications(userId));
    expect(unknown.created).toMatchObject({ jobId: null, status: "rejected", company: "Initech" });
    expect(app(unknown.created!.id)).toMatchObject({ searchId, jobTitle: "Staff Engineer" });
  });

  it("keeps different roles at the same company apart", () => {
    const product = newApp({ companyName: "Initrode", jobTitle: "Staff Software Engineer, Product Engineering", source: "manual", status: "applied" });
    // A confirmation naming a different role doesn't join that card; it waits to be checked.
    const other = mail.processEmail(
      conn,
      email({ fromAddress: "no-reply@initrode.com", threadId: "t-initrode-ai" }),
      cls({ kind: "application_received", companyName: "Initrode", jobTitle: "Staff Software Engineer, AI Platform" }),
      "llm",
      mail.trackedApplications(userId),
    );
    expect(other.row?.reviewState).toBe("needs_review");
    expect(other.row?.applicationId).toBeNull();
    expect(app(product.id).confirmedAt).toBeNull();

    // The same role, worded a little differently, still links on its own.
    const same = mail.processEmail(
      conn,
      email({ fromAddress: "no-reply@initrode.com", threadId: "t-initrode-product" }),
      cls({ kind: "application_received", companyName: "Initrode", jobTitle: "Product Engineering, Staff Software Engineer" }),
      "llm",
      mail.trackedApplications(userId),
    );
    expect(same.row?.applicationId).toBe(product.id);
    expect(app(product.id).confirmedAt).toBeTruthy();

    // And a reply in a thread that's already linked never re-asks.
    const reply = mail.processEmail(
      conn,
      email({ fromAddress: "recruiter@initrode.com", threadId: "t-initrode-product" }),
      cls({ kind: "interview_request", round: "recruiter_call", companyName: "Initrode", jobTitle: null }),
      "llm",
      mail.trackedApplications(userId),
    );
    expect(reply.row?.applicationId).toBe(product.id);
  });

  it("asks when it isn't sure, and acts once the person confirms", () => {
    const b1 = newApp({ companyName: "Hooli", jobTitle: "Backend Engineer", source: "manual", status: "applied" });
    newApp({ companyName: "Hooli", jobTitle: "Frontend Engineer", source: "manual", status: "applied" });
    const amb = mail.processEmail(conn, email({ fromAddress: "hr@hooli.xyz" }), cls({ kind: "rejection", companyName: "Hooli", jobTitle: null }), "llm", mail.trackedApplications(userId));
    expect(amb.row?.reviewState).toBe("needs_review");
    expect(mail.reviewQueue(userId).map((r) => r.emailId)).toContain(amb.row!.id);
    expect(mail.reviewEmail(userId, amb.row!.id, { type: "assign", applicationId: b1.id })).toBe(true);
    expect(app(b1.id).status).toBe("rejected");
    expect(mail.reviewQueue(userId).map((r) => r.emailId)).not.toContain(amb.row!.id);

    const unsure = mail.processEmail(conn, email({ fromAddress: "x@acme.com" }), cls({ kind: "offer", confidence: 0.4 }), "llm", mail.trackedApplications(userId));
    expect(unsure.row?.reviewState).toBe("needs_review");
    const acme = mail.trackedApplications(userId).find((x) => x.jobId === acmeJob)!;
    expect(app(acme.id).status).toBe("interview");
    mail.reviewEmail(userId, unsure.row!.id, { type: "confirm" });
    expect(app(acme.id).status).toBe("offer");
  });

  it("lets a manual move win and undo an automatic one", () => {
    const a = newApp({ companyName: "Umbrella", jobTitle: "Platform Engineer", status: "applied" });
    setStatus(a.id, "interview", { source: "manual" });
    const old = mail.processEmail(conn, email({ fromAddress: "x@umbrella.com", receivedAt: new Date(Date.now() - 3 * 86_400_000) }), cls({ kind: "rejection", companyName: "Umbrella", jobTitle: "Platform Engineer" }), "llm", mail.trackedApplications(userId));
    expect(old.row?.applicationId).toBe(a.id);
    expect(app(a.id).status).toBe("interview");

    mail.processEmail(conn, email({ fromAddress: "x@umbrella.com", receivedAt: new Date(Date.now() + 60_000) }), cls({ kind: "rejection", companyName: "Umbrella", jobTitle: "Platform Engineer" }), "llm", mail.trackedApplications(userId));
    expect(app(a.id).status).toBe("rejected");
    const ev = applicationEvents(a.id)[0]!;
    expect(undoEvent(userId, ev.id)).toEqual({ ok: true });
    expect(app(a.id).status).toBe("interview");
    expect(undoEvent(otherId, ev.id).ok).toBe(false);
  });

  it("removes an application an email added when that's undone", () => {
    const out = mail.processEmail(conn, email({ fromAddress: "x@vandelay.com" }), cls({ kind: "application_received", companyName: "Vandelay", jobTitle: "Importer" }), "llm", mail.trackedApplications(userId));
    const created = applicationEvents(out.created!.id)[0]!;
    expect(created.fromStatus).toBeNull();
    expect(undoEvent(userId, created.id)).toMatchObject({ ok: true, removed: true });
    expect(getDb().select().from(schema.application).where(eq(schema.application.id, out.created!.id)).get()).toBeUndefined();
  });

  it("keeps only ids for unrelated mail, and keeps people's email apart", () => {
    const out = mail.processEmail(conn, email({ subject: "Sale", text: "50% off" }), cls({ jobRelated: false, kind: "unrelated" }), "llm", []);
    expect(out.row).toBeNull();
    const stored = getDb().select().from(schema.emailMessage).where(eq(schema.emailMessage.providerId, `m${seq}`)).get()!;
    expect(stored).toMatchObject({ kind: "unrelated", subject: null, snippet: null, fromAddress: null });

    const theirs = mail.processEmail(otherConn, email({ fromAddress: "x@acme.com", actionNeeded: undefined } as never), cls({ kind: "interview_request", action: { needed: true, type: "reply", text: "Reply", dueAt: null } }), "llm", mail.trackedApplications(otherId));
    expect(mail.openActions(userId).some((a) => a.emailId === theirs.row?.id)).toBe(false);
    expect(mail.reviewQueue(userId).some((r) => r.emailId === theirs.row?.id)).toBe(false);
    expect(mail.reviewEmail(userId, theirs.row!.id, { type: "dismiss" })).toBe(false);
  });
});

describe("secrets", () => {
  it("round-trips, and a changed key or tampering fails", () => {
    const sealed = encryptSecret("refresh-token");
    expect(sealed).not.toContain("refresh-token");
    expect(decryptSecret(sealed)).toBe("refresh-token");
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join("."))).toThrow();
    process.env.SECRET_KEY = "another-key";
    resetSecretKeyCache();
    expect(() => decryptSecret(sealed)).toThrow();
    process.env.SECRET_KEY = "test-secret-key-for-mail-sync";
    resetSecretKeyCache();
  });
});

describe("IMAP is read-only", () => {
  it("opens folders with EXAMINE and never calls anything that changes the mailbox", async () => {
    const called: string[] = [];
    const locks: { path: string; readOnly?: boolean }[] = [];
    const raw = Buffer.from("From: Acme <jobs@acme.com>\r\nSubject: Thanks for applying\r\nMessage-ID: <x1@acme.com>\r\n\r\nWe received your application.");
    const fake = {
      mailbox: { uidValidity: 7n, uidNext: 3 },
      connect: async () => undefined,
      list: async () => [{ path: "INBOX" }, { path: "Archive", specialUse: "\\Archive" }, { path: "Trash", specialUse: "\\Trash" }],
      getMailboxLock: async (p: string, o: { readOnly?: boolean }) => (locks.push({ path: p, readOnly: o?.readOnly }), { path: p, release: () => undefined }),
      search: async () => [1, 2],
      fetchAll: async (uids: number[]) =>
        uids.map((uid) => ({ uid, seq: uid, envelope: { from: [{ name: "Acme", address: "jobs@acme.com" }], subject: "Thanks for applying" }, internalDate: new Date(), headers: Buffer.from("") })),
      fetchOne: async () => ({ uid: 1, seq: 1, source: raw }),
      logout: async () => undefined,
      close: () => undefined,
    };
    const spy = new Proxy(fake, {
      get(target, prop: string) {
        called.push(prop);
        return (target as Record<string, unknown>)[prop];
      },
    });
    mail.setHostCheck(async () => undefined);
    mail.setImapFactory(() => spy as never);
    const imapConn = { ...conn, imapHost: "imap.example.com", cursor: {} };
    const { imapSource } = await import("../src/imap");
    const src = imapSource(imapConn, "pw", { save: () => undefined });
    const headers = await src.listHeaders();
    expect(headers).toHaveLength(4); // two folders, two messages each
    expect(headers[0]!.providerId).toBe("INBOX:7:1");
    const full = await src.fetchEmail(headers[0]!);
    expect(full?.text).toContain("received your application");
    await src.close();
    expect(locks.every((l) => l.readOnly === true)).toBe(true);
    expect(locks.map((l) => l.path)).not.toContain("Trash");
    const forbidden = ["messageFlagsAdd", "messageFlagsSet", "messageFlagsRemove", "messageDelete", "messageMove", "messageCopy", "append", "mailboxCreate", "mailboxDelete", "mailboxRename", "mailboxOpen", "setFlagColor"];
    expect(called.filter((c) => forbidden.includes(c))).toEqual([]);
  });

  it("refuses private and odd server addresses", async () => {
    await expect(mail.assertPublicMailHost("localhost", 993)).rejects.toThrow();
    await expect(mail.assertPublicMailHost("127.0.0.1", 993)).rejects.toThrow();
    await expect(mail.assertPublicMailHost("imap.example.com", 25)).rejects.toThrow(/993/);
  });
});

describe("Gmail", () => {
  it("accepts only read-only scopes", () => {
    expect(() => mail.checkGrantedScopes(`openid ${mail.GMAIL_READONLY} https://www.googleapis.com/auth/userinfo.email`)).not.toThrow();
    expect(() => mail.checkGrantedScopes("openid email")).toThrow(/wasn't granted/);
    expect(() => mail.checkGrantedScopes(`${mail.GMAIL_READONLY} https://www.googleapis.com/auth/gmail.modify`)).toThrow(/more access/);
  });

  it("links to the exact thread, in the right account", () => {
    expect(mail.gmailThreadLink("sam@gmail.com", "18c2f")).toBe("https://mail.google.com/mail/?authuser=sam%40gmail.com#all/18c2f");
    expect(mail.gmailThreadHex("1786012345678901234")).toBe(BigInt("1786012345678901234").toString(16));
  });

  it("parses messages and turns an expired grant into a reconnect", async () => {
    const { gmailEmail, GmailApi } = await import("../src/gmail");
    const b64 = (s: string) => Buffer.from(s).toString("base64url");
    const parsed = gmailEmail({
      id: "abc",
      threadId: "t1",
      internalDate: String(Date.UTC(2026, 8, 1)),
      payload: {
        headers: [
          { name: "From", value: "Globex Talent <talent@globex.com>" },
          { name: "Subject", value: "Interview availability" },
          { name: "Message-ID", value: "<g1@globex.com>" },
        ],
        parts: [
          { mimeType: "text/plain", body: { data: b64("Can you share your availability?\n\nOn Mon Jane wrote:\n> hi") } },
          { mimeType: "text/html", body: { data: b64('<p>Apply at <a href="https://job-boards.greenhouse.io/globex/jobs/4001">here</a></p>') } },
        ],
      },
    });
    expect(parsed).toMatchObject({ fromAddress: "talent@globex.com", fromName: "Globex Talent", subject: "Interview availability", text: "Can you share your availability?" });
    expect(parsed.links).toContain("https://job-boards.greenhouse.io/globex/jobs/4001");

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await expect(new GmailApi("token").profile()).rejects.toBeInstanceOf(mail.ReauthRequiredError);
    globalThis.fetch = realFetch;
  });
});

describe("a full check", () => {
  it("reads a mailbox oldest first, updates the pipeline, and skips what it has seen", async () => {
    const eml = (name: string, from: string, subject: string, body: string, date: string, extra = "") =>
      fs.writeFileSync(path.join(fakeDir, name), `From: ${from}\r\nTo: sam@example.com\r\nSubject: ${subject}\r\nDate: ${date}\r\nMessage-ID: <${name}@x>\r\n${extra}\r\n${body}\r\n`);
    eml("1.eml", "Soylent Recruiting <no-reply@us.greenhouse-mail.io>", "Thank you for applying to Soylent", "We received your application for Staff Engineer.", "Mon, 7 Sep 2026 10:00:00 +0000", "X-Thread-Id: s1\r\n");
    eml("2.eml", "Soylent Recruiting <no-reply@us.greenhouse-mail.io>", "Update on your application", "Unfortunately we will not be moving forward.", "Thu, 10 Sep 2026 10:00:00 +0000", "X-Thread-Id: s1\r\n");
    eml("3.eml", "Shop <news@shop.com>", "Big sale", "Everything must go", "Fri, 11 Sep 2026 10:00:00 +0000", "List-Id: <promo.shop.com>\r\n");
    eml("4.eml", "Job Companion <digest@jc.dev>", "3 new matches", "Jobs", "Fri, 11 Sep 2026 11:00:00 +0000", "X-Job-Companion: digest\r\n");

    const fakeConn = getDb().insert(schema.mailboxConnection).values({ userId, provider: "imap", address: "sam+fake@example.com", secret: encryptSecret("x"), imapHost: "fake.local", imapPort: 993 }).returning().get();
    parseQueue.push(
      cls({ kind: "application_received", companyName: "Soylent", jobTitle: "Staff Engineer" }),
      cls({ kind: "rejection", companyName: "Soylent", jobTitle: "Staff Engineer" }),
    );
    calls.length = 0;
    const summary = await mail.syncConnection(fakeConn.id);
    expect(summary).toMatchObject({ listed: 4, candidates: 2, processed: 2, jobEmails: 2, created: 1 });
    expect(calls).toHaveLength(2); // the sale and our own digest never reached the AI
    expect(String(calls[0]!.messages[0]!.content)).toContain("Thank you for applying to Soylent");
    const soylent = mail.trackedApplications(userId).find((a) => a.company === "Soylent")!;
    expect(soylent.status).toBe("rejected");
    const after = getDb().select().from(schema.mailboxConnection).where(eq(schema.mailboxConnection.id, fakeConn.id)).get()!;
    expect(after).toMatchObject({ backfillDone: true, progress: null, lastError: null, status: "active" });

    const again = await mail.syncConnection(fakeConn.id);
    expect(again).toMatchObject({ candidates: 0, processed: 0 });
  });
});
