import crypto from "node:crypto";
import { getDb, one, returned, schema } from "@jd/core/db";
import { eq } from "drizzle-orm";

const { extensionPairing } = schema;

export interface ExtensionState {
  token: string;
  lastSeenAt: Date | null;
  version: string | null;
}

const newToken = () => crypto.randomBytes(24).toString("base64url");

/** The person's pairing token, created on first use. The bridge script hands it to the extension. */
export async function getExtensionState(userId: number): Promise<ExtensionState> {
  const db = getDb();
  const row = await one(db.select().from(extensionPairing).where(eq(extensionPairing.userId, userId)));
  if (row) return row;
  return await returned(db.insert(extensionPairing).values({ userId, token: newToken() }).returning());
}

/** Invalidates this person's paired extension. It re-pairs the next time they open the app in Chrome. */
export async function rotateExtensionToken(userId: number): Promise<ExtensionState> {
  const token = newToken();
  return await returned(
    getDb()
      .insert(extensionPairing)
      .values({ userId, token })
      .onConflictDoUpdate({ target: extensionPairing.userId, set: { token, lastSeenAt: null, version: null } })
      .returning(),
  );
}

/** Resolves an extension request to the person it was paired with, or null. */
export async function userForExtensionToken(token: string | null, version?: string | null): Promise<number | null> {
  if (!token || token.length > 100) return null;
  const db = getDb();
  const row = await one(db.select().from(extensionPairing).where(eq(extensionPairing.token, token)));
  if (!row) return null;
  const stale = !row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > 60_000;
  if (stale || (version ?? null) !== row.version) {
    await db.update(extensionPairing)
      .set({ lastSeenAt: new Date(), version: version ?? row.version })
      .where(eq(extensionPairing.userId, row.userId));
  }
  return row.userId;
}
