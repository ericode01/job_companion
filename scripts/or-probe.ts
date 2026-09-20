/**
 * Checks what a model can actually do before you put work on it.
 *
 *   pnpm tsx scripts/or-probe.ts openrouter:deepseek/deepseek-v4-flash
 *   pnpm tsx scripts/or-probe.ts openrouter:openrouter/auto
 *   pnpm tsx scripts/or-probe.ts anthropic:claude-haiku-4-5 --search
 */
import { loadEnv } from "@jd/core";
import { probeModel } from "@jd/llm";

loadEnv();

const [setting, ...flags] = process.argv.slice(2);
if (!setting) {
  console.error("Usage: pnpm tsx scripts/or-probe.ts <route:model> [--search]");
  process.exit(1);
}

const results = await probeModel(setting, { search: flags.includes("--search") });
const failed = results.filter((r) => !r.ok).length;

console.log(`\nProbe: ${setting}\n`);
for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.check.padEnd(38)} ${r.detail}`);
console.log(`\n${results.length - failed}/${results.length} passed.`);
if (setting.endsWith("openrouter/auto")) console.log("Auto Router: the model named on the first line is the one it picked for that prompt.");
console.log();
process.exitCode = failed ? 1 : 0;
