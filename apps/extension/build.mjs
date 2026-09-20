/**
 * node build.mjs [--watch]
 *
 * APP_URL is the Job Companion server this build talks to (default http://127.0.0.1:4317 for
 * local development). It goes into the manifest's permissions and the background script, so a
 * build only ever sends your data to that one server. Also writes dist/job-companion-extension.zip,
 * which the app offers for download on its Extension page.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

function appOrigin() {
  const raw = process.env.APP_URL || process.env.APP_ORIGIN || "http://127.0.0.1:4317";
  const u = new URL(raw);
  if (u.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(u.hostname)) {
    throw new Error(`APP_URL must be https (got ${raw}); only localhost may use http.`);
  }
  return u.origin;
}
const APP = appOrigin();
const local = APP === "http://127.0.0.1:4317" || APP === "http://localhost:4317";
const appOrigins = local ? ["http://127.0.0.1:4317", "http://localhost:4317"] : [APP];

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

const manifest = JSON.parse(readFileSync("public/manifest.json", "utf8"));
manifest.version = pkg.version;
const boards = manifest.content_scripts.find((c) => c.js.includes("content.js")).matches;
manifest.host_permissions = [...appOrigins.map((o) => `${o}/*`), ...boards];
manifest.content_scripts.find((c) => c.js.includes("bridge.js")).matches = appOrigins.map((o) => `${o}/*`);
writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2));
cpSync("public/icons", "dist/icons", { recursive: true });

const options = {
  entryPoints: { background: "src/background.ts", bridge: "src/bridge.ts", content: "src/content.ts" },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  define: { __VERSION__: JSON.stringify(pkg.version), __APP_ORIGINS__: JSON.stringify(appOrigins) },
  logLevel: "info",
};

if (process.argv.includes("--harness")) {
  await build({ entryPoints: ["test/harness.ts"], outfile: "dist-harness/harness.js", bundle: true, format: "iife", target: "chrome120", logLevel: "info" });
  process.exit(0);
}

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
  writeZip("dist", "dist/job-companion-extension.zip");
  console.log(`built for ${APP} → dist/ and dist/job-companion-extension.zip`);
}

/* ---- minimal ZIP writer (stored, no compression): no dependency for a ~100 KB folder ---- */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function writeZip(dir, out) {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (p === out) continue;
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dir);
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const data = readFileSync(file);
    // Unzips to a folder named after the extension, which is what you pick in "Load unpacked".
    const name = Buffer.from(`job-companion-extension/${path.relative(dir, file).split(path.sep).join("/")}`);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(out, Buffer.concat([...chunks, centralBuf, end]));
}
