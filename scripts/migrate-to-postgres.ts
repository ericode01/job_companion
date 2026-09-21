/**
 * One-off, for the move off SQLite: copies data/app.db into Postgres and moves stored resumes into
 * the file store (the GCS bucket when GCS_BUCKET is set).
 *
 *   DATABASE_URL=postgres://… GCS_BUCKET=… pnpm db:copy-sqlite [--sqlite data/app.db] [--files data/files]
 *   pnpm db:copy-sqlite --verify     compare an existing copy with the SQLite file; changes nothing
 *
 * The target must be freshly migrated and empty. The copy is one transaction, so a failure leaves it
 * empty again. Afterwards every row is read back and compared with its SQLite original.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileStore, loadEnv, repoRoot } from "@jd/core";
import { type Db, DEV_DATABASE_URL, getDb, migrateDb, type SQL, sql, type Tx } from "@jd/core/db";
import Database from "better-sqlite3";

interface Column {
  name: string;
  /** Postgres data_type: "integer", "text", "jsonb", "boolean", "timestamp with time zone", "double precision". */
  type: string;
}
interface Table {
  name: string;
  columns: Column[];
  identity: string | null;
}
export interface CopyReport {
  tables: { name: string; sqlite: number; postgres: number; mismatched: number }[];
  files: { uploaded: number; missing: string[] };
  nulRemoved: number;
}

type Row = Record<string, unknown>;
const query = async <T>(db: Db | Tx, q: SQL): Promise<T[]> => ((await db.execute(q)) as unknown as { rows: T[] }).rows;

/** Tables in the order they can be filled: every table after the tables its foreign keys point at. */
async function targetTables(db: Db): Promise<Table[]> {
  const cols = await query<{ table_name: string; column_name: string; data_type: string; is_identity: string }>(
    db,
    sql`select table_name, column_name, data_type, is_identity from information_schema.columns
        where table_schema = 'public' order by table_name, ordinal_position`,
  );
  const fks = await query<{ child: string; parent: string }>(
    db,
    sql`select c.relname as child, p.relname as parent from pg_constraint k
        join pg_class c on c.oid = k.conrelid join pg_class p on p.oid = k.confrelid
        where k.contype = 'f' and c.relnamespace = 'public'::regnamespace`,
  );
  const byName = new Map<string, Table>();
  for (const c of cols) {
    const t = byName.get(c.table_name) ?? { name: c.table_name, columns: [], identity: null };
    t.columns.push({ name: c.column_name, type: c.data_type });
    if (c.is_identity === "YES") t.identity = c.column_name;
    byName.set(c.table_name, t);
  }
  const parents = new Map([...byName.keys()].map((n) => [n, new Set<string>()]));
  for (const { child, parent } of fks) if (child !== parent) parents.get(child)?.add(parent);
  const ordered: Table[] = [];
  const placed = new Set<string>();
  while (ordered.length < byName.size) {
    const ready = [...byName.keys()].filter((n) => !placed.has(n) && [...parents.get(n)!].every((p) => placed.has(p))).sort();
    if (!ready.length) throw new Error("The foreign keys form a cycle; can't choose an order to copy tables in.");
    for (const n of ready) {
      placed.add(n);
      ordered.push(byName.get(n)!);
    }
  }
  return ordered;
}

/** resume.file_path held an absolute path on this machine; it now holds a key in the file store. */
export function storageKey(filePath: string, filesDir: string): string {
  if (!path.isAbsolute(filePath)) return filePath;
  const rel = path.relative(filesDir, filePath);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep).join("/");
  // The install moved since the path was written: everything after ".../files/" is still the key.
  const at = filePath.lastIndexOf("/files/");
  if (at >= 0) return filePath.slice(at + "/files/".length);
  throw new Error(`Can't place ${filePath} in the file store: it isn't under ${filesDir}.`);
}

/** A SQLite value as Postgres should store it. */
function toPostgres(value: unknown, col: Column, stats: { nulRemoved: number }): unknown {
  if (value === null || value === undefined) return null;
  switch (col.type) {
    case "timestamp with time zone":
      if (typeof value !== "number") throw new Error(`${col.name}: expected milliseconds since 1970, found ${JSON.stringify(value)}`);
      return new Date(value);
    case "boolean":
      return value !== 0;
    case "text":
    case "jsonb": {
      // Postgres refuses NUL in text, and the \u0000 escape in jsonb. SQLite accepted both.
      const s = String(value);
      const clean = col.type === "jsonb" ? s.replaceAll("\\u0000", "").replaceAll("\u0000", "") : s.replaceAll("\u0000", "");
      if (clean !== s) stats.nulRemoved++;
      return clean; // jsonb goes as text: Postgres parses it
    }
    default:
      return value;
  }
}

