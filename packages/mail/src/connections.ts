import { decryptSecret, encryptSecret, enqueueTask, getSettings } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import { and, eq, inArray } from "drizzle-orm";
import { revokeGoogleToken } from "./gmail";
import { type ImapLogin, testImapLogin } from "./imap";

export type Connection = typeof schema.mailboxConnection.$inferSelect;

/** What the browser may see: never the secret. */
export interface PublicConnection {
  id: number;
  provider: "gmail" | "imap";
  address: string;
  status: Connection["status"] | "disconnected";
  imapHost: string | null;
  backfillDays: number;
  backfillDone: boolean;
  progress: { done: number; total: number } | null;
  lastSyncAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

export function toPublic(c: Connection): PublicConnection {
  return {
    id: c.id,
    provider: c.provider,
    address: c.address,
    status: c.secret ? c.status : "disconnected",
    imapHost: c.imapHost,
    backfillDays: c.backfillDays,
    backfillDone: c.backfillDone,
    progress: c.progress ?? null,
    lastSyncAt: c.lastSyncAt,
    lastError: c.lastError,
    createdAt: c.createdAt,
  };
}

export function getConnection(userId: number, id: number): Connection | null {
  return (
    getDb()
      .select()
      .from(schema.mailboxConnection)
      .where(and(eq(schema.mailboxConnection.id, id), eq(schema.mailboxConnection.userId, userId)))
      .get() ?? null
  );
}

export function listConnections(userId: number): Connection[] {
  return getDb().select().from(schema.mailboxConnection).where(eq(schema.mailboxConnection.userId, userId)).orderBy(schema.mailboxConnection.id).all();
}

/** Connected (not disconnected) mailboxes. */
export function activeConnections(userId: number): Connection[] {
  return listConnections(userId).filter((c) => c.secret);
}

export function updateConnection(id: number, patch: Partial<Omit<Connection, "id" | "userId">>): void {
  getDb().update(schema.mailboxConnection).set(patch).where(eq(schema.mailboxConnection.id, id)).run();
}

function clampDays(days: number): number {
  return Math.max(7, Math.min(getSettings("mailSync").maxBackfillDays, Math.round(days)));
}

/** Adds or reconnects a mailbox. Reconnecting keeps what was already read. */
function upsert(userId: number, values: { provider: "gmail" | "imap"; address: string; secret: string; imapHost?: string | null; imapPort?: number | null; backfillDays: number }): Connection {
  const db = getDb();
  const existing = db
    .select()
    .from(schema.mailboxConnection)
    .where(and(eq(schema.mailboxConnection.userId, userId), eq(schema.mailboxConnection.address, values.address)))
    .get();
  const sealed = encryptSecret(values.secret);
  if (existing) {
    const sameServer = existing.provider === values.provider && (existing.imapHost ?? null) === (values.imapHost ?? null);
    return db
      .update(schema.mailboxConnection)
      .set({
        provider: values.provider,
        secret: sealed,
        imapHost: values.imapHost ?? null,
        imapPort: values.imapPort ?? null,
        status: "active",
        lastError: null,
        ...(sameServer ? {} : { cursor: {}, backfillDone: false, backfillDays: clampDays(values.backfillDays) }),
      })
      .where(eq(schema.mailboxConnection.id, existing.id))
      .returning()
      .get();
  }
  return db
    .insert(schema.mailboxConnection)
    .values({
      userId,
      provider: values.provider,
      address: values.address,
      secret: sealed,
      imapHost: values.imapHost ?? null,
      imapPort: values.imapPort ?? null,
      backfillDays: clampDays(values.backfillDays),
    })
    .returning()
    .get();
}

export function saveGmailConnection(userId: number, input: { address: string; refreshToken: string; backfillDays: number }): Connection {
  const conn = upsert(userId, { provider: "gmail", address: input.address.toLowerCase(), secret: input.refreshToken, backfillDays: input.backfillDays });
  enqueueSync(conn, true);
  return conn;
}

/** A test-only mailbox read from .eml files (MAIL_FAKE_DIR), for end-to-end checks without a real inbox. */
export const FAKE_HOST = "fake.local";
export function fakeMailAllowed(): boolean {
  return Boolean(process.env.MAIL_FAKE_DIR) && process.env.NODE_ENV !== "production";
}

export async function saveImapConnection(
  userId: number,
  input: { address: string; host: string; port: number; password: string; backfillDays: number },
): Promise<Connection> {
  const login: ImapLogin = { host: input.host.trim().toLowerCase(), port: input.port, user: input.address.trim(), password: input.password };
  if (!(login.host === FAKE_HOST && fakeMailAllowed())) await testImapLogin(login);
  const conn = upsert(userId, { provider: "imap", address: input.address.trim().toLowerCase(), secret: input.password, imapHost: login.host, imapPort: login.port, backfillDays: input.backfillDays });
  enqueueSync(conn, true);
  return conn;
}

/**
 * Stops reading a mailbox: forgets the credentials (and revokes Google's grant). Synced job
 * emails stay on your applications unless you ask for them to be deleted too.
 */
export async function disconnect(userId: number, id: number, purge: boolean): Promise<boolean> {
  const conn = getConnection(userId, id);
  if (!conn) return false;
  if (conn.provider === "gmail" && conn.secret) {
    try {
      await revokeGoogleToken(decryptSecret(conn.secret));
    } catch {
      /* the stored token may already be unreadable; forgetting it is what matters */
    }
  }
  const db = getDb();
  if (purge) {
    db.delete(schema.mailboxConnection).where(eq(schema.mailboxConnection.id, id)).run();
  } else {
    db.update(schema.mailboxConnection)
      .set({ secret: "", status: "paused", progress: null, lastError: null })
      .where(eq(schema.mailboxConnection.id, id))
      .run();
  }
  return true;
}

export function enqueueSync(conn: Pick<Connection, "id" | "userId">, now: boolean): void {
  enqueueTask("sync_mailbox", `mailbox:${conn.id}`, { userId: conn.userId, connectionId: conn.id }, { background: !now, priority: now ? 15 : 0 });
}

/** Mailboxes whose next check is due (the worker's timer calls this every minute). */
export function dueConnections(now = Date.now()): Connection[] {
  const { enabled, intervalMinutes } = getSettings("mailSync");
  if (!enabled) return [];
  const active = getDb()
    .select()
    .from(schema.mailboxConnection)
    .where(inArray(schema.mailboxConnection.status, ["active", "error"]))
    .all()
    .filter((c) => c.secret);
  const disabled = new Set(
    getDb()
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.disabled, true))
      .all()
      .map((u) => u.id),
  );
  return active.filter((c) => !disabled.has(c.userId) && (!c.lastSyncAt || now - c.lastSyncAt.getTime() >= intervalMinutes * 60_000));
}
