import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

const { useTestDb } = await import("@jd/core/testing");
await useTestDb("jd-llm-");

const { AI_KEY_HINT, forModel, hasApiKey, hasKeyFor, LlmOutputError, LlmUnavailableError, parseModel, parseStructured, routingPrefs } = await import("../src/client");
const { saveSettings } = await import("@jd/core");

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-anthropic";
  process.env.OPENROUTER_API_KEY = "test-openrouter";
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});

describe("reading a model setting", () => {
  it("splits the provider from the model id, leaving the id alone", () => {
    expect(parseModel("anthropic:claude-sonnet-5")).toEqual({ route: "anthropic", model: "claude-sonnet-5" });
    // The model id keeps its own slashes: OpenRouter's ids are vendor/model.
    expect(parseModel("openrouter:deepseek/deepseek-v4-flash")).toEqual({ route: "openrouter", model: "deepseek/deepseek-v4-flash" });
    // The case that slashes alone can't express: Claude, but billed and routed by OpenRouter.
    expect(parseModel("openrouter:anthropic/claude-haiku-4.5")).toEqual({ route: "openrouter", model: "anthropic/claude-haiku-4.5" });
    // OpenRouter's own router. The repetition is real, not a typo.
    expect(parseModel("openrouter:openrouter/auto")).toEqual({ route: "openrouter", model: "openrouter/auto" });
  });

  it("treats an unqualified id as Anthropic, so settings saved before routes existed still work", () => {
    expect(parseModel("claude-haiku-4-5")).toEqual({ route: "anthropic", model: "claude-haiku-4-5" });
  });

  it("refuses a provider it can't reach rather than guessing one", () => {
    expect(() => parseModel("bedrock:claude-sonnet-5")).toThrow(LlmUnavailableError);
    expect(() => parseModel("openrouter:")).toThrow(/no model/);
  });
});

describe("picking a client", () => {
  it("sends routed models to OpenRouter and the rest to Anthropic", () => {
    expect(forModel("openrouter:deepseek/deepseek-v4-flash").client.baseURL).toContain("openrouter.ai");
    expect(forModel("anthropic:claude-sonnet-5").client.baseURL).toContain("anthropic.com");
  });

  it("only the part after the provider goes on the wire", () => {
    expect(forModel("openrouter:openrouter/auto").model).toBe("openrouter/auto");
    expect(forModel("anthropic:claude-sonnet-5").model).toBe("claude-sonnet-5");
  });

  it("names the key that is missing, not just 'no API key'", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(() => forModel("openrouter:deepseek/deepseek-v4-flash")).toThrow(/OPENROUTER_API_KEY/);
    expect(hasKeyFor("openrouter:deepseek/deepseek-v4-flash")).toBe(false);
    // The other provider still works, and AI as a whole is still on.
    expect(hasKeyFor("anthropic:claude-sonnet-5")).toBe(true);
    expect(hasApiKey()).toBe(true);
    expect(AI_KEY_HINT).toContain("OPENROUTER_API_KEY");
  });

  it("is off only when no provider has a key", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    expect(hasApiKey()).toBe(false);
  });
});

describe("the fields OpenRouter needs and the SDK doesn't know about", () => {
  it("pins no-logging providers on every routed request", async () => {
    const body = await routingPrefs({ model: "deepseek/deepseek-v4-flash", messages: [] });
    expect(body.provider).toMatchObject({ data_collection: "deny", require_parameters: true });
  });

  it("asks for the auto-router only when the model is the auto-router", async () => {
    expect((await routingPrefs({ model: "openrouter/auto", messages: [] })).plugins).toEqual([{ id: "auto-router", cost_tier: "low" }]);
    expect((await routingPrefs({ model: "deepseek/deepseek-v4-flash", messages: [] })).plugins).toBeUndefined();
  });

  it("carries the admin's cost tier and price ceiling", async () => {
    await saveSettings("ai", { autoRouter: { costTier: "medium", maxPromptUsd: 0.25, maxCompletionUsd: null, excludedModels: ["openai/*"] } });
    const body = await routingPrefs({ model: "openrouter/auto", messages: [] });
    expect(body.plugins).toEqual([{ id: "auto-router", cost_tier: "medium", excluded_models: ["openai/*"] }]);
    // A null ceiling is "no ceiling", so it must not be sent as a bound.
    expect(body.provider).toMatchObject({ max_price: { prompt: "0.25" } });
    expect((body.provider as { max_price: Record<string, string> }).max_price.completion).toBeUndefined();
    await saveSettings("ai", { autoRouter: {} });
  });

  it("pins the temperature when a schema is being filled, and leaves free text alone", async () => {
    // Open-weight models default near 1.0, which invents fields.
    expect((await routingPrefs({ model: "x", output_config: { format: {} } })).temperature).toBe(0);
    expect((await routingPrefs({ model: "x", output_config: { effort: "medium" } })).temperature).toBeUndefined();
    expect((await routingPrefs({ model: "x" })).temperature).toBeUndefined();
    // An explicit temperature is the caller's business.
    expect((await routingPrefs({ model: "x", output_config: { format: {} }, temperature: 0.7 })).temperature).toBe(0.7);
  });
});

describe("reading structured output back", () => {
  const Schema = z.object({ score: z.number(), verdict: z.string() });
  const good = { score: 72, verdict: "strong" };

  it("takes the SDK's parsed output when there is one", () => {
    expect(parseStructured({ content: [], parsed_output: good }, Schema, "fit")).toEqual(good);
  });

  it("accepts JSON written into a text block, which is how other providers often answer", () => {
    const asText = { content: [{ type: "text" as const, text: `Here you go:\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\``, citations: null }] };
    expect(parseStructured(asText, Schema, "fit")).toEqual(good);
  });

  it("ignores output that doesn't fit the schema rather than half-reading it", () => {
    const wrong = { content: [{ type: "text" as const, text: JSON.stringify({ score: "seventy-two" }), citations: null }], model: "deepseek/deepseek-v4-flash" };
    expect(() => parseStructured(wrong, Schema, "fit assessment")).toThrow(LlmOutputError);
    // The message has to name the model, or a bad default is untraceable.
    expect(() => parseStructured(wrong, Schema, "fit assessment")).toThrow(/deepseek-v4-flash.*fit assessment/);
  });

  it("gives up on prose", () => {
    expect(() => parseStructured({ content: [{ type: "text" as const, text: "I can't do that.", citations: null }] }, Schema, "fit")).toThrow(LlmOutputError);
  });
});