/** Sorted-key JSON, so two rows that hold the same data compare equal however they were written. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object" && !(v instanceof Date)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Row)[k])]));
  return v;
}
/** A fingerprint of one row, in the same form whichever side it was read from. */
function fingerprint(table: Table, row: Row, side: "sqlite" | "postgres", filesDir: string): string {
  const values = table.columns.map((c) => {
    let v = row[c.name];
    if (v === null || v === undefined) return null;
    if (side === "sqlite") {
      if (c.type === "timestamp with time zone") return v;
      if (c.type === "boolean") return v !== 0;
      if (c.type === "jsonb") v = JSON.parse(String(v).replaceAll("\\u0000", "").replaceAll("\u0000", ""));
      if (c.type === "text") v = String(v).replaceAll("\u0000", "");
      if (table.name === "resume" && c.name === "file_path") v = storageKey(String(v), filesDir);
    } else if (c.type === "timestamp with time zone") {
      // Raw queries return timestamptz as text ("2026-09-16 21:23:45.123+00"); drizzle maps it only for schema queries.
      const ms = v instanceof Date ? v.getTime() : new Date(String(v)).getTime();
      if (Number.isNaN(ms)) throw new Error(`${table.name}.${c.name}: can't read timestamp ${JSON.stringify(v)}`);
      return ms;
    }
    return canonical(v);
  });
  return crypto.createHash("sha1").update(JSON.stringify(values)).digest("hex");
}

async function copy(sqlite: Database.Database, db: Db, tables: Table[], filesDir: string, report: CopyReport): Promise<void> {
  for (const t of tables) {
    const count = await query<{ n: string }>(db, sql`select count(*) as n from ${sql.identifier(t.name)}`);
    if (Number(count[0]?.n) > 0) {
      throw new Error(`The target isn't empty: ${t.name} already has rows. Copy into a freshly created database, or pass --verify to check an existing copy.`);
    }
  }
  await db.transaction(async (tx) => {
    for (const t of tables) {
      const sourceCols = new Set((sqlite.prepare(`pragma table_info("${t.name}")`).all() as { name: string }[]).map((c) => c.name));
      const missing = t.columns.filter((c) => !sourceCols.has(c.name)).map((c) => c.name);
      if (missing.length) throw new Error(`${t.name} in the SQLite file has no ${missing.join(", ")}. Run the old app once to finish its migrations, then copy again.`);
      // Stay under Postgres's 65,535 parameters per statement.
      const perBatch = Math.max(1, Math.min(500, Math.floor(60_000 / t.columns.length)));
      let batch: Row[] = [];
      const flush = async () => {
        if (!batch.length) return;
        const values = batch.map((r) => sql`(${sql.join(t.columns.map((c) => sql`${r[c.name]}`), sql`, `)})`);
        await tx.execute(sql`insert into ${sql.identifier(t.name)} (${sql.join(t.columns.map((c) => sql.identifier(c.name)), sql`, `)}) values ${sql.join(values, sql`, `)}`);
        batch = [];
      };
      for (const raw of sqlite.prepare(`select * from "${t.name}"`).iterate() as IterableIterator<Row>) {
        const row: Row = Object.fromEntries(t.columns.map((c) => [c.name, toPostgres(raw[c.name], c, report)]));
        if (t.name === "resume" && typeof row.file_path === "string") {
          const key = storageKey(row.file_path, filesDir);
          const bytes = fs.existsSync(path.join(filesDir, key)) ? fs.readFileSync(path.join(filesDir, key)) : null;
          if (bytes) {
            await fileStore().put(key, bytes, "application/pdf");
            report.files.uploaded++;
          } else report.files.missing.push(key);
          row.file_path = key;
        }
        batch.push(row);
        if (batch.length >= perBatch) await flush();
      }
      await flush();
      // Explicit ids don't advance an identity's sequence; without this the next insert collides with row 1.
      if (t.identity) {
        await tx.execute(
          sql`select setval(pg_get_serial_sequence(${`"${t.name}"`}, ${t.identity}), coalesce((select max(${sql.identifier(t.identity)}) from ${sql.identifier(t.name)}), 0) + 1, false)`,
        );
      }
      console.log(`  copied ${t.name}`);
    }
  });
}

