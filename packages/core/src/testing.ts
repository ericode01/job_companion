import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite, types } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { type Db, initDb, MIGRATIONS_DIR, openPool, schema, useDb } from "./db";

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
 *
 * With TEST_DATABASE_URL set, each file gets a fresh database on that server instead, through
 * node-postgres, and drops it afterwards: the way to check a Postgres version before deploying it.
 *   TEST_DATABASE_URL=postgres://jobs:jobs@127.0.0.1:54317/jobs pnpm test
 */
export async function useTestDb(prefix = "jd-test-"): Promise<{ db: Db; dataDir: string }> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.DATA_DIR = dataDir;
  const server = process.env.TEST_DATABASE_URL?.trim();
  if (server) return { db: await serverTestDb(server), dataDir };
  const db = drizzle(new PGlite({ parsers: PARSE_LIKE_NODE_POSTGRES, serializers: SERIALIZE_LIKE_NODE_POSTGRES }), { schema }) as unknown as Db;
  useDb(db, (d) => migrate(d as unknown as PgliteDatabase<typeof schema>, { migrationsFolder: MIGRATIONS_DIR }));
  await initDb();
  return { db, dataDir };
}

async function serverTestDb(server: string): Promise<Db> {
  // A generated name, only ever [a-z0-9_], so it's safe to splice into the DDL.
  const name = `jd_test_${process.pid}_${crypto.randomBytes(4).toString("hex")}`;
  const admin = async (statement: string) => {
    const client = new pg.Client({ connectionString: server });
    await client.connect();
    try {
      await client.query(statement);
    } finally {
      await client.end();
    }
  };
  await admin(`create database ${name}`);
  const url = new URL(server);
  url.pathname = `/${name}`;
  const pool = openPool(url.toString(), 5);
  const db = drizzlePg(pool, { schema }) as unknown as Db;
  useDb(db, (d) => migratePg(d as unknown as NodePgDatabase<typeof schema>, { migrationsFolder: MIGRATIONS_DIR }));
  await initDb();
  // Imported here so the app never loads vitest; only test files call useTestDb.
  const { afterAll } = await import("vitest");
  afterAll(async () => {
    await pool.end();
    await admin(`drop database if exists ${name} with (force)`);
  });
  return db;
}
