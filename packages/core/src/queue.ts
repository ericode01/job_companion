import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "./db";
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
export function enqueueTask(kind: TaskKind, key: string, payload: Record<string, unknown>, opts: EnqueueOptions): Task {
  const db = getDb();
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(task)
      .where(and(eq(task.kind, kind), eq(task.key, key), inArray(task.status, ["queued", "running"])))
      .get();
    if (existing) {
      // A user now wants it: promote a queued background task.
      if (!opts.background && existing.background && existing.status === "queued") {
        return tx
          .update(task)
          .set({ background: false, priority: Math.max(existing.priority, opts.priority ?? 10) })
          .where(eq(task.id, existing.id))
          .returning()
          .get();
      }
      return existing;
    }
    return tx
      .insert(task)
      .values({ kind, key, payload, status: "queued", background: opts.background, priority: opts.priority ?? (opts.background ? 0 : 10) })
      .returning()
      .get();
  });
}

/** Atomically claims the highest-priority runnable task of the given kinds. */
export function claimTask(kinds: TaskKind[], now = new Date()): Task | null {
  if (kinds.length === 0) return null;
  const db = getDb();
  return db.transaction((tx) => {
    const next = tx
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.status, "queued"), inArray(task.kind, kinds), lte(task.runAfter, now)))
      .orderBy(sql`${task.priority} desc`, task.id)
      .limit(1)
      .get();
    if (!next) return null;
    return (
      tx
        .update(task)
        .set({ status: "running", startedAt: now, attempts: sql`${task.attempts} + 1` })
        .where(and(eq(task.id, next.id), eq(task.status, "queued")))
        .returning()
        .get() ?? null
    );
  });
}

export function completeTask(id: number): void {
  getDb().update(task).set({ status: "done", finishedAt: new Date(), error: null }).where(eq(task.id, id)).run();
}

export function failTask(id: number, error: string, retryAt?: Date): void {
  getDb()
    .update(task)
    .set(
      retryAt
        ? { status: "queued", runAfter: retryAt, error }
        : { status: "failed", finishedAt: new Date(), error: error.slice(0, 1000) },
    )
    .where(eq(task.id, id))
    .run();
}

/** Tasks left running by a previous process go back to the queue. */
export function requeueInterruptedTasks(): number {
  return getDb().update(task).set({ status: "queued" }).where(eq(task.status, "running")).run().changes;
}

export function latestTask(kind: TaskKind, key: string): Task | null {
  return (
    getDb()
      .select()
      .from(task)
      .where(and(eq(task.kind, kind), eq(task.key, key)))
      .orderBy(sql`${task.id} desc`)
      .limit(1)
      .get() ?? null
  );
}

export function hasRunnableTasks(): boolean {
  return Boolean(getDb().select({ id: task.id }).from(task).where(eq(task.status, "queued")).limit(1).get());
}

/** Drops finished tasks older than `days`. */
export function pruneTasks(days = 7): void {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  getDb()
    .delete(task)
    .where(and(inArray(task.status, ["done", "failed"]), lte(task.createdAt, cutoff)))
    .run();
}
