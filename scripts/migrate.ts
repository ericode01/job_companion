import { initDb } from "@jd/core/db";

await initDb();
console.log("Database migrated.");
