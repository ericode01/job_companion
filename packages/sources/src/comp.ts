import type { Comp } from "@jd/core";

function toNumber(raw: string, suffix: string | undefined): number {
  const n = Number(raw.replace(/,/g, ""));
  return suffix && /k/i.test(suffix) ? n * 1000 : n;
}

/**
 * Pulls a USD salary range out of free text, e.g. "$230,000 - $280,000" or "$211.4K – $290.6K".
 * Returns the widest annual range found; ignores hourly-looking ranges under $1k.
 */
export function parseCompFromText(text: string): Comp | null {
  const re = /\$\s?(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d+)?)\s?([kK])?\s*(?:-|–|—|to)\s*\$?\s?(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d+)?)\s?([kK])?/g;
  let best: Comp | null = null;
  for (const m of text.matchAll(re)) {
    const min = toNumber(m[1]!, m[2] ?? m[4]);
    const max = toNumber(m[3]!, m[4] ?? m[2]);
    if (min < 20_000 || max < min || max > 5_000_000) continue;
    if (!best || max - min > (best.max ?? 0) - (best.min ?? 0)) {
      best = { min, max, currency: "USD", interval: "year" };
    }
  }
  return best;
}
