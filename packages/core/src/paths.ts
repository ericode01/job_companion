import fs from "node:fs";
import path from "node:path";

/** Walks up from cwd to the directory holding pnpm-workspace.yaml. */
export function repoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export function dataDir(): string {
  const dir = process.env.DATA_DIR ?? path.join(repoRoot(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

let envLoaded = false;
/** Loads <repo>/.env.local into process.env (without overriding existing vars). */
export function loadEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  const file = path.join(repoRoot(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || m[2] === "") continue;
    const [, key, raw] = m as unknown as [string, string, string];
    if (process.env[key] === undefined) process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}

export const DEV_ORIGIN = "http://127.0.0.1:4317";

/**
 * The public address of the app, e.g. "https://jobs.example.com". Links in emails and the
 * allowed Host/Origin checks come from here. Unset means local development on 127.0.0.1.
 */
export function appOrigin(): string {
  loadEnv();
  const raw = process.env.APP_ORIGIN?.trim();
  if (!raw) return DEV_ORIGIN;
  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(`APP_ORIGIN "${raw}" isn't a valid URL (expected e.g. https://jobs.example.com).`);
  }
}
