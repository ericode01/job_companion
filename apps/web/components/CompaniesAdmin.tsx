"use client";

import { CheckCircle2, CircleSlash, Plus, RefreshCw, Search, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { DiscoverCompanies } from "@/components/DiscoverCompanies";
import { SkeletonList } from "@/components/ui";
import { timeAgo } from "@/lib/format";

const ATS: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", smartrecruiters: "SmartRecruiters" };

interface Company {
  id: number;
  name: string;
  domain: string | null;
  atsType: string;
  atsSlug: string;
  source: string;
  watch: boolean;
  enabled: boolean;
  lastCrawledAt: string | null;
  crawlStatus: "ok" | "not_found" | "error" | null;
  crawlError: string | null;
  openJobCount: number;
}
interface Crawl {
  status: string;
  done: number;
  total: number;
}

/** The shared company list: every search on this server draws from it. */
export function CompaniesAdmin() {
  const [rows, setRows] = useState<Company[] | null>(null);
  const urlId = useId();
  const [q, setQ] = useState("");
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [crawl, setCrawl] = useState<Crawl | null>(null);

  const load = useCallback(() => fetch("/api/companies").then((r) => r.json()).then(setRows), []);
  const loadCrawl = () =>
    fetch("/api/crawl")
      .then((r) => r.json())
      .then((b) => {
        setCrawl(b.crawl);
        return b.crawl as Crawl | null;
      });

  useEffect(() => {
    void load();
    void loadCrawl();
  }, [load]);

  useEffect(() => {
    if (crawl?.status !== "running") return;
    const t = setInterval(async () => {
      const c = await loadCrawl();
      if (c?.status !== "running") void load();
    }, 2500);
    return () => clearInterval(t);
  }, [crawl?.status]);

  const shown = useMemo(() => {
    const s = q.toLowerCase();
    return (rows ?? []).filter((r) => !s || r.name.toLowerCase().includes(s) || r.atsSlug.includes(s));
  }, [rows, q]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setMsg(null);
    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const body = await res.json();
    setAdding(false);
    if (!res.ok) {
      setMsg({ kind: "err", text: body.error ?? "Could not add company" });
      return;
    }
    setMsg({ kind: "ok", text: `Added ${body.company.name} with ${body.upserted} open roles.` });
    setUrl("");
    void load();
  }

  async function refresh() {
    await fetch("/api/crawl", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: true }) });
    void loadCrawl();
  }

  if (!rows) return <SkeletonList rows={10} />;
  const totalJobs = rows.reduce((n, r) => n + r.openJobCount, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Companies</h1>
          <p className="text-sm text-muted">Every search on this server draws from this list.</p>
          <p className="text-sm text-muted tabular-nums">
            {rows.length} companies · {totalJobs.toLocaleString()} open roles
          </p>
        </div>
        <button className="btn" onClick={refresh} disabled={crawl?.status === "running"}>
          <RefreshCw aria-hidden className={`size-4 ${crawl?.status === "running" ? "animate-spin" : ""}`} />
          {crawl?.status === "running" ? `Refreshing ${crawl.done}/${crawl.total}…` : "Refresh all now"}
        </button>
      </div>

      <form onSubmit={add} className="card space-y-2 p-4">
        <label htmlFor={urlId} className="label">
          Add a company by its job board or website
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id={urlId}
            type="text"
            className="input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="jobs.ashbyhq.com/ramp — or ramp.com"
            aria-invalid={msg?.kind === "err"}
            aria-describedby={`${urlId}-msg`}
          />
          <button className="btn-primary shrink-0" disabled={adding || !url}>
            <Plus aria-hidden className="size-4" />
            {adding ? "Looking…" : "Add company"}
          </button>
        </div>
        <p id={`${urlId}-msg`} role="status" className={msg ? (msg.kind === "ok" ? "text-sm text-good" : "field-error text-sm") : "helper"}>
          {msg ? msg.text : "Greenhouse, Lever, Ashby, Workday and SmartRecruiters. Give a website and its careers page is read to find the board."}
        </p>
      </form>

      <DiscoverCompanies onAdded={load} />

      <div className="relative max-w-xs">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <input className="input pl-9" placeholder="Filter companies" aria-label="Filter companies" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Companies and their job boards</caption>
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-border bg-surface-2/60">
              <th scope="col" className="px-4 py-2.5 font-semibold">Company</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Board</th>
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">Open roles</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Last refreshed</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((c) => (
              <tr key={c.id} className={`transition-colors hover:bg-surface-2/60 ${c.enabled ? "" : "opacity-60"}`}>
                <td className="px-4 py-2">
                  <Link href={`/companies/${c.id}`} className="font-medium hover:text-accent">
                    {c.name}
                  </Link>
                  {c.source === "discovered" && <span className="chip ml-2 bg-accent-soft text-accent">Found by AI</span>}
                </td>
                <td className="max-w-56 truncate px-4 py-2 text-muted" title={`${c.atsType}/${c.atsSlug}`}>
                  <span className="text-text">{ATS[c.atsType] ?? c.atsType}</span> · {c.atsType === "workday" ? c.atsSlug.split("/")[1] : c.atsSlug}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{c.openJobCount}</td>
                <td className="px-4 py-2 text-muted">{c.lastCrawledAt ? timeAgo(c.lastCrawledAt) : "never"}</td>
                <td className="px-4 py-2">
                  {c.crawlStatus === "ok" && (
                    <span className="inline-flex items-center gap-1 text-good">
                      <CheckCircle2 aria-hidden className="size-4" /> OK
                    </span>
                  )}
                  {c.crawlStatus === "not_found" && (
                    <span className="inline-flex items-center gap-1 text-warn">
                      <CircleSlash aria-hidden className="size-4" /> Board not found, paused
                    </span>
                  )}
                  {c.crawlStatus === "error" && (
                    <span className="inline-flex items-center gap-1 text-danger" title={c.crawlError ?? ""}>
                      <TriangleAlert aria-hidden className="size-4" /> Error
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
