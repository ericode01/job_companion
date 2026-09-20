import crypto from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";

export function sha1(value: unknown): string {
  return crypto.createHash("sha1").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export class NonRetryableError extends Error {}

/** Throws if the model refused or ran out of tokens, so callers never store partial output. */
export function assertUsableStop(message: Anthropic.Message, what: string): void {
  if (message.stop_reason === "refusal") throw new NonRetryableError(`Claude declined to ${what}.`);
  if (message.stop_reason === "max_tokens") throw new NonRetryableError(`Claude ran out of output tokens while trying to ${what}.`);
}

const NUMBER_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|dozens?|hundreds?|thousands?|millions?";

const normalizeNumbers = (s: string) => s.toLowerCase().replace(/[,\s]/g, "");

/**
 * Numbers and counted phrases ("six years", "200+", "40%") in generated text that don't appear in the
 * source facts. Used to catch invented tenure and metrics.
 *
 * Bare single- and double-digit numbers ("Tier 0", "3 engineers") are ignored: they're everywhere in
 * ordinary prose and produced false alarms.
 */
export function unsupportedClaims(text: string, facts: string): string[] {
  const haystack = normalizeNumbers(facts);
  const found = new Set<string>();
  for (const m of text.matchAll(/\$?\d[\d,]*(?:\.\d+)?\s?(?:%|\+|x\b|k\b|m\b|b\b|bn\b)?/gi)) {
    const token = m[0].trim().replace(/[.,]$/, "");
    const normalized = normalizeNumbers(token).replace(/^\$/, "");
    const digits = normalized.replace(/[%+xkmbn]+$/, "");
    const hasSuffix = digits !== normalized;
    if (!digits) continue;
    if (!hasSuffix && Number(digits) < 10) continue;
    const escaped = digits.replace(/\./g, "\\.");
    const groundedExact = haystack.includes(normalized);
    // Whole-number match: "200" must not count as supported because "2008" appears.
    const groundedDigits = new RegExp(`(^|[^\\d.])${escaped}([^\\d]|$)`).test(haystack);
    if (!groundedExact && !groundedDigits) found.add(token);
  }
  for (const m of text.matchAll(new RegExp(`\\b(?:${NUMBER_WORDS})\\s+(?:years?|months?|people|engineers|teams?|countries|data ?centers|customers|users)\\b`, "gi"))) {
    if (!haystack.includes(normalizeNumbers(m[0]))) found.add(m[0]);
  }
  return [...found];
}

export function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
