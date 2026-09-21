import crypto from "node:crypto";
import { and, count, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { getDb, one, returned } from "./db";
import * as s from "./db/schema";

export type User = typeof s.user.$inferSelect;
export type PublicUser = Pick<User, "id" | "email" | "name" | "role" | "timezone" | "onboardingStep" | "lastSearchId" | "disabled">;

export class AuthError extends Error {}

/* ---------------- passwords ---------------- */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const MIN_PASSWORD_LENGTH = 10;

function scrypt(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Format: scrypt$N$r$p$salt$hash (base64url). Parameters travel with the hash so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new AuthError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, N, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await scrypt(password, Buffer.from(salt, "base64url"), Number(N), Number(r), Number(p), expected.length);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/* ---------------- sessions ---------------- */

export const SESSION_COOKIE = "jd_session";
export const SESSION_TTL_MS = 30 * 86_400_000;
const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

/** Returns the raw token for the cookie; only its hash is stored. */
export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getDb().insert(s.session).values({ id: sha256(token), userId, expiresAt });
  await getDb().update(s.user).set({ lastSeenAt: new Date() }).where(eq(s.user.id, userId));
  return { token, expiresAt };
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    timezone: u.timezone,
    onboardingStep: u.onboardingStep,
    lastSearchId: u.lastSearchId,
    disabled: u.disabled,
  };
}

/** Resolves a cookie token to its person. Slides the expiry forward at most once a day. */
export async function userForSession(token: string | undefined | null): Promise<PublicUser | null> {
  if (!token) return null;
  const db = getDb();
  const id = sha256(token);
  const row = await one(
    db
      .select({ user: s.user, expiresAt: s.session.expiresAt })
      .from(s.session)
      .innerJoin(s.user, eq(s.user.id, s.session.userId))
      .where(and(eq(s.session.id, id), gt(s.session.expiresAt, new Date()))),
  );
  if (!row || row.user.disabled) return null;
  const now = Date.now();
  if (row.expiresAt.getTime() - now < SESSION_TTL_MS - 86_400_000) {
    await db.update(s.session).set({ expiresAt: new Date(now + SESSION_TTL_MS) }).where(eq(s.session.id, id));
    await db.update(s.user).set({ lastSeenAt: new Date(now) }).where(eq(s.user.id, row.user.id));
  }
  return toPublicUser(row.user);
}

export async function deleteSession(token: string | undefined | null): Promise<void> {
  if (token) await getDb().delete(s.session).where(eq(s.session.id, sha256(token)));
}

export async function deleteSessionsFor(userId: number): Promise<void> {
  await getDb().delete(s.session).where(eq(s.session.userId, userId));
}

export async function pruneSessions(): Promise<void> {
  await getDb().delete(s.session).where(lt(s.session.expiresAt, new Date()));
}

/* ---------------- users ---------------- */

const normalizeEmail = (e: string) => e.trim().toLowerCase();

export async function userCount(): Promise<number> {
  return (await one(getDb().select({ n: count() }).from(s.user)))?.n ?? 0;
}

export async function getUser(id: number): Promise<User | null> {
  return await one(getDb().select().from(s.user).where(eq(s.user.id, id))) ?? null;
}

export async function listUsers(): Promise<User[]> {
  return await getDb().select().from(s.user).orderBy(s.user.id);
}

export async function authenticate(email: string, password: string): Promise<User | null> {
  const u = await one(getDb().select().from(s.user).where(eq(s.user.email, normalizeEmail(email))));
  // Hash anyway on a miss so response time doesn't reveal which emails exist.
  const ok = await verifyPassword(password, u?.passwordHash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA");
  return u && ok && !u.disabled ? u : null;
}

interface NewUser {
  email: string;
  name: string;
  password: string;
  role: s.UserRole;
  timezone?: string;
}

async function insertUser(n: NewUser): Promise<User> {
  const email = normalizeEmail(n.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("Enter a valid email address.");
  if (await one(getDb().select().from(s.user).where(eq(s.user.email, email)))) {
    throw new AuthError("An account with that email already exists.");
  }
  return await returned(
    getDb()
      .insert(s.user)
      .values({
        email,
        name: n.name.trim() || email.split("@")[0]!,
        passwordHash: await hashPassword(n.password),
        role: n.role,
        timezone: validTimezone(n.timezone) ? n.timezone! : "UTC",
      })
      .returning(),
  );
}

export function validTimezone(tz: string | undefined | null): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Tables whose rows belong to one person. Pre-accounts rows have a null owner until claimed. */
const OWNED = [s.profile, s.resume, s.savedSearch, s.application, s.answerBank, s.questionInbox, s.digestRun] as const;

/**
 * Creates the first account as admin and hands it everything that existed before accounts:
 * resume, searches, applications, answers, and the old single-user search/digest settings.
 * Only allowed while there are no accounts.
 */
export async function createFirstAdmin(n: Omit<NewUser, "role">): Promise<User> {
  if (await userCount() > 0) throw new AuthError("Setup is already done. Ask the admin for an invite.");
  const u = await insertUser({ ...n, role: "admin" });
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const t of OWNED) await tx.update(t).set({ userId: u.id }).where(isNull(t.userId));
    await tx.update(s.llmUsage).set({ userId: u.id }).where(isNull(s.llmUsage.userId));
    // The single-user app kept these as system settings; they are personal now.
    for (const key of ["search", "digest", "answers_seeded"] as const) {
      const row = await one(tx.select().from(s.settings).where(eq(s.settings.key, key)));
      if (row) await tx.insert(s.userSetting).values({ userId: u.id, key, value: row.value }).onConflictDoNothing();
    }
    // The old app saved a search every time one was run, each with its own AI reading of the
    // query; as dashboards, repeats are clutter. Keep one per query text (the one with email on,
    // else the newest) and archive the rest. Archived dashboards can be restored from Account.
    const searches = await tx.select().from(s.savedSearch).where(eq(s.savedSearch.userId, u.id)).orderBy(s.savedSearch.id);
    const keep = new Map<string, (typeof searches)[number]>();
    for (const row of searches) {
      const key = row.rawQuery.trim().toLowerCase().replace(/\s+/g, " ");
      const kept = keep.get(key);
      if (!kept || (row.notify && !kept.notify) || (row.notify === kept.notify && row.id > kept.id)) keep.set(key, row);
    }
    const kept = new Set([...keep.values()].map((r) => r.id));
    const claimedAt = new Date();
    for (const row of searches) {
      // Nothing that existed before accounts is "new since your last visit".
      await tx.update(s.savedSearch)
        .set({ lastViewedAt: claimedAt, ...(kept.has(row.id) ? {} : { archivedAt: claimedAt }) })
        .where(eq(s.savedSearch.id, row.id));
    }
    // Land on the search you followed by email, else the most recent one.
    const home = [...keep.values()].sort((a, b) => Number(b.notify) - Number(a.notify) || b.id - a.id)[0];
    if (home) await tx.update(s.user).set({ lastSearchId: home.id }).where(eq(s.user.id, u.id));
    const oldDigest = (await one(tx.select().from(s.settings).where(eq(s.settings.key, "digest"))))?.value as { method?: string } | undefined;
    if (oldDigest?.method === "resend" || oldDigest?.method === "smtp") {
      await tx.insert(s.settings)
        .values({ key: "mail", value: { method: oldDigest.method } })
        .onConflictDoNothing();
    }
    // Existing data means onboarding already happened in all but name.
    const hasSearch = (await one(tx.select({ n: count() }).from(s.savedSearch).where(eq(s.savedSearch.userId, u.id))))?.n;
    if (hasSearch) await tx.update(s.user).set({ onboardingStep: null }).where(eq(s.user.id, u.id));
  });
  return (await getUser(u.id))!;
}

