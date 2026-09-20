import type { Comp } from "@jd/core/shared";

export function formatComp(comp: Comp | null | undefined): string | null {
  if (!comp || (comp.min === null && comp.max === null)) return null;
  const cur = !comp.currency || comp.currency === "USD" ? "$" : `${comp.currency} `;
  if (comp.interval === "hour") return `${cur}${comp.min ?? "?"}–${comp.max ?? "?"}/hr`;
  const k = (n: number | null) => (n === null ? "?" : `${Math.round(n / 1000)}k`);
  return comp.min === comp.max || comp.max === null ? `${cur}${k(comp.min)}` : `${cur}${k(comp.min)}–${k(comp.max)}`;
}

export function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "date unknown";
  const d = typeof date === "string" ? new Date(date) : date;
  const ms = Date.now() - d.getTime();
  // "Checked 12 minutes ago" answers "is this still working?"; "today" doesn't.
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) {
    const mins = Math.floor(ms / 60_000);
    return mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
  }
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) {
    const hours = Math.floor(ms / 3_600_000);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

/** "$1.77B" beats "1770000000". Only money facts, so a headcount stays a headcount. */
const MONEY_FACT = /funding|round|valuation|revenue|raised|arr/i;

export function formatFactValue(label: string, value: string): string {
  if (!MONEY_FACT.test(label)) return value;
  return value.replace(/\$?\b\d[\d,]{5,}\b/g, (match) => {
    const n = Number(match.replace(/[$,]/g, ""));
    if (!Number.isFinite(n)) return match;
    if (n >= 1e9) return `$${Number((n / 1e9).toFixed(2))}B`;
    if (n >= 1e6) return `$${Number((n / 1e6).toFixed(1))}M`;
    return `$${Math.round(n / 1000)}k`;
  });
}
