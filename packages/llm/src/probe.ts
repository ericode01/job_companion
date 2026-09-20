/**
 * Asks a model whether it can actually do the things this app needs, rather than trusting a spec.
 * Driven by scripts/or-probe.ts:
 *
 *   pnpm tsx scripts/or-probe.ts openrouter:deepseek/deepseek-v4-flash
 *   pnpm tsx scripts/or-probe.ts openrouter:openrouter/auto
 *   pnpm tsx scripts/or-probe.ts openrouter:google/gemini-2.5-flash-lite --search
 *
 * Each check is one small request, so a whole run costs cents. `search` adds a web-search turn:
 * that one is the gate for moving company research off Anthropic, because it reports every
 * content-block type and every URL the source-verification code would be able to find.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { forModel, parseStructured } from "./client";

const Shape = z.object({
  company: z.string(),
  headcount: z.number().nullable(),
  tags: z.array(z.string()),
});

export interface ProbeResult {
  check: string;
  ok: boolean;
  detail: string;
}

/** OpenRouter adds these to usage; the SDK's types don't know about them. */
const extras = (usage: unknown) => usage as { cost?: number; cache_read_input_tokens?: number | null };

export async function probeModel(setting: string, opts: { search?: boolean } = {}): Promise<ProbeResult[]> {
  const { client, model, route } = forModel(setting);
  const results: ProbeResult[] = [];

  const check = async (name: string, run: () => Promise<string>): Promise<void> => {
    const started = Date.now();
    try {
      const detail = await run();
      results.push({ check: name, ok: true, detail: `${detail} (${Date.now() - started}ms)` });
    } catch (err) {
      results.push({ check: name, ok: false, detail: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    }
  };

  await check("plain message", async () => {
    const res = await client.messages.create({ model, max_tokens: 64, messages: [{ role: "user", content: "Reply with the single word: ready" }] });
    const block = res.content.find((b) => b.type === "text");
    return `answered "${block && "text" in block ? block.text.trim().slice(0, 40) : "(no text)"}" as ${res.model}`;
  });

  await check("structured output fills parsed_output", async () => {
    const res = await client.messages.parse({
      model,
      max_tokens: 500,
      messages: [{ role: "user", content: "Acme Corp has 420 staff and works on payments and fraud. Fill the schema." }],
      output_config: { format: zodOutputFormat(Shape) },
    });
    const native = res.parsed_output !== undefined && res.parsed_output !== null;
    // parseStructured is what the app uses, so this exercises the fallback path too.
    const value = parseStructured(res, Shape, "probe shape");
    return `${native ? "parsed_output populated" : "parsed_output EMPTY — fell back to JSON in the text block"}; got ${JSON.stringify(value)}`;
  });

  await check("streaming finalMessage", async () => {
    const res = await client.messages.stream({ model, max_tokens: 64, messages: [{ role: "user", content: "Count to three." }] }).finalMessage();
    return `stop_reason ${res.stop_reason}, ${res.usage.output_tokens} output tokens`;
  });

  await check("usage reports a cost", async () => {
    const res = await client.messages.create({ model, max_tokens: 32, messages: [{ role: "user", content: "Say hi." }] });
    const cost = extras(res.usage).cost;
    if (typeof cost !== "number") throw new Error("no usage.cost — spend will be estimated from the price table instead");
    return `$${cost.toFixed(8)} for ${res.usage.input_tokens} in / ${res.usage.output_tokens} out`;
  });

  await check("cache_control accepted", async () => {
    const res = await client.messages.create({
      model,
      max_tokens: 32,
      system: [{ type: "text", text: `Reference material: ${"lorem ipsum ".repeat(200)}`, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "Say hi." }],
    });
    return `accepted; cache_read=${extras(res.usage).cache_read_input_tokens ?? 0}`;
  });

  if (opts.search) {
    await check("web search leaves verifiable sources", async () => {
      const tools =
        route === "anthropic"
          ? [{ type: "web_search_20250305" as const, name: "web_search" as const, max_uses: 2 }]
          : ([{ type: "openrouter:web_search", parameters: { engine: "parallel", max_results: 3, max_characters: 1000 } }] as never[]);
      const res = await client.messages
        .stream({ model, max_tokens: 2000, tools, messages: [{ role: "user", content: "What does Stripe do, and when was it founded? Cite your sources." }] })
        .finalMessage();
      const types = [...new Set(res.content.map((b) => b.type))];
      // Exactly what collectConsultedUrls looks for, so a pass here means research could move.
      const urls = new Set<string>();
      for (const block of res.content) {
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) for (const r of block.content) urls.add(r.url);
        if (block.type === "text") for (const c of block.citations ?? []) if ("url" in c && typeof c.url === "string") urls.add(c.url);
      }
      if (urls.size === 0) throw new Error(`no verifiable URLs; blocks were [${types.join(", ")}] — research here would produce unsourced facts`);
      return `blocks [${types.join(", ")}], ${urls.size} verifiable URLs, e.g. ${[...urls][0]}`;
    });
  }

  return results;
}
