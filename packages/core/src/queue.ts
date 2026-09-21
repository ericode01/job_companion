import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb, one, returned } from "./db";
import { task, type TaskKind } from "./db/schema";

export type Task = typeof task.$inferSelect;

export interface EnqueueOptions {
  /** User-initiated tasks run first and are not stopped by the spend cap. */
  background: boolean;
  priority?: number;
}

/**
 * Adds a task unless one with the same (kind, key) is already queued or running.
 * Returns the existing or new task.
 */
export async function enqueueTask(kind: TaskKind, key: string, payload: Record<string, unknown>, opts: EnqueueOptions): Promise<Task> {
  const db = getDb();
  return await db.transaction(async (tx) => {
    const existing = await one(
      tx
        .select()
        .from(task)
        .where(and(eq(task.kind, kind), eq(task.key, key), inArray(task.status, ["queued", "running"]))),
    );
    if (existing) {
      // A user now wants it: promote a queued background task.
      if (!opts.background && existing.background && existing.status === "queued") {
        return await returned(
          tx
            .update(task)
            .set({ background: false, priority: Math.max(existing.priority, opts.priority ?? 10) })
            .where(eq(task.id, existing.id))
            .returning(),
        );
      }
      return existing;
    }
    const added = await one(
      tx
        .insert(task)
        .values({ kind, key, payload, status: "queued", background: opts.background, priority: opts.priority ?? (opts.background ? 0 : 10) })
        .onConflictDoNothing()
        .returning(),
    );
    if (added) return added;
    // Someone else queued the same work between our look and our insert; theirs is the task.
    return await returned(
      tx
        .select()
        .from(task)
        .where(and(eq(task.kind, kind), eq(task.key, key), inArray(task.status, ["queued", "running"]))),
    );
  });
}

/**
 * Atomically claims the highest-priority runnable task of the given kinds. SKIP LOCKED is what
 * makes it atomic: the web app and the worker are separate connections, and without it two
 * callers could select the same row, leaving the loser with nothing instead of the next task.
 */
export async function claimTask(kinds: TaskKind[], now = new Date()): Promise<Task | null> {
  if (kinds.length === 0) return null;
  return await getDb().transaction(async (tx) => {
    const next = await one(
      tx
        .select({ id: task.id })
        .from(task)
        .where(and(eq(task.status, "queued"), inArray(task.kind, kinds), lte(task.runAfter, now)))
        .orderBy(sql`${task.priority} desc`, task.id)
        .limit(1)
        .for("update", { skipLocked: true }),
    );
    if (!next) return null;
    const claimed = await one(
      tx
        .update(task)
        .set({ status: "running", startedAt: now, attempts: sql`${task.attempts} + 1` })
        // Redundant while the row is locked, but it keeps a claim single if the lock ever goes.
        .where(and(eq(task.id, next.id), eq(task.status, "queued")))
        .returning(),
    );
    return claimed ?? null;
  });
}

export async function completeTask(id: number): Promise<void> {
  await getDb().update(task).set({ status: "done", finishedAt: new Date(), error: null }).where(eq(task.id, id));
}

export async function failTask(id: number, error: string, retryAt?: Date): Promise<void> {
  await getDb()
    .update(task)
    .set(
      retryAt
        ? { status: "queued", runAfter: retryAt, error }
        : { status: "failed", finishedAt: new Date(), error: error.slice(0, 1000) },
    )
    .where(eq(task.id, id));
}

/** Tasks left running by a previous process go back to the queue. */
export async function requeueInterruptedTasks(): Promise<number> {
  const requeued = await getDb().update(task).set({ status: "queued" }).where(eq(task.status, "running")).returning({ id: task.id });
  return requeued.length;
}

export async function latestTask(kind: TaskKind, key: string): Promise<Task | null> {
  const latest = await one(
    getDb()
      .select()
      .from(task)
      .where(and(eq(task.kind, kind), eq(task.key, key)))
      .orderBy(sql`${task.id} desc`)
      .limit(1),
  );
  return latest ?? null;
}

export async function hasRunnableTasks(): Promise<boolean> {
  return Boolean(await one(getDb().select({ id: task.id }).from(task).where(eq(task.status, "queued")).limit(1)));
}

/** Drops finished tasks older than `days`. */
export async function pruneTasks(days = 7): Promise<void> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  await getDb()
    .delete(task)
    .where(and(inArray(task.status, ["done", "failed"]), lte(task.createdAt, cutoff)));
}
