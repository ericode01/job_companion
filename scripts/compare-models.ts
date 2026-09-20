/**
 * Re-scores jobs you have already scored, on a candidate model, and reports how far it drifts.
 * Nothing is written: the stored scores are the thing being compared against.
 *
 *   pnpm tsx scripts/compare-models.ts --model openrouter:deepseek/deepseek-v4-flash --n 20
 *   pnpm tsx scripts/compare-models.ts --model openrouter:openrouter/auto --n 10
 *
 * Fit scores are ranked against each other, so what matters is not the average gap but whether the
 * candidate reorders the list: a model that reads every job 5 points lower is fine, one that
 * disagrees about which jobs are strong is not.
 */
import { estimateCostUsd, getSpendStatus, listUsers, loadEnv, runAs } from "@jd/core";
import { classifyEmail, recentlyClassified, trackedApplications } from "@jd/mail";
import { recentlyScored, scoreFit } from "@jd/research";

loadEnv();

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const candidate = arg("model");
const limit = Number(arg("n") ?? 20);
const purpose = arg("purpose") ?? "fit";
if (!candidate) {
  console.error("Usage: pnpm tsx scripts/compare-models.ts --model <route:model> [--n 20] [--purpose fit|emails]");
  process.exit(1);
}

/**
 * Email sorting, compared model against model on the same input. Bodies aren't stored, so both see
 * subject and snippet only; that is equal footing for the two, not a rerun of the original decision.
 */
if (purpose === "emails") {
  const userId = listUsers()[0]?.id;
  if (!userId) {
    console.error("No users.");
    process.exit(1);
  }
  const emails = recentlyClassified(userId, limit);
  const hints = trackedApplications(userId)
    .filter((a) => a.status !== "saved")
    .slice(-80)
    .map((a) => ({ id: a.id, company: a.company, title: a.title, status: a.status }));
  const spentAt = getSpendStatus(new Date(), null).todayUsd;
  let agreed = 0;
  let byModel = 0;
  let agreedByModel = 0;
  let failed = 0;

  for (const e of emails) {
    const raw = { providerId: "", rfcMessageId: null, threadId: null, fromName: e.fromName, fromAddress: e.fromAddress, subject: e.subject, receivedAt: e.receivedAt, text: e.snippet, links: [] };
    try {
      const { result, by } = await runAs(userId, () => classifyEmail(raw, hints, "UTC", { model: candidate }));
      const same = result.kind === e.kind;
      if (same) agreed++;
      // Vital to separate: classifyEmail silently falls back to the rules classifier when the model
      // can't fill the schema, and the rules get the easy "Thanks for applying" mail right. Counting
      // those as agreement would say a model works when it never answered at all.
      if (by === "llm") {
        byModel++;
        if (same) agreedByModel++;
      }
      console.log(`  ${same ? "same " : "DIFF "} ${by === "llm" ? "model " : "RULES "} ${e.kind.padEnd(22)} → ${result.kind.padEnd(22)} ${(e.subject || "").slice(0, 40)}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL         ${e.kind.padEnd(22)} → ${"".padEnd(22)} ${err instanceof Error ? err.message.slice(0, 60) : String(err)}`);
    }
  }
  const spent = getSpendStatus(new Date(), null).todayUsd - spentAt;
  console.log(`\n  the model answered   ${byModel}/${emails.length}${byModel < emails.length ? `  (the rest fell back to rules — the model couldn't fill the schema)` : ""}`);
  console.log(`  agreed, model only   ${agreedByModel}/${byModel}`);
  console.log(`  agreed overall       ${agreed}/${emails.length}`);
  if (failed) console.log(`  threw                ${failed}`);
  console.log(`  cost of this run     $${spent.toFixed(4)}`);
  console.log("\nNothing was written.\n");
  process.exit(0);
}

const scored = recentlyScored(limit);
if (!scored.length) {
  console.error("No fit scores stored yet, so there is nothing to compare against.");
  process.exit(1);
}

const band = (s: number) => (s >= 85 ? "strong" : s >= 70 ? "good" : s >= 50 ? "stretch" : "weak");

console.log(`\nComparing ${candidate} against ${scored.length} scores from ${scored[0]!.model}.\n`);

const deltas: number[] = [];
let bandChanges = 0;
let failures = 0;
const spentBefore = getSpendStatus(new Date(), null).todayUsd;

for (const row of scored) {
  try {
    const result = await runAs(row.userId, () => scoreFit(row.jobId, row.resumeId, { background: true, model: candidate, persist: false }));
    const delta = result.score - row.score;
    deltas.push(Math.abs(delta));
    const moved = band(result.score) !== band(row.score);
    if (moved) bandChanges++;
    console.log(
      `  ${String(row.score).padStart(3)} → ${String(result.score).padStart(3)}  ${(delta >= 0 ? "+" : "") + delta}`.padEnd(24) +
        `${moved ? "BAND" : "    "}  ${row.title.slice(0, 58)}`,
    );
  } catch (err) {
    failures++;
    console.log(`  ${String(row.score).padStart(3)} →  ??        FAIL  ${row.title.slice(0, 40)}: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`);
  }
}

const mean = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
const spent = getSpendStatus(new Date(), null).todayUsd - spentBefore;
// Roughly what these calls have been costing: the per-call averages from the existing ledger.
const wouldHaveCost = scored.length * estimateCostUsd({ purpose: "fit_score", model: scored[0]!.model, inputTokens: 3300, outputTokens: 650 });

console.log(`\n  mean absolute drift  ${mean.toFixed(1)} points`);
console.log(`  changed band         ${bandChanges}/${deltas.length}`);
if (failures) console.log(`  failed outright      ${failures}/${scored.length}`);
console.log(`  cost of this run     $${spent.toFixed(4)}   (the same work on ${scored[0]!.model}: about $${wouldHaveCost.toFixed(4)})`);
console.log("\nNo scores were written.\n");