/* ---------------- invites ---------------- */

export const INVITE_TTL_MS = 7 * 86_400_000;
export type Invite = typeof s.invite.$inferSelect;

export async function createInvite(createdBy: number, opts: { email?: string | null; role?: s.UserRole } = {}): Promise<{ token: string; invite: Invite }> {
  const token = crypto.randomBytes(24).toString("base64url");
  const invite = await returned(
    getDb()
      .insert(s.invite)
      .values({
        tokenHash: sha256(token),
        email: opts.email ? normalizeEmail(opts.email) : null,
        role: opts.role ?? "member",
        createdBy,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })
      .returning(),
  );
  return { token, invite };
}

export async function findOpenInvite(token: string): Promise<Invite | null> {
  return (
    await one(
      getDb()
        .select()
        .from(s.invite)
        .where(and(eq(s.invite.tokenHash, sha256(token)), isNull(s.invite.usedAt), gt(s.invite.expiresAt, new Date()))),
    ) ?? null
  );
}

export async function acceptInvite(token: string, n: Omit<NewUser, "role">): Promise<User> {
  const inv = await findOpenInvite(token);
  if (!inv) throw new AuthError("This invite link has expired or was already used.");
  if (inv.email && inv.email !== normalizeEmail(n.email)) throw new AuthError(`This invite is for ${inv.email}.`);
  const u = await insertUser({ ...n, role: inv.role });
  await getDb().update(s.invite).set({ usedAt: new Date(), usedBy: u.id }).where(eq(s.invite.id, inv.id));
  return u;
}

export async function listInvites(): Promise<Invite[]> {
  return await getDb().select().from(s.invite).orderBy(sql`${s.invite.id} desc`);
}

export async function revokeInvite(id: number): Promise<void> {
  await getDb().update(s.invite).set({ expiresAt: new Date() }).where(and(eq(s.invite.id, id), isNull(s.invite.usedAt)));
}

/* ---------------- account changes ---------------- */

export async function changePassword(userId: number, current: string, next: string): Promise<void> {
  const u = await getUser(userId);
  if (!u || !(await verifyPassword(current, u.passwordHash))) throw new AuthError("Your current password is wrong.");
  await getDb().update(s.user).set({ passwordHash: await hashPassword(next) }).where(eq(s.user.id, userId));
}

/** Admin reset: sets a new password and signs the person out everywhere. */
export async function resetPassword(userId: number, next: string): Promise<void> {
  await getDb().update(s.user).set({ passwordHash: await hashPassword(next) }).where(eq(s.user.id, userId));
  await deleteSessionsFor(userId);
}

export async function updateUser(userId: number, patch: Partial<Pick<User, "name" | "timezone" | "onboardingStep" | "lastSearchId" | "role" | "disabled">>): Promise<void> {
  if (patch.timezone !== undefined && !validTimezone(patch.timezone)) delete patch.timezone;
  await getDb().update(s.user).set(patch).where(eq(s.user.id, userId));
  if (patch.disabled) await deleteSessionsFor(userId);
}

/** There must always be one active admin. */
export async function activeAdminCount(): Promise<number> {
  return (
    (
      await one(
        getDb()
          .select({ n: count() })
          .from(s.user)
          .where(and(eq(s.user.role, "admin"), eq(s.user.disabled, false))),
      )
    )?.n ?? 0
  );
}
