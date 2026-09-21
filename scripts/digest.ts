/**
 * pnpm digest [--dry-run] [--force] [--user you@example.com]
 * Builds and sends the daily email digest for everyone whose digest is due, or for one person.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir, listUsers, loadEnv } from "@jd/core";
import { initDb } from "@jd/core/db";
import { dueDigestUsers, renderHtml, renderText, runDigest } from "@jd/digest";

loadEnv();
await initDb();
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const email = args[args.indexOf("--user") + 1];
const users = await listUsers();
const targets = args.includes("--user")
  ? users.filter((u) => u.email === email?.toLowerCase())
  : dryRun || force
    ? users.filter((u) => !u.disabled)
    : await dueDigestUsers().then((due) => users.filter((u) => due.includes(u.id)));

if (!targets.length) {
  console.log(args.includes("--user") ? `No account for ${email}.` : "Nobody's digest is due.");
  process.exit(0);
}

let failed = false;
for (const u of targets) {
  const outcome = await runDigest(u.id, { dryRun, force });
  console.log(`\n=== ${u.email} ===\nsubject: ${outcome.subject}`);
  console.log(renderText(outcome.digest));
  if (dryRun) {
    const file = path.join(dataDir(), `digest-preview-${u.id}.html`);
    fs.writeFileSync(file, renderHtml(outcome.digest));
    console.log(`\npreview written to ${file}`);
  }
  console.log(`\n${outcome.status}${outcome.reason ? `: ${outcome.reason}` : ""}`);
  failed ||= outcome.status === "failed";
}
process.exit(failed ? 1 : 0);
