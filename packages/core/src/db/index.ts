import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import { loadEnv, repoRoot } from "../paths";
import { reconcileAiSettings, reconcileAtsSettings } from "../settings";
import * as schema from "./schema";

/** Any Postgres driver: node-postgres in the app, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Migrator = (db: Db) => Promise<void>;

export const MIGRATIONS_DIR = path.join(repoRoot(), "packages/core/drizzle");
/** Matches docker-compose.yml, so `pnpm dev` needs no configuration. */
export const DEV_DATABASE_URL = "postgres://jobs:jobs@127.0.0.1:54317/jobs";

const g = globalThis as unknown as { __jdDb?: Db; __jdMigrate?: Migrator; __jdReady?: Promise<void> };

function databaseUrl(): string {
  loadEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (url) return url;
  if (process.env.NODE_ENV === "production") throw new Error("Set DATABASE_URL to the Postgres connection string.");
  return DEV_DATABASE_URL;
}

/**
 * Process-wide DB handle. Synchronous: opening a pool connects nothing until the first query, so
 * callers never await the handle, only their queries. Call initDb() once at startup to migrate.
 */
export function getDb(): Db {
  if (g.__jdDb) return g.__jdDb;
  const url = databaseUrl();
  g.__jdDb = drizzle(openPool(url), { schema }) as unknown as Db;
  g.__jdMigrate = () => migrateLocked(url);
  return g.__jdDb;
}

/**
 * A connection pool that survives the database going away. When Postgres ends a connection sitting
 * idle in the pool (a restart, a Cloud SQL maintenance window or failover), node-postgres emits
 * "error" on the pool, and an EventEmitter with no listener for it throws, ending the process. With
 * one, the dead connection is dropped and the next query opens a new one.
 */
export function openPool(url: string, max = 10): pg.Pool {
  // allowExitOnIdle: a script that has finished its queries exits instead of waiting on the pool.
  const pool = new pg.Pool({ connectionString: url, max, allowExitOnIdle: true });
  pool.on("error", (err) => console.error("[db] lost an idle connection:", err.message));
  return pool;
}

/** Any fixed number; it only has to be the same in every process that migrates. */
const MIGRATION_LOCK = 4317_0001;

/**
 * The web app and the worker start together and both migrate. Run at once, all but one fail
 * ("duplicate key" creating the same schema), and under `pnpm serve` one failing takes both down.
 * An advisory lock on a connection of its own makes the others wait, then find nothing left to do.
 */
async function migrateLocked(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await migrate(drizzle(client, { schema }), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await client.end(); // ending the session releases the lock
  }
}

/** Points the app at another database, with the migrator for its driver. Tests use this for PGlite. */
export function useDb(db: Db, migrator: Migrator): void {
  g.__jdDb = db;
  g.__jdMigrate = migrator;
  g.__jdReady = undefined;
}

/** Creates or updates the tables, and nothing else. initDb() is what the app calls. */
export async function migrateDb(): Promise<void> {
  const db = getDb();
  await g.__jdMigrate!(db);
}

/** Migrates and reconciles settings, once per process. Awaited by the web server and the worker at startup. */
export function initDb(): Promise<void> {
  g.__jdReady ??= (async () => {
    await migrateDb();
    await reconcileAtsSettings();
    await reconcileAiSettings();
  })().catch((err: unknown) => {
    // Don't cache the failure: a database that was unreachable at boot may be back by the next request.
    g.__jdReady = undefined;
    throw err;
  });
  return g.__jdReady;
}

/**
 * The first row, or undefined — what better-sqlite3's .get() returned. A SELECT gets LIMIT 1, as
 * .get() never read past the first row; without it Postgres would send every match.
 */
export async function one<T>(query: PromiseLike<T[]>): Promise<T | undefined> {
  const limited = (query as { limit?: (n: number) => PromiseLike<T[]> }).limit?.(1) ?? query;
  return (await limited)[0];
}

/** The row from an INSERT … RETURNING (or an upsert), which always produces one. */
export async function returned<T>(query: PromiseLike<T[]>): Promise<T> {
  const [row] = await query;
  if (row === undefined) throw new Error("Expected the statement to return a row, but it returned none.");
  return row;
}

export { schema };
/** For scripts, which reach drizzle only through this package. */
export { type SQL, sql } from "drizzle-orm";
