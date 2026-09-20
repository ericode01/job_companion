import crypto from "node:crypto";
import { getDb, schema } from "@jd/core/db";
import { eq } from "drizzle-orm";

const { extensionPairing } = schema;

export interface ExtensionState {
  token: string;
  lastSeenAt: Date | null;
  version: string | null;
}

const newToken = () => crypto.randomBytes(24).toString("base64url");

/** The person's pairing token, created on first use. The bridge script hands it to the extension. */
export function getExtensionState(userId: number): ExtensionState {
  const db = getDb();
  const row = db.select().from(extensionPairing).where(eq(extensionPairing.userId, userId)).get();
  if (row) return row;
  return db.insert(extensionPairing).values({ userId, token: newToken() }).returning().get();
}

/** Invalidates this person's paired extension. It re-pairs the next time they open the app in Chrome. */
export function rotateExtensionToken(userId: number): ExtensionState {
  const token = newToken();
  return getDb()
    .insert(extensionPairing)
    .values({ userId, token })
    .onConflictDoUpdate({ target: extensionPairing.userId, set: { token, lastSeenAt: null, version: null } })
    .returning()
    .get();
}

/** Resolves an extension request to the person it was paired with, or null. */
export function userForExtensionToken(token: string | null, version?: string | null): number | null {
  if (!token || token.length > 100) return null;
  const db = getDb();
  const row = db.select().from(extensionPairing).where(eq(extensionPairing.token, token)).get();
  if (!row) return null;
  const stale = !row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > 60_000;
  if (stale || (version ?? null) !== row.version) {
    db.update(extensionPairing)
      .set({ lastSeenAt: new Date(), version: version ?? row.version })
      .where(eq(extensionPairing.userId, row.userId))
      .run();
  }
  return row.userId;
}
