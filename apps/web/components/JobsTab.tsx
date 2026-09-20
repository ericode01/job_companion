"use client";

import type { SearchResult } from "@jd/sources";
import { ExternalLink, Globe2, RefreshCw, SlidersHorizontal, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitBadge } from "@/components/Status";
import { Alert, EmptyState, SkeletonList } from "@/components/ui";
import { formatComp, timeAgo } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/types";

type Result = Omit<SearchResult, "postedAt" | "firstSeenAt"> & {
  postedAt: string | null;
  firstSeenAt: string;
  fitScore: number | null;
  isNew: boolean;
  applicationStatus: keyof typeof STATUS_LABELS | null;
};
interface Crawl {
  status: "running" | "done" | "failed";
  total: number;
  done: number;
}
interface Data {
  results: Result[];
  newSince: string;
  fit: { resumeReady: boolean; scored: number; total: number; limit: number; pending: number };
  crawl: Crawl | null;
}

const SORTS = { newest: "Newest first", fit: "Best fit first", pay: "Highest pay first" } as const;
type Sort = keyof typeof SORTS;
const WHERE = { all: "All", local: "In location", remote: "Remote (US)" } as const;
type Where = keyof typeof WHERE;
const FITS = { "0": "Any fit", "70": "Good or better (70+)", "80": "Strong (80+)" } as const;

