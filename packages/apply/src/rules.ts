/**
 * Deterministic question rules. Browser-safe (no DB): the extension reuses option matching.
 */

export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(required\)|\*|✱/g, " ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EEO = /\b(gender|sex\b|race|racial|ethnicity|ethnic|hispanic|latin[oax]|veteran|disabilit|sexual orientation|transgender|lgbt)/i;
const CONSENT =
  /\b(i agree|agree to|consent|acknowledge|privacy (policy|notice|statement)|terms (of|and)|i certify|certify that|attest|i understand|by (selecting|checking|submitting)|accurate and complete|share my (resume|information|data))/i;

/**
 * The two recurring questions phrased a hundred ways. Deliberately narrow: inverted wordings
 * ("…without sponsorship?", "…not require…") return null so they're never answered backwards.
 */
export function standardCategoryOf(label: string): "work_auth" | "sponsorship" | null {
  const l = label.toLowerCase();
  if (/\b(without|not|no longer)\b/.test(l)) return null;
  if (/\b(require|need)\b[^?]*\bsponsor/.test(l) || /\bsponsor(ship)?\b[^?]*\b(require|need)/.test(l)) return "sponsorship";
  if (/(legally )?authori[sz]ed to work|legally (able|eligible|permitted) to work|eligible to work|right to work/.test(l)) return "work_auth";
  return null;
}

/** Consent can hide in the options ("Phone" → "Yes - I consent to receiving text messages"). */
export function isConsentField(label: string, options: string[]): boolean {
  return isConsentQuestion(label) || options.some((o) => /\bconsent\b|\bi agree\b|\bopt[ -]?in\b/i.test(o));
}

export function isEeoQuestion(label: string): boolean {
  return EEO.test(label);
}

export function isConsentQuestion(label: string): boolean {
  return CONSENT.test(label);
}

const DECLINE = /decline|don.?t wish|do not wish|prefer not|not to (say|answer|disclose|self)|choose not|rather not|do not want|not wish to|i don.?t want/i;

/** Picks option strings for an answer. Returns [] when nothing matches confidently. */
export function pickOptions(answer: string, options: string[]): string[] {
  if (options.length === 0) return [];
  const a = answer.trim().toLowerCase();
  const exact = options.find((o) => o.trim().toLowerCase() === a);
  if (exact) return [exact];
  if (DECLINE.test(a)) {
    const d = options.find((o) => DECLINE.test(o));
    return d ? [d] : [];
  }
  const yes = /^(yes|y|true)\b/.test(a);
  const no = /^(no|n|false)\b/.test(a);
  if (yes || no) {
    const hit = options.find((o) => (yes ? /^\s*yes\b/i : /^\s*no\b/i).test(o));
    return hit ? [hit] : [];
  }
  const starts = options.filter((o) => o.trim().toLowerCase().startsWith(a) || a.startsWith(o.trim().toLowerCase()));
  if (starts.length === 1) return starts;
  // "United States" vs ["United States +1", "United States Minor Outlying Islands +1"]: prefer the option
  // whose only extra text is non-letters (dial codes, punctuation).
  const decorated = starts.filter((o) => !/[a-z]/i.test(o.trim().slice(a.length)));
  return decorated.length === 1 ? decorated : [];
}

export const DEFAULT_DECLINE = "Decline to self-identify";
