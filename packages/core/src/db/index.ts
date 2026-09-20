import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { dataDir, repoRoot } from "../paths";
import { reconcileAtsSettings } from "../settings";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const g = globalThis as unknown as { __jdDb?: Db };

/** Process-wide DB handle. Migrations run on first open. */
export function getDb(): Db {
  if (g.__jdDb) return g.__jdDb;
  const sqlite = new Database(path.join(dataDir(), "app.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(repoRoot(), "packages/core/drizzle") });
  // Assign before reconciling: reconcileAtsSettings reads settings through getDb().
  g.__jdDb = db;
  reconcileAtsSettings();
  return db;
}

export { schema };
