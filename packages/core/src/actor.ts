import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The person a piece of work is being done for. Set once at the edge (a request handler or a
 * worker task) so deep code — the AI spend ledger, budget checks — can attribute it without
 * every function taking a userId.
 */
const store = new AsyncLocalStorage<{ userId: number | null }>();

export function runAs<T>(userId: number | null, fn: () => T): T {
  return store.run({ userId }, fn);
}

/** The current person, or null for shared/system work (crawls, company research started by the system). */
export function currentUserId(): number | null {
  return store.getStore()?.userId ?? null;
}