export function JobsTab({ dashboardId }: { dashboardId: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // View options live in the URL so Back, reloads and the companion's links restore them.
  const sort = (params.get("sort") as Sort) in SORTS ? (params.get("sort") as Sort) : "newest";
  const where = (params.get("where") as Where) in WHERE ? (params.get("where") as Where) : "all";
  const minFit = Number(params.get("fit") ?? 0) || 0;
  const payOnly = params.get("pay") === "1";
  const newOnly = params.get("new") === "1";
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const since = useRef<string | null>(null);

  const load = useCallback(async () => {
    // The first load counts as a visit (resetting the "new" count for next time); later polls
    // reuse its cut-off so what was new when you arrived stays marked New.
    const q = since.current ? `?since=${encodeURIComponent(since.current)}` : "?view=1";
    const res = await fetch(`/api/searches/${dashboardId}${q}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Couldn't load this search.");
    since.current ??= body.newSince;
    setData(body);
    return body as Data;
  }, [dashboardId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const tick = async () => {
      try {
        const d = await load();
        const crawling = d.crawl?.status === "running";
        if (!cancelled && (crawling || d.fit.pending > 0)) timer = setTimeout(tick, crawling ? 2500 : 5000);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load]);

  const shown = useMemo(() => {
    if (!data) return [];
    let rows = data.results;
    if (where !== "all") rows = rows.filter((r) => (where === "remote" ? r.matchReason === "remote_us" : r.matchReason === "location"));
    if (payOnly) rows = rows.filter((r) => r.comp?.max || r.comp?.min);
    if (newOnly) rows = rows.filter((r) => r.isNew);
    if (minFit) rows = rows.filter((r) => (r.fitScore ?? -1) >= minFit);
    if (sort === "fit") rows = [...rows].sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1));
    if (sort === "pay") rows = [...rows].sort((a, b) => (b.comp?.max ?? b.comp?.min ?? 0) - (a.comp?.max ?? a.comp?.min ?? 0));
    return rows;
  }, [data, where, payOnly, newOnly, minFit, sort]);

  if (error && !data) return <Alert>{error}</Alert>;
  if (!data) return <SkeletonList rows={8} />;

  const { crawl, fit } = data;
  const localCount = data.results.filter((r) => r.matchReason === "location").length;
  const newCount = data.results.filter((r) => r.isNew).length;
  const counts: Record<Where, number> = { all: data.results.length, local: localCount, remote: data.results.length - localCount };
  const filtered = where !== "all" || payOnly || newOnly || minFit > 0;
  const activeFilters = (where !== "all" ? 1 : 0) + (payOnly ? 1 : 0) + (newOnly ? 1 : 0) + (minFit > 0 ? 1 : 0) + (sort !== "newest" ? 1 : 0);

  return (
    <div className="space-y-4">
      {crawl?.status === "running" && (
        <div role="status" className="card flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
          <RefreshCw aria-hidden className="size-4 animate-spin text-accent" />
          <span>
            Checking job boards <span className="tabular-nums">{crawl.done}/{crawl.total}</span>. Results update as they come in.
          </span>
          <div className="ml-auto h-1.5 w-40 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${crawl.total ? (crawl.done / crawl.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {/* On a phone the controls pushed the first job off the screen, so they fold away. */}
      <button
        type="button"
        className="btn min-h-11 sm:hidden"
        aria-expanded={filtersOpen}
        aria-controls="job-filters"
        onClick={() => setFiltersOpen((o) => !o)}
      >
        <SlidersHorizontal aria-hidden className="size-4" /> Filters
        {activeFilters > 0 && <span className="chip bg-accent-soft text-accent tabular-nums">{activeFilters}</span>}
      </button>

      <div id="job-filters" className={`${filtersOpen ? "flex" : "hidden"} flex-wrap items-center gap-2 text-sm sm:flex`}>
        <div role="group" aria-label="Location" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {(Object.keys(WHERE) as Where[]).map((w) => (
            <button
              key={w}
              aria-pressed={where === w}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 font-medium transition-colors ${
                where === w ? "bg-accent-soft text-accent" : "text-muted hover:text-text"
              }`}
              onClick={() => setParam("where", w === "all" ? null : w)}
            >
              {WHERE[w]} <span className="tabular-nums opacity-80">{counts[w]}</span>
            </button>
          ))}
        </div>
        <button
          aria-pressed={newOnly}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 font-medium transition-colors ${
            newOnly ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-muted hover:text-text"
          }`}
          onClick={() => setParam("new", newOnly ? null : "1")}
        >
          New <span className="tabular-nums opacity-80">{newCount}</span>
        </button>
        <label className="flex min-h-9 items-center gap-2 px-1 text-muted">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={payOnly} onChange={(e) => setParam("pay", e.target.checked ? "1" : null)} />
          Pay listed
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-muted">
            <span className="sr-only">Minimum fit</span>
            <select className="input w-auto" value={String(minFit)} disabled={!fit.resumeReady} onChange={(e) => setParam("fit", e.target.value === "0" ? null : e.target.value)}>
              {Object.entries(FITS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-muted">
            <span className="sr-only">Sort</span>
            <select className="input w-auto" value={sort} onChange={(e) => setParam("sort", e.target.value === "newest" ? null : e.target.value)}>
              {(Object.keys(SORTS) as Sort[]).map((s) => (
                <option key={s} value={s} disabled={s === "fit" && !fit.resumeReady}>
                  {SORTS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted" role="status">
        <span className="tabular-nums">
          {shown.length === data.results.length ? `${data.results.length} jobs` : `Showing ${shown.length} of ${data.results.length} jobs`}
        </span>
        {fit.resumeReady ? (
          (fit.pending > 0 || fit.scored < Math.min(fit.total, fit.limit)) && (
            <>
              <span aria-hidden>·</span>
              <Sparkles aria-hidden className="size-3.5 text-accent" />
              Fit scored for <span className="tabular-nums">{fit.scored}</span> of <span className="tabular-nums">{Math.min(fit.total, fit.limit)}</span>
              {fit.pending > 0 ? ", more on the way" : ""}
            </>
          )
        ) : (
          <>
            <span aria-hidden>·</span>
            <Link href="/profile#resume" className="font-medium text-accent hover:underline">
              Add your resume
            </Link>
            to see how well each job fits you.
          </>
        )}
      </p>

      {shown.length === 0 ? (
        <EmptyState title={crawl?.status === "running" ? "No matches yet" : filtered ? "Nothing matches these filters" : "No jobs match this search yet"}>
          {crawl?.status === "running" ? (
            "Still checking job boards. Matches will appear here."
          ) : filtered ? (
            <button className="btn mt-2" onClick={() => router.replace(pathname, { scroll: false })}>
              Clear filters
            </button>
          ) : (
            <>
              Try widening the level or location, or including remote roles.{" "}
              <Link href={`/d/${dashboardId}/edit`} className="font-medium text-accent hover:underline">
                Edit this search
              </Link>
            </>
          )}
        </EmptyState>
      ) : (
        <ul className="card divide-y divide-border" aria-label="Jobs">
          {shown.map((r) => (
            <ResultRow key={r.jobId} r={r} dashboardId={dashboardId} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultRow({ r, dashboardId }: { r: Result; dashboardId: number }) {
  const pay = formatComp(r.comp);
  const extra = r.locations.length - 3;
  return (
    <li className="group relative flex flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {r.isNew && <span className="chip bg-accent text-on-accent">New</span>}
          {/* Stretched link: the whole row opens the job; the posting link stays separately focusable. */}
          <Link href={`/jobs/${r.jobId}?d=${dashboardId}`} className="font-semibold after:absolute after:inset-0 group-hover:text-accent">
            {r.title}
          </Link>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <span className="font-medium text-text">{r.companyName}</span>
          <span aria-hidden>·</span>
          <span className="min-w-0" title={r.locations.join(" · ")}>
            {r.locations.slice(0, 3).join(" · ") || "Location not listed"}
            {extra > 0 && ` +${extra} more`}
          </span>
          {r.matchReason === "remote_us" && (
            <span className="chip bg-accent-soft text-accent">
              <Globe2 aria-hidden className="size-3" /> Remote US
            </span>
          )}
          {r.locationType === "hybrid" && <span className="chip bg-surface-2">Hybrid</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm sm:justify-end">
        {r.applicationStatus && <span className="chip border border-border bg-surface">{STATUS_LABELS[r.applicationStatus]}</span>}
        <FitBadge score={r.fitScore} />
        {pay && <span className="chip bg-good-soft text-good tabular-nums">{pay}</span>}
        <span className="w-24 text-muted sm:text-right">{timeAgo(r.postedAt ?? r.firstSeenAt)}</span>
        <a href={r.url} target="_blank" rel="noreferrer" className="btn relative z-10 min-h-8 px-2.5" aria-label={`View ${r.title} posting on the company site (new tab)`}>
          Posting <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </div>
    </li>
  );
}
