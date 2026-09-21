/** pnpm crawl [--force] */
import { initDb } from "@jd/core/db";
import { runCrawl } from "@jd/sources";

await initDb();

const force = process.argv.includes("--force");
const started = Date.now();
const id = await runCrawl({
  trigger: "manual",
  force,
  onProgress: ({ done, total, failed }) => process.stdout.write(`\rcrawled ${done}/${total} (${failed} failed)`),
});
console.log(`\ncrawl #${id} finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
