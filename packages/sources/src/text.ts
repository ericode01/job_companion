import { decodeHTML } from "entities";

/** Greenhouse double-encodes HTML; decode entities until stable (max 2 passes). */
export function decodeHtmlEntities(s: string): string {
  const once = decodeHTML(s);
  return once.includes("&lt;") || once.includes("&amp;") ? decodeHTML(once) : once;
}

export function htmlToText(html: string): string {
  return decodeHTML(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|ul|ol|tr)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#/ ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function prettifySlug(slug: string): string {
  const spaced = /[-_\s]/.test(slug)
    ? slug.replace(/[-_]+/g, " ")
    : // camelCase board slugs ("BoschGroup") are common on SmartRecruiters.
      slug.replace(/([a-z\d])([A-Z])/g, "$1 $2");
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}
