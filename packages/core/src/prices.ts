import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";
import snapshot from "./model-prices.json" with { type: "json" };

/** USD per million tokens. Cache rates are absolute, not multipliers. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface PriceSnapshot {
  updatedAt: string;
  models: Record<string, ModelPrice>;
}

const OPENROUTER_MODELS = "https://openrouter.ai/api/v1/models";
const LIVE_FILE = () => path.join(dataDir(), "model-prices.json");
const LIVE_MAX_AGE_MS = 7 * 86_400_000;

/**
 * Anthropic's own ids, which the catalogue only carries under an "anthropic/" slug. Prices match
 * the slugs; they are spelled out so a direct-route call costs the same as a routed one.
 */
const ANTHROPIC_ALIASES: Record<string, string> = {
  "claude-haiku-4-5": "anthropic/claude-haiku-4.5",
  "claude-sonnet-5": "anthropic/claude-sonnet-5",
  "claude-opus-5": "anthropic/claude-opus-5",
  "claude-fable-5-1": "anthropic/claude-fable-5.1",
};

/**
 * The id a price is filed under. Responses name models in several spellings — a bare Anthropic id,
 * a dated one ("claude-sonnet-5-20260114"), or an OpenRouter slug — and all three mean one price.
 */
export function normalizeModelId(model: string): string[] {
  const raw = model.trim();
  const afterRoute = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw;
  const bare = afterRoute.toLowerCase();
  const undated = bare.replace(/-\d{8}$/, "");
  const tried = [bare, undated];
  for (const id of [bare, undated]) {
    const alias = ANTHROPIC_ALIASES[id];
    if (alias) tried.push(alias);
    // "claude-sonnet-5" also appears as "anthropic/claude-sonnet-5"; and 4-5 as 4.5.
    if (!id.includes("/")) tried.push(`anthropic/${id}`, `anthropic/${id.replace(/-(\d)-(\d)$/, "-$1.$2")}`);
  }
  return [...new Set(tried)];
}

let cached: { at: number; snap: PriceSnapshot } | null = null;

function live(): PriceSnapshot | null {
  const file = LIVE_FILE();
  try {
    if (cached && Date.now() - cached.at < 60_000) return cached.snap;
    const snap = JSON.parse(fs.readFileSync(file, "utf8")) as PriceSnapshot;
    if (Date.now() - Date.parse(snap.updatedAt) > LIVE_MAX_AGE_MS) return null;
    cached = { at: Date.now(), snap };
    return snap;
  } catch {
    return null;
  }
}

/** What a model costs per million tokens, or null when nothing on file knows it. */
export function priceFor(model: string): ModelPrice | null {
  const tables = [live()?.models, (snapshot as PriceSnapshot).models];
  for (const id of normalizeModelId(model)) {
    for (const table of tables) {
      const hit = table?.[id];
      if (hit) return hit;
    }
  }
  return null;
}

/** The dearest price on file. An unknown model is costed at this, so caps never under-count. */
export function dearestPrice(): ModelPrice {
  const all = Object.values((snapshot as PriceSnapshot).models);
  return all.reduce((worst, p) => (p.input + p.output > worst.input + worst.output ? p : worst), { input: 5, output: 25 });
}

interface CatalogueEntry {
  id: string;
  pricing?: { prompt?: string | null; completion?: string | null; input_cache_read?: string | null; input_cache_write?: string | null };
}

/** Per-token strings scaled to per-million, rounded off the float noise ("0.0999…" → 0.1). */
const perMillion = (v: string | null | undefined): number | null => {
  const n = Number(v);
  return v == null || !Number.isFinite(n) || n < 0 ? null : Number((n * 1e6).toFixed(6));
};

/** Fetches the catalogue and returns it in our shape. Free models (price 0) are kept. */
export async function fetchModelPrices(signal?: AbortSignal): Promise<PriceSnapshot> {
  const res = await fetch(OPENROUTER_MODELS, { signal });
  if (!res.ok) throw new Error(`OpenRouter model catalogue returned ${res.status}`);
  const body = (await res.json()) as { data?: CatalogueEntry[] };
  const models: Record<string, ModelPrice> = {};
  for (const entry of body.data ?? []) {
    const input = perMillion(entry.pricing?.prompt);
    const output = perMillion(entry.pricing?.completion);
    if (input === null || output === null) continue; // "-1" means the router decides
    const cacheRead = perMillion(entry.pricing?.input_cache_read);
    const cacheWrite = perMillion(entry.pricing?.input_cache_write);
    models[entry.id.toLowerCase()] = {
      input,
      output,
      ...(cacheRead === null ? {} : { cacheRead }),
      ...(cacheWrite === null ? {} : { cacheWrite }),
    };
  }
  for (const [bare, slug] of Object.entries(ANTHROPIC_ALIASES)) {
    const p = models[slug];
    if (p) models[bare] = p;
  }
  return { updatedAt: new Date().toISOString(), models };
}

/** Writes a snapshot to `file`. Used by scripts/refresh-prices.ts and by the worker. */
export async function writePriceSnapshot(file: string): Promise<{ count: number; updatedAt: string }> {
  const snap = await fetchModelPrices();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(snap, null, 0)}\n`);
  return { count: Object.keys(snap.models).length, updatedAt: snap.updatedAt };
}

/**
 * Keeps data/model-prices.json current. Called by the worker at startup and daily; failures are
 * logged and ignored, because the committed snapshot is a good enough floor.
 */
export async function refreshModelPrices(): Promise<void> {
  try {
    const { count } = await writePriceSnapshot(LIVE_FILE());
    cached = null;
    console.log(`[prices] refreshed ${count} model prices`);
  } catch (err) {
    console.warn(`[prices] could not refresh model prices: ${err instanceof Error ? err.message : String(err)}`);
  }
}
