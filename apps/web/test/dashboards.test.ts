import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { useTestDb } = await import("@jd/core/testing");
await useTestDb("jd-web-");

const core = await import("@jd/core");
const { getDb, returned, schema } = await import("@jd/core/db");
const { companionSteps } = await import("../lib/dashboards");

const filter = { roleKeywords: ["engineer"], levelKeywords: [], excludeKeywords: [], locations: [], includeRemoteUS: true, remoteOnly: false, postedWithinDays: 30 };

describe("companion steps", () => {
  it("flags applications left in Applying for two days", async () => {
    // This compared updated_at with epoch milliseconds in raw SQL, which only worked while SQLite
    // stored times as numbers; on Postgres it failed the whole dashboard.
    const user = core.toPublicUser(await core.createFirstAdmin({ name: "Me", email: "me@example.com", password: "correct horse battery", timezone: "UTC" }));
    const db = getDb();
    const dashboard = await returned(db.insert(schema.savedSearch).values({ userId: user.id, rawQuery: "engineer", filter, parsedBy: "rules" }).returning());
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    await db.insert(schema.application).values([
      { userId: user.id, companyName: "Acme", jobTitle: "Engineer", status: "applying", source: "manual", updatedAt: threeDaysAgo },
      { userId: user.id, companyName: "Beta", jobTitle: "Engineer", status: "applying", source: "manual" }, // started today
    ]);
    const steps = await companionSteps(user, dashboard, { newStrong: 0, newCount: 0 });
    expect(steps.find((s) => s.id === "stalled")?.title).toBe("1 application is still in progress");
  });
});
