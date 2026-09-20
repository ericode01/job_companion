"use client";

import type { SearchFilter } from "@jd/core/shared";
import { ArrowRight, Globe2, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { useId, useState } from "react";
import { FilterEditor } from "@/components/FilterEditor";
import { Alert } from "@/components/ui";
import { describeFilter } from "@/lib/filters";

interface Parsed {
  filter: SearchFilter;
  parsedBy: "llm" | "rules";
  warning?: string;
}

const EXAMPLES = ["senior or staff engineer in NYC", "product manager in NYC", "ML engineer, remote"];

/**
 * "What are you looking for?" → Claude reads it into a filter → you check it → a dashboard.
 * Used by onboarding and by "New job search".
 */
export function NewSearchForm({
  defaultRemote,
  submitLabel = "Create dashboard",
  onCreated,
}: {
  defaultRemote: boolean;
  submitLabel?: string;
  onCreated: (id: number) => void;
}) {
  const ids = { query: useId(), remote: useId(), name: useId() };
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState(defaultRemote);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [parseKey, setParseKey] = useState(0);
  const [name, setName] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [busy, setBusy] = useState<"parse" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function parse(q = query, includeRemoteUS = remote) {
    if (q.trim().length < 2) return;
    setBusy("parse");
    setError(null);
    const res = await fetch("/api/search/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: q, includeRemoteUS }),
    });
    const body = await res.json();
    setBusy(null);
    if (!res.ok) {
      setError(body.error ?? "Couldn't read that. Try rephrasing it.");
      return;
    }
    setParsed(body);
    setParseKey((k) => k + 1);
    setName(q.charAt(0).toUpperCase() + q.slice(1));
  }

  async function create() {
    if (!parsed) return;
    setBusy("create");
    setError(null);
    const res = await fetch("/api/searches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rawQuery: query, name: name.trim() || null, filter: parsed.filter, parsedBy: parsed.parsedBy }),
    });
    const body = await res.json();
    if (!res.ok) {
      setBusy(null);
      setError(body.error ?? "Couldn't create the search. Try again.");
      return;
    }
    onCreated(body.id);
  }

  return (
    <div className="space-y-5">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void parse();
        }}
      >
        <label htmlFor={ids.query} className="block text-sm font-semibold">
          What are you looking for?
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted" />
            <input
              id={ids.query}
              className="input min-h-12 pl-10 text-base"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setParsed(null);
              }}
              placeholder="e.g. senior or staff engineer in NYC"
              autoComplete="off"
              autoFocus
            />
          </div>
          <button className="btn-primary min-h-12 px-5 text-base" disabled={busy !== null || query.trim().length < 2}>
            {busy === "parse" ? "Reading…" : "Continue"}
            <ArrowRight aria-hidden className="size-4" />
          </button>
        </div>
        <label htmlFor={ids.remote} className="flex min-h-10 items-start gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm">
          <input
            id={ids.remote}
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--accent)]"
            checked={remote}
            onChange={(e) => {
              setRemote(e.target.checked);
              if (parsed) void parse(query, e.target.checked);
            }}
          />
          <span>
            <span className="flex items-center gap-1.5 font-medium">
              <Globe2 aria-hidden className="size-4 text-accent" /> Include remote positions
            </span>
            <span className="text-muted">Remote roles open to people in the US also count as a match for a city.</span>
          </span>
        </label>
        {!parsed && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Try</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                className="chip min-h-8 border border-border bg-surface px-3 text-text transition-colors hover:border-accent hover:text-accent"
                onClick={() => {
                  setQuery(ex);
                  void parse(ex);
                }}
              >
                {ex}
              </button>
            ))}
          </div>
        )}
      </form>

      {error && <Alert>{error}</Alert>}

      {parsed && (
        <section aria-labelledby="read-as" className="companion space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="read-as" className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles aria-hidden className="size-4 text-accent" />
                {parsed.parsedBy === "llm" ? "Here's how I read that" : "Read with built-in rules"}
              </h2>
              <p className="mt-1 text-base font-medium first-letter:uppercase">{describeFilter(parsed.filter)}</p>
            </div>
            <button className="btn-ghost" onClick={() => setShowDetails((s) => !s)} aria-expanded={showDetails}>
              <SlidersHorizontal aria-hidden className="size-4" /> {showDetails ? "Hide details" : "Adjust"}
            </button>
          </div>
          {parsed.warning && <Alert>{parsed.warning}</Alert>}
          {showDetails && <FilterEditor key={parseKey} filter={parsed.filter} onChange={(filter) => setParsed({ ...parsed, filter })} />}
          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor={ids.name} className="label">
                Dashboard name
              </label>
              <input id={ids.name} className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </div>
            <button className="btn-primary min-h-10" onClick={create} disabled={busy !== null || parsed.filter.roleKeywords.length === 0}>
              {busy === "create" ? "Creating…" : submitLabel}
              <ArrowRight aria-hidden className="size-4" />
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
