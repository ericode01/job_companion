import "server-only";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "@jd/core";

export const EXTENSION_ZIP = () => path.join(repoRoot(), "apps/extension/dist/job-companion-extension.zip");

/** The built extension's version and whether a download is available. */
export function extensionBuild(): { available: boolean; version: string | null; builtFor: string[] } {
  const dist = path.join(repoRoot(), "apps/extension/dist");
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dist, "manifest.json"), "utf8")) as { version: string; content_scripts: { js: string[]; matches: string[] }[] };
    const bridge = manifest.content_scripts.find((c) => c.js.includes("bridge.js"));
    return { available: fs.existsSync(EXTENSION_ZIP()), version: manifest.version, builtFor: (bridge?.matches ?? []).map((m) => m.replace(/\/\*$/, "")) };
  } catch {
    return { available: false, version: null, builtFor: [] };
  }
}
