"use client";

import type { Comp, CompanyProfile } from "@jd/core/shared";
import { ArrowLeft, ExternalLink, Search } from "lucide-react";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { CompanyProfileCard } from "@/components/CompanyProfileCard";
import { EmptyState, SkeletonList } from "@/components/ui";
import { formatComp, timeAgo } from "@/lib/format";
import type { TaskStatus } from "@/lib/types";

interface Data {
  company: { id: number; name: string; domain: string | null; atsType: string; atsSlug: string; openJobCount: number };
  profile: { data: CompanyProfile; enrichedAt: string; consultedUrls: string[] } | null;
  research: TaskStatus;
  jobs: { id: number; title: string; locations: string[]; comp: Comp | null; postedAt: string | null; department: string | null }[];
}

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Data | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const d = (await (await fetch(`/api/companies/${id}`)).json()) as Data;
    setData(d);
    return d;
  }, [id]);

  useEffect(() => {
    void load();
    fetch("/api/usage").then((r) => r.json()).then((u) => setHasApiKey(u.hasApiKey));
  }, [load]);

  async function research() {
    await fetch(`/api/companies/${id}/research`, { method: "POST" });
    const poll = async () => {
      const d = await load();
      if (d.research.status === "queued" || d.research.status === "running") setTimeout(poll, 3000);
    };
    void poll();
  }

  if (!data) return <SkeletonList rows={8} />;
  const s = q.toLowerCase();
  const jobs = data.jobs.filter((j) => !s || j.title.toLowerCase().includes(s) || j.locations.join(" ").toLowerCase().includes(s));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <section className="space-y-3">
        <div>
          <button type="button" onClick={() => history.back()} className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
            <ArrowLeft aria-hidden className="size-4" /> Back
          </button>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{data.company.name}</h1>
          {data.company.domain && (
            <a href={`https://${data.company.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
              {data.company.domain} <ExternalLink aria-hidden className="size-3.5" />
            </a>
          )}
        </div>
        <div className="card p-5">
          <CompanyProfileCard profile={data.profile} task={data.research} hasApiKey={hasApiKey} onResearch={research} />
        </div>
      </section>
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="section-title tabular-nums">{data.jobs.length} open roles</h2>
          <div className="relative max-w-56">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Filter roles" aria-label="Filter roles" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {jobs.length === 0 && <EmptyState title="No roles match">Try a different title or location.</EmptyState>}
        <ul className={`card divide-y divide-border ${jobs.length === 0 ? "hidden" : ""}`}>
          {jobs.map((j) => (
            <li key={j.id} className="relative px-4 py-3 text-sm transition-colors hover:bg-surface-2">
              <Link href={`/jobs/${j.id}`} className="font-semibold after:absolute after:inset-0 hover:text-accent">
                {j.title}
              </Link>
              <div className="flex flex-wrap gap-x-2 text-muted">
                <span>{j.locations.join(" · ") || "Location not listed"}</span>
                {formatComp(j.comp) && <span className="text-good tabular-nums">{formatComp(j.comp)}</span>}
                <span>· {timeAgo(j.postedAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
