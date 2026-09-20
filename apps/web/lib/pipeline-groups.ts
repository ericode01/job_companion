import type { PipelineCard } from "@/lib/pipeline-types";

/**
 * A long column is only useful if it says who's gone quiet, so columns are grouped by how long
 * it's been since anything happened. Short columns aren't grouped: headers over two cards are noise.
 */

export const GROUP_AT = 6;
const WEEK = 7 * 86_400_000;
const THREE_WEEKS = 21 * 86_400_000;

export type Bucket = "fresh" | "waiting" | "quiet";

/** Waiting on them (Applied, Interview, Offer) reads differently from waiting on you. */
const LABELS: Record<"theirs" | "yours", Record<Bucket, string>> = {
  theirs: { fresh: "Heard back this week", waiting: "Waiting 1–3 weeks", quiet: "Silent 3+ weeks" },
  yours: { fresh: "Added this week", waiting: "1–3 weeks old", quiet: "Stalled 3+ weeks" },
};

const WAITING_ON_THEM = new Set(["applied", "interview", "offer"]);

/** The last thing that happened: an email if there is one, else when you applied or touched it. */
export function lastActivity(card: Pick<PipelineCard, "lastEmailAt" | "appliedAt" | "updatedAt">): number {
  return Date.parse(card.lastEmailAt ?? card.appliedAt ?? card.updatedAt);
}

export function bucketOf(card: Pick<PipelineCard, "lastEmailAt" | "appliedAt" | "updatedAt">, now = Date.now()): Bucket {
  const age = now - lastActivity(card);
  if (age <= WEEK) return "fresh";
  return age <= THREE_WEEKS ? "waiting" : "quiet";
}

export function groupLabel(columnKey: string, bucket: Bucket): string {
  return LABELS[WAITING_ON_THEM.has(columnKey) ? "theirs" : "yours"][bucket];
}

export interface CardGroup {
  bucket: Bucket;
  /** Null when the column is too short to be worth grouping. */
  label: string | null;
  cards: PipelineCard[];
}

/** Needs-your-reply first, then whatever happened most recently. */
function byUrgency(a: PipelineCard, b: PipelineCard): number {
  return (b.openActions > 0 ? 1 : 0) - (a.openActions > 0 ? 1 : 0) || lastActivity(b) - lastActivity(a);
}

/**
 * A column's cards, sorted, and split into age groups once there are enough of them to scroll.
 * `grouped: false` (the Rejected column) keeps one plain list.
 */
export function groupColumn(columnKey: string, cards: PipelineCard[], opts: { grouped?: boolean; now?: number } = {}): CardGroup[] {
  const sorted = [...cards].sort(byUrgency);
  if (opts.grouped === false || sorted.length < GROUP_AT) return sorted.length ? [{ bucket: "fresh", label: null, cards: sorted }] : [];
  const now = opts.now ?? Date.now();
  const buckets: Bucket[] = ["fresh", "waiting", "quiet"];
  return buckets
    .map((bucket) => ({ bucket, label: groupLabel(columnKey, bucket), cards: sorted.filter((c) => bucketOf(c, now) === bucket) }))
    .filter((g) => g.cards.length > 0);
}
