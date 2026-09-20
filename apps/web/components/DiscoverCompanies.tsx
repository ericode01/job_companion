"use client";

import { Check, CircleSlash, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Alert } from "@/components/ui";

interface Candidate {
  name: string;
  domain: string | null;
  why: string | null;
  sourceUrl: string | null;
  boardUrl: string | null;
  status: "pending" | "added" | "exists" | "no_board" | "error";
  atsType: string | null;
  atsSlug: string | null;
  openJobs: number | null;
  companyId: number | null;
  note: string | null;
}
interface Run {
  id: number;
  prompt: string;
  status: "running" | "done" | "failed";
  candidates: Candidate[];
  added: number;
  error: string | null;
  createdAt: string;
}
interface SavedSearch {
  id: number;
  rawQuery: string;
}

const STATUS: Record<Candidate["status"], { label: string; className: string; icon: React.ReactNode }> = {
  pending: { label: "Checking…", className: "text-muted", icon: <Loader2 aria-hidden className="size-4 animate-spin" /> },
  added: { label: "Added", className: "text-good", icon: <Check aria-hidden className="size-4" /> },
  exists: { label: "Already tracked", className: "text-muted", icon: <Check aria-hidden className="size-4" /> },
  no_board: { label: "No job board found", className: "text-muted", icon: <CircleSlash aria-hidden className="size-4" /> },
  error: { label: "Couldn't check", className: "text-warn", icon: <TriangleAlert aria-hidden className="size-4" /> },
};

/**
 * Asks Claude for companies worth watching, then adds the ones whose job board can actually be
 * found and read. Every row shows what happened, so nothing is added silently.
 */
export function DiscoverCompanies({ onAdded }: { onAdded: () => void }) {
  const promptId = useId();
  const searchId = useId();
  const [prompt, setPrompt] = useState("");
  const [search, setSearch] = useState("");
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(true);

  const loadRuns = async () => {
    const body = (await fetch("/api/companies/discover").then((r) => r.json())) as { runs: Run[]; hasApiKey: boolean };
    setHasApiKey(body.hasApiKey);
    setRun(body.runs[0] ?? null);
    return body.runs[0] ?? null;
  };

  useEffect(() => {
    void loadRuns();
    void fetch("/api/searches")
      .then((r) => r.json())
      .then(setSearches);
  }, []);

  useEffect(() => {
    if (run?.status !== "running") return;
    const t = setInterval(async () => {
      const latest = await loadRuns();
      if (latest?.status !== "running") onAdded();
    }, 2000);
    return () => clearInterval(t);
  }, [run?.status, onAdded]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setStarting(true);
    setError(null);
    const res = await fetch("/api/companies/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: prompt.trim() || undefined, searchId: search ? Number(search) : undefined }),
    });
    const body = await res.json();
    setStarting(false);
    if (!res.ok) {
      setError(body.error ?? "Could not start the search.");
      return;
    }
    setRun(body.run);
  }

  const running = run?.status === "running";

  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <Sparkles aria-hidden className="size-4 text-accent" />
          Find new companies
        </h2>
        <p className="helper">
          Claude searches the web for companies that fit, then each one&apos;s careers page is read to find its job board.
          Only companies with a board that really lists jobs are added.
        </p>
      </div>

      {!hasApiKey && <Alert>Set an AI API key in .env.local to use this.</Alert>}

      <form onSubmit={start} className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor={searchId} className="label">
              Base it on a saved search
            </label>
            <select id={searchId} className="input" value={search} onChange={(e) => setSearch(e.target.value)}>
              <option value="">None</option>
              {searches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.rawQuery}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={promptId} className="label">
              Or describe what to look for
            </label>
            <input
              id={promptId}
              className="input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Series B–D fintech companies in New York"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={starting || running || !hasApiKey || (!prompt.trim() && !search)}>
            {starting || running ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Sparkles aria-hidden className="size-4" />}
            {running ? "Searching…" : "Find companies"}
          </button>
          {error && <p className="field-error text-sm">{error}</p>}
        </div>
      </form>

      {run && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-sm text-muted">
            {run.status === "failed"
              ? `Search failed: ${run.error ?? "unknown error"}`
              : running
                ? `Looking for: ${run.prompt}`
                : `${run.added} added from ${run.candidates.length} candidates`}
          </p>
          <ul className="divide-y divide-border text-sm">
            {run.candidates.map((c) => {
              const s = STATUS[c.status];
              return (
                <li key={`${c.name}-${c.domain}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2">
                  <span className={`inline-flex items-center gap-1 self-center ${s.className}`} title={c.note ?? undefined}>
                    {s.icon}
                  </span>
                  {c.companyId ? (
                    <Link href={`/companies/${c.companyId}`} className="font-medium hover:text-accent">
                      {c.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{c.name}</span>
                  )}
                  {c.domain && <span className="text-muted">{c.domain}</span>}
                  <span className={`chip ${c.status === "added" ? "bg-accent-soft text-accent" : ""}`}>
                    {s.label}
                    {c.status === "added" && c.openJobs !== null ? ` · ${c.openJobs} roles` : ""}
                  </span>
                  {c.why && <span className="w-full text-muted sm:w-auto">{c.why}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
