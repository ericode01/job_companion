import { describe, expect, it } from "vitest";

// Behaviour that changed meaning when the database moved from SQLite to Postgres.

const { useTestDb } = await import("../src/testing");
await useTestDb("jd-core-pg-");

const core = await import("../src");

describe("the task queue", () => {
  it("gives concurrent claimers different tasks, and the one left over nothing", async () => {
    await core.enqueueTask("analyze_job", "job:1", {}, { background: true });
    await core.enqueueTask("analyze_job", "job:2", {}, { background: true });
    const claims = await Promise.all([1, 2, 3].map(() => core.claimTask(["analyze_job"])));
    expect(claims.filter((t) => t !== null).map((t) => t!.key).sort()).toEqual(["job:1", "job:2"]);
    expect(claims.filter((t) => t === null)).toHaveLength(1);
  });

  it("counts the tasks it puts back, from RETURNING rather than SQLite's .changes", async () => {
    expect(await core.requeueInterruptedTasks()).toBe(2);
  });

  it("allows one live task per (kind, key), however many finished ones share it", async () => {
    // Synchronous SQLite made "look, then insert" atomic; with awaits in between, two callers can both
    // look and both insert. The index is what keeps the work from being queued twice.
    const { getDb, schema } = await import("../src/db");
    const live = { kind: "score_fit" as const, key: "fit:1:abc", payload: {}, background: true };
    await getDb().insert(schema.task).values([
      { ...live, status: "done" },
      { ...live, status: "failed" },
      { ...live, status: "queued" },
    ]);
    await expect(getDb().insert(schema.task).values({ ...live, status: "running" })).rejects.toThrow();
    // And enqueueTask hands back the live one instead of adding another.
    const again = await core.enqueueTask("score_fit", "fit:1:abc", {}, { background: true });
    expect(again.status).toBe("queued");
  });
});

describe("AI spend", () => {
  it("adds up as numbers: node-postgres reads sums and counts as strings unless told otherwise", async () => {
    await core.recordUsage({ purpose: "test", model: "claude-haiku-4-5", inputTokens: 0, outputTokens: 0, costUsd: 0.25 });
    await core.recordUsage({ purpose: "test", model: "claude-haiku-4-5", inputTokens: 0, outputTokens: 0, costUsd: 0.5 });
    const status = await core.getSpendStatus();
    expect(status.todayUsd).toBe(0.75);
    const [row] = await core.spendByUser();
    expect(row).toMatchObject({ usd: 0.75, calls: 2 });
  });
});
