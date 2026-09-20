import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "jd-auth-"));

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

beforeAll(() => {
  // What a single-user install looked like before accounts: rows with no owner.
  const db = getDb();
  db.insert(schema.profile).values({ id: 1, name: "Old Me" }).run();
  db.insert(schema.savedSearch).values({ rawQuery: "staff engineer in NYC", filter, parsedBy: "rules" }).run();
  db.insert(schema.savedSearch).values({ rawQuery: "Staff engineer in NYC ", filter, parsedBy: "rules", notify: true }).run();
  db.insert(schema.savedSearch).values({ rawQuery: "product manager", filter, parsedBy: "rules" }).run();
  db.insert(schema.settings).values({ key: "digest", value: { enabled: true, to: "old@example.com", method: "resend" } }).run();
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
    expect(core.getProfile(admin.id)?.name).toBe("Old Me");
    expect(core.getUserSettings(admin.id, "digest")).toMatchObject({ enabled: true, to: "old@example.com" });
    expect(core.getSettings("mail").method).toBe("resend");

    const searches = getDb().select().from(schema.savedSearch).where(eq(schema.savedSearch.userId, admin.id)).all();
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
    const { token } = core.createSession(u.id);
    expect(core.userForSession(token)?.id).toBe(u.id);
    expect(getDb().select().from(schema.session).all().some((s) => s.id === token)).toBe(false);
    core.deleteSession(token);
    expect(core.userForSession(token)).toBeNull();
  });

  it("rejects wrong passwords and disabled people", async () => {
    expect(await core.authenticate("eric@example.com", "nope nope nope")).toBeNull();
    expect(await core.authenticate("nobody@example.com", "correct horse battery")).toBeNull();
  });
});

describe("invites", () => {
  it("are single-use and can be tied to an email", async () => {
    const admin = core.listUsers()[0]!;
    const { token } = core.createInvite(admin.id, { email: "sam@example.com" });
    await expect(core.acceptInvite(token, { name: "Mallory", email: "mallory@example.com", password: "correct horse battery" })).rejects.toThrow("sam@example.com");
    const sam = await core.acceptInvite(token, { name: "Sam", email: "sam@example.com", password: "correct horse battery" });
    expect(sam.role).toBe("member");
    expect(sam.onboardingStep).toBe("search");
    await expect(core.acceptInvite(token, { name: "Sam 2", email: "sam@example.com", password: "correct horse battery" })).rejects.toThrow("expired or was already used");
  });

  it("stop working once revoked", async () => {
    const admin = core.listUsers()[0]!;
    const { token, invite } = core.createInvite(admin.id);
    core.revokeInvite(invite.id);
    expect(core.findOpenInvite(token)).toBeNull();
  });

  it("disabling someone signs them out", async () => {
    const sam = core.listUsers().find((u) => u.email === "sam@example.com")!;
    const { token } = core.createSession(sam.id);
    core.updateUser(sam.id, { disabled: true });
    expect(core.userForSession(token)).toBeNull();
    expect(await core.authenticate("sam@example.com", "correct horse battery")).toBeNull();
    expect(core.activeAdminCount()).toBe(1);
  });
});
