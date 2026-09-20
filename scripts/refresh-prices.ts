/**
 * Refreshes the model price snapshot from OpenRouter's public catalogue.
 *
 * Writes packages/core/src/model-prices.json, which is committed: the app must be able to cost a
 * call without a network round trip (recordUsage is synchronous, and budget caps depend on it).
 * At runtime the worker keeps a fresher copy in data/; this file is the floor under that.
 *
 *   pnpm tsx scripts/refresh-prices.ts
 */
import fs from "node:fs";
import path from "node:path";
import { repoRoot, writePriceSnapshot } from "@jd/core";

const out = path.join(repoRoot(), "packages", "core", "src", "model-prices.json");
const { count, updatedAt } = await writePriceSnapshot(out);
console.log(`Wrote ${count} model prices to ${path.relative(repoRoot(), out)} (${updatedAt}).`);
if (!fs.existsSync(out)) process.exitCode = 1;
