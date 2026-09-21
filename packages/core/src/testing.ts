import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite, types } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { type Db, initDb, MIGRATIONS_DIR, schema, useDb } from "./db";

/**
 * PGlite behaves like node-postgres, the production driver, where the two differ; otherwise a test
 * passes on behaviour the app never gets. Reading: node-postgres returns bigint (every count(*))
 * and numeric as strings, where PGlite would make numbers. Writing: node-postgres sends a number
 * bound to a timestamp as its digits, which Postgres rejects, where PGlite would quietly convert it.
 */
const PARSE_LIKE_NODE_POSTGRES = { [types.INT8]: (v: string) => v, [types.NUMERIC]: (v: string) => v };
const asTimestamp = (v: unknown) => (typeof v === "string" ? v : v instanceof Date ? v.toISOString() : String(v));
const SERIALIZE_LIKE_NODE_POSTGRES = { [types.TIMESTAMPTZ]: asTimestamp, [types.TIMESTAMP]: asTimestamp, [types.DATE]: asTimestamp };

/**
 * Gives a test file its own throwaway data dir and its own in-memory Postgres (PGlite: the real
 * engine compiled to WASM, no server), migrated. Await it at the top of the file, before anything
 * reads the database.
 */
export async function useTestDb(prefix = "jd-test-"): Promise<{ db: Db; dataDir: string }> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.DATA_DIR = dataDir;
  const db = drizzle(new PGlite({ parsers: PARSE_LIKE_NODE_POSTGRES, serializers: SERIALIZE_LIKE_NODE_POSTGRES }), { schema }) as unknown as Db;
  useDb(db, (d) => migrate(d as unknown as PgliteDatabase<typeof schema>, { migrationsFolder: MIGRATIONS_DIR }));
  await initDb();
  return { db, dataDir };
}