async function verify(sqlite: Database.Database, db: Db, tables: Table[], filesDir: string, report: CopyReport): Promise<void> {
  for (const t of tables) {
    const expected = new Map<string, number>();
    let sqliteRows = 0;
    for (const raw of sqlite.prepare(`select * from "${t.name}"`).iterate() as IterableIterator<Row>) {
      const f = fingerprint(t, raw, "sqlite", filesDir);
      expected.set(f, (expected.get(f) ?? 0) + 1);
      sqliteRows++;
    }
    let postgresRows = 0;
    let mismatched = 0;
    // Read back in pages, so the 500MB job table never has to fit in memory at once.
    const pageSize = 2000;
    for (let offset = 0; ; offset += pageSize) {
      const order = t.identity ? sql`order by ${sql.identifier(t.identity)}` : sql`order by ctid`;
      const page = await query<Row>(db, sql`select * from ${sql.identifier(t.name)} ${order} limit ${pageSize} offset ${offset}`);
      for (const row of page) {
        postgresRows++;
        const f = fingerprint(t, row, "postgres", filesDir);
        const left = expected.get(f) ?? 0;
        if (left > 0) expected.set(f, left - 1);
        else mismatched++;
      }
      if (page.length < pageSize) break;
    }
    // Rows on either side without an identical partner on the other.
    mismatched = Math.max(mismatched, [...expected.values()].reduce((a, b) => a + b, 0));
    report.tables.push({ name: t.name, sqlite: sqliteRows, postgres: postgresRows, mismatched });
  }
}

async function checkSequences(db: Db, tables: Table[]): Promise<string[]> {
  const behind: string[] = [];
  for (const t of tables) {
    if (!t.identity) continue;
    const [{ seq } = { seq: null }] = await query<{ seq: string | null }>(db, sql`select pg_get_serial_sequence(${`"${t.name}"`}, ${t.identity}) as seq`);
    if (!seq) throw new Error(`${t.name}.${t.identity} is an identity column without a sequence.`);
    // The sequence itself says what comes next; pg_sequences reads null right after setval(…, false).
    // `seq` is a name Postgres just returned, already quoted, so it's safe to splice in.
    const [s] = await query<{ last_value: string; is_called: boolean }>(db, sql`select last_value, is_called from ${sql.raw(seq)}`);
    const [top] = await query<{ top: number | null }>(db, sql`select max(${sql.identifier(t.identity)}) as top from ${sql.identifier(t.name)}`);
    const next = Number(s!.last_value) + (s!.is_called ? 1 : 0);
    if (top?.top != null && next <= top.top) behind.push(`${t.name} (next id ${next}, but ${top.top} is taken)`);
  }
  return behind;
}

export async function copySqliteToPostgres(opts: { sqlitePath: string; filesDir: string; verifyOnly?: boolean }): Promise<CopyReport> {
  const sqlite = new Database(opts.sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const db = getDb();
    await migrateDb();
    const tables = await targetTables(db);
    const report: CopyReport = { tables: [], files: { uploaded: 0, missing: [] }, nulRemoved: 0 };
    if (!opts.verifyOnly) await copy(sqlite, db, tables, opts.filesDir, report);
    await verify(sqlite, db, tables, opts.filesDir, report);
    const behind = await checkSequences(db, tables);
    if (behind.length) throw new Error(`Sequences behind their tables: ${behind.join("; ")}`);
    return report;
  } finally {
    sqlite.close();
  }
}

async function main() {
  loadEnv();
  const arg = (name: string, fallback: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]!) : fallback;
  };
  const data = process.env.DATA_DIR ?? path.join(repoRoot(), "data");
  const sqlitePath = arg("--sqlite", path.join(data, "app.db"));
  const filesDir = arg("--files", path.join(data, "files"));
  const verifyOnly = process.argv.includes("--verify");
  const target = process.env.DATABASE_URL ?? `${DEV_DATABASE_URL} (the docker-compose default)`;
  console.log(`${verifyOnly ? "Verifying" : "Copying"} ${sqlitePath} → ${target.replace(/\/\/[^@]*@/, "//…@")}`);
  console.log(`Files: ${filesDir} → ${process.env.GCS_BUCKET ? `gs://${process.env.GCS_BUCKET}` : "the local file store"}\n`);

  const started = Date.now();
  const report = await copySqliteToPostgres({ sqlitePath, filesDir, verifyOnly });
  console.log(`\n${"table".padEnd(20)} ${"sqlite".padStart(8)} ${"postgres".padStart(9)}  identical`);
  for (const t of report.tables) {
    console.log(`${t.name.padEnd(20)} ${String(t.sqlite).padStart(8)} ${String(t.postgres).padStart(9)}  ${t.mismatched ? `NO — ${t.mismatched} differ` : "yes"}`);
  }
  if (!verifyOnly) console.log(`\nFiles uploaded: ${report.files.uploaded}${report.files.missing.length ? `; missing on disk: ${report.files.missing.join(", ")}` : ""}`);
  if (report.nulRemoved) console.log(`NUL characters removed (Postgres can't store them): ${report.nulRemoved} value(s)`);
  const bad = report.tables.filter((t) => t.mismatched || t.sqlite !== t.postgres);
  console.log(`\n${bad.length ? `✗ ${bad.length} table(s) differ.` : "✓ Every row is identical, and every sequence is past its table's highest id."} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if (bad.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
