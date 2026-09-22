import { describe, expect, it } from "vitest";
import type { PipelineCard } from "../lib/pipeline-types";
import { formatFactValue } from "../lib/format";
import { bucketOf, foldKey, GROUP_AT, groupColumn, groupLabel, missingConfirmation, needsReplyCount, parseFolded } from "../lib/pipeline-groups";

const NOW = Date.parse("2026-09-19T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function card(id: number, over: Partial<PipelineCard> = {}): PipelineCard {
  return {
    id,
    jobId: null,
    searchId: 1,
    status: "applied",
    source: "app",
    title: `Role ${id}`,
    companyName: `Company ${id}`,
    locations: [],
    comp: null,
    closedAt: null,
    updatedAt: daysAgo(1),
    appliedAt: null,
    confirmedAt: null,
    jobUrl: null,
    fitScore: null,
    emailCount: 0,
    openActions: 0,
    rounds: [],
    lastEmailAt: null,
    ...over,
  };
}

describe("pipeline grouping", () => {
  it("buckets by the last thing that happened, email first", () => {
    expect(bucketOf(card(1, { lastEmailAt: daysAgo(0) }), NOW)).toBe("fresh");
    expect(bucketOf(card(2, { lastEmailAt: daysAgo(7) }), NOW)).toBe("fresh");
    expect(bucketOf(card(3, { lastEmailAt: daysAgo(8) }), NOW)).toBe("waiting");
    expect(bucketOf(card(4, { lastEmailAt: daysAgo(21) }), NOW)).toBe("waiting");
    expect(bucketOf(card(5, { lastEmailAt: daysAgo(22) }), NOW)).toBe("quiet");
    // No email: when you applied, else when the card last changed.
    expect(bucketOf(card(6, { appliedAt: daysAgo(30), updatedAt: daysAgo(1) }), NOW)).toBe("quiet");
    expect(bucketOf(card(7, { updatedAt: daysAgo(2) }), NOW)).toBe("fresh");
  });

  it("names the wait after who it's on", () => {
    expect(groupLabel("applied", "quiet")).toBe("Silent 3+ weeks");
    expect(groupLabel("interview", "fresh")).toBe("Heard back this week");
    expect(groupLabel("applying", "quiet")).toBe("Stalled 3+ weeks");
    expect(groupLabel("saved", "fresh")).toBe("Added this week");
  });

  it("leaves a short column ungrouped", () => {
    const cards = Array.from({ length: GROUP_AT - 1 }, (_, i) => card(i, { lastEmailAt: daysAgo(i * 10) }));
    const groups = groupColumn("applied", cards, { now: NOW });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBeNull();
    expect(groups[0]!.cards).toHaveLength(GROUP_AT - 1);
  });

  it("splits a long column into the ages that hold cards", () => {
    const cards = [...Array.from({ length: 5 }, (_, i) => card(i, { lastEmailAt: daysAgo(1) })), card(99, { lastEmailAt: daysAgo(40) })];
    const groups = groupColumn("applied", cards, { now: NOW });
    expect(groups.map((g) => g.bucket)).toEqual(["fresh", "quiet"]);
    expect(groups.map((g) => g.label)).toEqual(["Heard back this week", "Silent 3+ weeks"]);
    expect(groups[1]!.cards.map((c) => c.id)).toEqual([99]);
  });

  it("puts what needs a reply first, then the most recent", () => {
    const cards = [card(1, { lastEmailAt: daysAgo(1) }), card(2, { lastEmailAt: daysAgo(3), openActions: 1 }), card(3, { lastEmailAt: daysAgo(2) })];
    expect(groupColumn("applied", cards, { now: NOW })[0]!.cards.map((c) => c.id)).toEqual([2, 1, 3]);
  });

  it("never groups the rejected column", () => {
    const cards = Array.from({ length: 12 }, (_, i) => card(i, { status: "rejected", lastEmailAt: daysAgo(i * 5) }));
    const groups = groupColumn("rejected", cards, { grouped: false, now: NOW });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBeNull();
  });

  it("has nothing to show for an empty column", () => {
    expect(groupColumn("offer", [], { now: NOW })).toEqual([]);
  });
});

describe("fact formatting", () => {
  it("makes money readable and leaves everything else alone", () => {
    expect(formatFactValue("Total funding", "1770000000")).toBe("$1.77B");
    expect(formatFactValue("Last round", "550000000 at 15.5 billion valuation in September 2026")).toBe("$550M at 15.5 billion valuation in September 2026");
    expect(formatFactValue("Total funding", "$1,770,000,000")).toBe("$1.77B");
    // Not a money fact: a headcount stays a headcount, and so do years.
    expect(formatFactValue("Headcount", "1705")).toBe("1705");
    expect(formatFactValue("Headcount", "110000")).toBe("110000");
    expect(formatFactValue("Total funding", "Undisclosed, founded 2022")).toBe("Undisclosed, founded 2022");
  });
});

describe("folding date groups", () => {
  it("remembers folds by column and group, and shrugs off storage it can't read", () => {
    expect(foldKey("applied", "quiet")).toBe("applied:quiet");
    expect([...parseFolded(JSON.stringify(["applied:quiet", "applying:waiting"]))]).toEqual(["applied:quiet", "applying:waiting"]);
    expect(parseFolded(null).size).toBe(0);
    expect(parseFolded("").size).toBe(0);
    expect(parseFolded("{not json").size).toBe(0);
    expect(parseFolded(JSON.stringify({ applied: true })).size).toBe(0);
    expect([...parseFolded(JSON.stringify(["applied:quiet", 3, null]))]).toEqual(["applied:quiet"]);
  });

  it("counts what a folded group is hiding that needs a reply", () => {
    expect(needsReplyCount([card(1, { openActions: 2 }), card(2), card(3, { openActions: 1 })])).toBe(2);
    expect(needsReplyCount([])).toBe(0);
  });
});

describe("flagging an application nothing was heard about", () => {
  const mailbox = { connected: true, needsReauth: false };
  const silent = (over: Partial<PipelineCard> = {}) => card(1, { status: "applied", appliedAt: daysAgo(8), ...over });
  const flagged = (over: Partial<PipelineCard> = {}, box = mailbox) => missingConfirmation(silent(over), box, NOW);

  it("flags a week of silence on something you sent", () => {
    expect(flagged()).toBe(true);
  });

  it("stays quiet while anything explains the silence", () => {
    expect(flagged({ appliedAt: daysAgo(3) })).toBe(false); // confirmations arrive in minutes
    expect(flagged({ confirmedAt: daysAgo(7) })).toBe(false);
    expect(flagged({ emailCount: 1 })).toBe(false); // heard something, so it arrived
    expect(flagged({ status: "interview" })).toBe(false); // an invitation proves it arrived
    expect(flagged({ status: "applying" })).toBe(false); // not sent yet
    expect(flagged({ source: "email" })).toBe(false); // found in email: there is mail about it
    expect(flagged({ appliedAt: null })).toBe(false);
    expect(flagged({}, { connected: false, needsReauth: false })).toBe(false); // nothing to hear from
    expect(flagged({}, { connected: true, needsReauth: true })).toBe(false); // sync is stale
  });
});
