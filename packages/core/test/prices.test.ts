import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "jd-prices-"));

const { dearestPrice, estimateCostUsd, getSettings, isEstimatedModel, normalizeModelId, priceFor, reconcileAiSettings, saveSettings } = await import("../src");
const { getDb, schema } = await import("../src/db");
const { eq } = await import("drizzle-orm");

const base = { purpose: "test", inputTokens: 1_000_000, outputTokens: 1_000_000 };

describe("pricing a model", () => {
  it("knows both spellings of the same Anthropic model", () => {
    expect(priceFor("claude-haiku-4-5")).toMatchObject({ input: 1, output: 5 });
    expect(priceFor("anthropic/claude-haiku-4.5")).toMatchObject({ input: 1, output: 5 });
    // Responses name the dated build; that is the same model and the same price.
    expect(priceFor("claude-sonnet-5-20260114")).toMatchObject({ input: 2, output: 10 });
    // A setting still carrying its route resolves too.
    expect(priceFor("openrouter:deepseek/deepseek-v4-flash")?.input).toBeLessThan(0.1);
  });

  it("tries the spellings in a sensible order", () => {
    expect(normalizeModelId("anthropic:claude-haiku-4-5")).toContain("anthropic/claude-haiku-4.5");
    expect(normalizeModelId("Claude-Sonnet-5-20260114")).toContain("claude-sonnet-5");
  });

  it("costs the cheap models in cents, not dollars", () => {
    // The whole point of the change: a million tokens each way.
    expect(estimateCostUsd({ ...base, model: "claude-haiku-4-5" })).toBeCloseTo(6, 5);
    expect(estimateCostUsd({ ...base, model: "deepseek/deepseek-v4-flash" })).toBeLessThan(0.2);
  });

  it("uses a model's own cache rates when it has them", () => {
    const withCache = { ...base, model: "claude-haiku-4-5", inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 };
    // Haiku: $0.10 read + $1.25 write per million.
    expect(estimateCostUsd(withCache)).toBeCloseTo(1.35, 5);
  });

  it("charges an unknown model at the dearest price rather than treating it as free", () => {
    // A cap is a safety device: under-counting an unrecognised model would disable it.
    const unknown = estimateCostUsd({ ...base, model: "some-vendor/model-we-have-never-seen" });
    expect(unknown).toBeCloseTo(dearestPrice().input + dearestPrice().output, 5);
    expect(isEstimatedModel("some-vendor/model-we-have-never-seen")).toBe(true);
    expect(isEstimatedModel("claude-haiku-4-5")).toBe(false);
  });

  it("still adds Anthropic's per-search fee", () => {
    const searched = { ...base, model: "claude-haiku-4-5", inputTokens: 0, outputTokens: 0, webSearchRequests: 5 };
    expect(estimateCostUsd(searched)).toBeCloseTo(0.05, 5);
  });
});

describe("recording what a call cost", () => {
  const rows = () => getDb().select().from(schema.llmUsage).all();

  it("bills what the provider says it charged, in preference to any estimate", async () => {
    const { recordUsage } = await import("../src/usage");
    recordUsage({ ...base, model: "deepseek/deepseek-v4-flash", costUsd: 0.000123 });
    const row = rows().at(-1)!;
    expect(row.costUsd).toBeCloseTo(0.000123, 9);
  });

  it("falls back to the estimate when the provider is silent, as Anthropic is", async () => {
    const { recordUsage } = await import("../src/usage");
    recordUsage({ ...base, model: "claude-haiku-4-5" });
    expect(rows().at(-1)!.costUsd).toBeCloseTo(6, 5);
  });
});

describe("settings saved before providers were named", () => {
  it("rewrites bare model ids once, and leaves qualified ones alone", () => {
    saveSettings("ai", { models: { fitScore: "claude-haiku-4-5", research: "anthropic:claude-sonnet-5" } });
    // saveSettings validates but doesn't rewrite: the stored row is still the legacy spelling.
    expect(getSettings("ai").models.fitScore).toBe("claude-haiku-4-5");

    reconcileAiSettings();
    const after = getSettings("ai").models;
    expect(after.fitScore).toBe("anthropic:claude-haiku-4-5");
    expect(after.research).toBe("anthropic:claude-sonnet-5");

    // Idempotent: a second pass changes nothing.
    const before = getDb().select().from(schema.settings).where(eq(schema.settings.key, "ai")).get()!.updatedAt;
    reconcileAiSettings();
    expect(getDb().select().from(schema.settings).where(eq(schema.settings.key, "ai")).get()!.updatedAt).toEqual(before);
  });

  /** A row as an older build wrote it: only the purposes that existed then, unqualified. */
  const storeLegacyRow = () =>
    getDb()
      .insert(schema.settings)
      .values({ key: "ai", value: { models: { fitScore: "claude-haiku-4-5", research: "claude-sonnet-5" }, dailyCapUsd: 10 } })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: { models: { fitScore: "claude-haiku-4-5", research: "claude-sonnet-5" }, dailyCapUsd: 10 } } })
      .run();

  it("doesn't move an untouched purpose onto a provider this server has no key for", () => {
    // emailClassify arrived after this install last saved its settings. Adopting its OpenRouter
    // default with no key would quietly drop mailbox sorting back to rules-only.
    delete process.env.OPENROUTER_API_KEY;
    storeLegacyRow();
    reconcileAiSettings();
    const models = getSettings("ai").models;
    expect(models.emailClassify).toBe("anthropic:claude-haiku-4-5");
    expect(models.fitScore).toBe("anthropic:claude-haiku-4-5");
    // The caps the admin set survive untouched.
    expect(getSettings("ai").dailyCapUsd).toBe(10);
  });

  it("takes the new cheap defaults once the key is there", () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    storeLegacyRow();
    reconcileAiSettings();
    // Which model is a judgement call that measurement can change; that it is adopted is the rule.
    expect(getSettings("ai").models.emailClassify).toMatch(/^openrouter:/);
    // A purpose the admin did choose is still respected, just spelled out.
    expect(getSettings("ai").models.research).toBe("anthropic:claude-sonnet-5");
    delete process.env.OPENROUTER_API_KEY;
  });
});
