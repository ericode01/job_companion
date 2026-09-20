import { htmlToText } from "@jd/sources";

const MAX_TEXT = 6000;

/** Links in an HTML or text body, deduped, tracking redirects left as they are. */
export function extractLinks(html: string | null, text: string | null): string[] {
  const out = new Set<string>();
  for (const m of (html ?? "").matchAll(/href\s*=\s*["']([^"']+)["']/gi)) if (/^https?:/i.test(m[1]!)) out.add(m[1]!);
  for (const m of (text ?? "").matchAll(/https?:\/\/[^\s<>()"']+/gi)) out.add(m[0].replace(/[.,;:!?]+$/, ""));
  return [...out].slice(0, 80);
}

/** Drops the quoted thread under "On … wrote:" and ">" lines, so a reply is judged on what's new. */
export function stripQuoted(text: string): string {
  const lines = text.split("\n");
  const cut = lines.findIndex(
    (l, i) =>
      /^On .{6,200}wrote:\s*$/.test(l.trim()) ||
      (/^-{2,}\s*Original Message\s*-{2,}/i.test(l.trim()) && i > 0) ||
      (/^From: .+/.test(l.trim()) && i > 2 && /^(Sent|Date): /.test(lines[i + 1]?.trim() ?? "")),
  );
  return (cut > 0 ? lines.slice(0, cut) : lines).filter((l) => !l.startsWith(">")).join("\n").trim();
}

export function bodyText(html: string | null, text: string | null): string {
  const plain = text?.trim() ? text : html ? htmlToText(html) : "";
  return stripQuoted(plain.replace(/\r\n/g, "\n")).slice(0, MAX_TEXT);
}

/** The short preview kept with a job email (the rest of the body is never stored). */
export function snippetOf(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

/** "Stripe Recruiting <no-reply@stripe.com>" → { name, address } */
export function parseAddress(raw: string | null | undefined): { name: string | null; address: string | null } {
  if (!raw) return { name: null, address: null };
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1]!.trim() || null, address: m[2]!.trim().toLowerCase() };
  return { name: null, address: raw.trim().toLowerCase() };
}
