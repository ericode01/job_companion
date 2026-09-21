/**
 * Runs once when the server starts, before it handles a request: migrates the database, which
 * used to happen on the first query when the database was a local file.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` loads server code too, and the image is built without a database to reach.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { initDb } = await import("@jd/core/db");
  await initDb();
}
