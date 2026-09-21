import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

const { useTestDb } = await import("../src/testing");
await useTestDb("jd-auth-");

const core = await import("../src");
const { getDb, schema } = await import("../src/db");

const filter = {
  roleKeywords: ["engineer"],
  levelKeywords: ["staff"],
  excludeKeywords: [],
  locations: [],
  includeRemoteUS: true,
  remoteOnly: false,
  postedWithinDays: 30,
};

beforeAll(async () => {
  // What a single-user install looked like before accounts: rows with no owner.
  const db = getDb();
  await db.insert(schema.profile).values({ id: 1, name: "Old Me" });
  await db.insert(schema.savedSearch).values({ rawQuery: "staff engineer in NYC", filter, parsedBy: "rules" });
  await db.insert(schema.savedSearch).values({ rawQuery: "Staff engineer in NYC ", filter, parsedBy: "rules", notify: true });
  await db.insert(schema.savedSearch).values({ rawQuery: "product manager", filter, parsedBy: "rules" });
  await db.insert(schema.settings).values({ key: "digest", value: { enabled: true, to: "old@example.com", method: "resend" } });
});

describe("passwords", () => {
  it("hashes with scrypt and verifies", async () => {
    const hash = await core.hashPassword("correct horse battery");
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await core.verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await core.verifyPassword("wrong horse battery", hash)).toBe(false);
  });

  it("rejects short passwords", async () => {
    await expect(core.hashPassword("short")).rejects.toThrow("at least 10");
  });
});

describe("first account", () => {
  it("becomes admin and inherits the pre-accounts data", async () => {
    const admin = await core.createFirstAdmin({ name: "Eric", email: "Eric@Example.com ", password: "correct horse battery", timezone: "America/New_York" });
    expect(admin).toMatchObject({ role: "admin", email: "eric@example.com", timezone: "America/New_York", onboardingStep: null });
    expect((await core.getProfile(admin.id))?.name).toBe("Old Me");
    expect(await core.getUserSettings(admin.id, "digest")).toMatchObject({ enabled: true, to: "old@example.com" });
    expect((await core.getSettings("mail")).method).toBe("resend");

    const searches = await getDb().select().from(schema.savedSearch).where(eq(schema.savedSearch.userId, admin.id));
    expect(searches).toHaveLength(3);
    // The two copies of the same search collapse to one dashboard: the one with email on.
    const live = searches.filter((s) => !s.archivedAt);
    expect(live.map((s) => s.rawQuery.trim().toLowerCase()).sort()).toEqual(["product manager", "staff engineer in nyc"]);
    expect(live.find((s) => s.rawQuery.startsWith("Staff"))?.notify).toBe(true);
  });

  it("can only happen once", async () => {
    await expect(core.createFirstAdmin({ name: "X", email: "x@example.com", password: "correct horse battery" })).rejects.toThrow("already done");
  });
});

describe("sessions", () => {
  it("resolves a token to its person and stores only a hash", async () => {
    const u = (await core.authenticate("eric@example.com", "correct horse battery"))!;
    const { token } = await core.createSession(u.id);
    expect((await core.userForSession(token))?.id).toBe(u.id);
    expect((await getDb().select().from(schema.session)).some((s) => s.id === token)).toBe(false);
    await core.deleteSession(token);
    expect(await core.userForSession(token)).toBeNull();
  });

  it("rejects wrong passwords and disabled people", async () => {
    expect(await core.authenticate("eric@example.com", "nope nope nope")).toBeNull();
    expect(await core.authenticate("nobody@example.com", "correct horse battery")).toBeNull();
  });
});

describe("invites", () => {
  it("are single-use and can be tied to an email", async () => {
    const admin = (await core.listUsers())[0]!;
    const { token } = await core.createInvite(admin.id, { email: "sam@example.com" });
    await expect(core.acceptInvite(token, { name: "Mallory", email: "mallory@example.com", password: "correct horse battery" })).rejects.toThrow("sam@example.com");
    const sam = await core.acceptInvite(token, { name: "Sam", email: "sam@example.com", password: "correct horse battery" });
    expect(sam.role).toBe("member");
    expect(sam.onboardingStep).toBe("search");
    await expect(core.acceptInvite(token, { name: "Sam 2", email: "sam@example.com", password: "correct horse battery" })).rejects.toThrow("expired or was already used");
  });

  it("stop working once revoked", async () => {
    const admin = (await core.listUsers())[0]!;
    const { token, invite } = await core.createInvite(admin.id);
    await core.revokeInvite(invite.id);
    expect(await core.findOpenInvite(token)).toBeNull();
  });

  it("disabling someone signs them out", async () => {
    const sam = (await core.listUsers()).find((u) => u.email === "sam@example.com")!;
    const { token } = await core.createSession(sam.id);
    await core.updateUser(sam.id, { disabled: true });
    expect(await core.userForSession(token)).toBeNull();
    expect(await core.authenticate("sam@example.com", "correct horse battery")).toBeNull();
    expect(await core.activeAdminCount()).toBe(1);
  });
});
