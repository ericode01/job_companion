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
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}
