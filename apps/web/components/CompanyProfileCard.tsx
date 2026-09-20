"use client";

import type { CompanyProfile } from "@jd/core/shared";
import { AlertTriangle, Newspaper, RefreshCw, Sparkles } from "lucide-react";
import { SourceLink } from "@/components/Status";
import { Skeleton, Spinner } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import type { TaskStatus } from "@/lib/types";

const STAGE_LABELS: Record<string, string> = {
  "pre-seed": "Pre-seed",
  seed: "Seed",
  "series-a": "Series A",
  "series-b": "Series B",
  "series-c": "Series C",
  "series-d-plus": "Series D+",
  growth: "Growth / late stage",
  public: "Public",
  acquired: "Acquired",
  bootstrapped: "Bootstrapped",
};

interface Props {
  profile: { data: CompanyProfile; enrichedAt: string; consultedUrls: string[] } | null;
  task: TaskStatus;
  hasApiKey: boolean;
  onResearch: () => void;
  compact?: boolean;
}

function Fact({ label, value, url }: { label: string; value: string | null; url?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="font-medium">
        {value}
        <SourceLink url={url} />
      </dd>
    </div>
  );
}

export function CompanyProfileCard({ profile, task, hasApiKey, onResearch, compact }: Props) {
  const busy = task.status === "queued" || task.status === "running";
  if (!profile) {
    return (
      <div className="space-y-2 text-sm">
        {busy ? (
          <div className="space-y-3">
            <Spinner label="Researching the company. This takes about a minute." />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : task.status === "failed" ? (
          <div className="space-y-2">
            <p className="flex items-start gap-1.5 text-danger">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> Research failed: {task.error}
            </p>
            <button className="btn" onClick={onResearch}>
              <RefreshCw aria-hidden className="size-4" /> Try again
            </button>
          </div>
        ) : hasApiKey ? (
          <div className="space-y-2">
            <p className="text-muted">Overview, products, funding, and size, with sources. About $0.20.</p>
            <button className="btn" onClick={onResearch}>
              <Sparkles aria-hidden className="size-4" /> Research this company
            </button>
          </div>
        ) : (
          <p className="text-muted">Add ANTHROPIC_API_KEY to .env.local to research companies.</p>
        )}
      </div>
    );
  }
  const d = profile.data;
  const stage = d.stage.value && d.stage.value !== "unknown" ? STAGE_LABELS[d.stage.value] ?? d.stage.value : null;
  return (
    <div className="space-y-3 text-sm">
      {d.overview && <p className="leading-relaxed">{d.overview}</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="Stage" value={stage ?? (d.publicTicker ? "Public" : null)} url={d.stage.sourceUrl} />
        <Fact label="Ticker" value={d.publicTicker} />
        <Fact label="Total funding" value={d.totalFunding.value} url={d.totalFunding.sourceUrl} />
        <Fact label="Last round" value={d.lastRound.value} url={d.lastRound.sourceUrl} />
        <Fact label="Headcount" value={d.headcount.value} url={d.headcount.sourceUrl} />
        <Fact label="Founded" value={d.founded.value} url={d.founded.sourceUrl} />
        <Fact label="Headquarters" value={d.headquarters.value} url={d.headquarters.sourceUrl} />
      </dl>
      {d.investors.length > 0 && (
        <p>
          <span className="text-xs text-muted">Investors: </span>
          {d.investors.join(", ")}
        </p>
      )}
      {d.products.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted">Products</h3>
          <ul className="space-y-1">
            {d.products.slice(0, compact ? 3 : undefined).map((p) => (
              <li key={p.name}>
                <span className="font-medium">{p.name}</span>: {p.description}
                <SourceLink url={p.sourceUrl} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {!compact && (
        <>
          <Fact label="Customers" value={d.customers.value} url={d.customers.sourceUrl} />
          <Fact label="Business model" value={d.businessModel.value} url={d.businessModel.sourceUrl} />
          {d.competitors.length > 0 && (
            <p>
              <span className="text-xs text-muted">Competitors: </span>
              {d.competitors.join(", ")}
            </p>
          )}
          {d.recentNews.length > 0 && (
            <div>
              <h3 className="mb-1 flex items-center gap-1 text-xs font-medium text-muted">
                <Newspaper aria-hidden className="size-3.5" /> Recent news
              </h3>
              <ul className="space-y-1">
                {d.recentNews.map((n) => (
                  <li key={n.sourceUrl + n.headline}>
                    {n.date && <span className="text-muted">{n.date} · </span>}
                    <a href={n.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-accent">
                      {n.headline}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {d.notes && <p className="rounded-lg bg-surface-2 p-2.5 text-xs text-muted">{d.notes}</p>}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-xs text-muted">
        <span>
          Researched {timeAgo(profile.enrichedAt)} · {d.confidence} confidence · {profile.consultedUrls.length} pages checked
        </span>
        {busy ? (
          <Spinner label="Refreshing" />
        ) : (
          hasApiKey && (
            <button className="btn-ghost min-h-8 px-2 text-xs" onClick={onResearch} title="Re-research (about $0.20)">
              <RefreshCw aria-hidden className="size-3.5" /> Refresh
            </button>
          )
        )}
      </div>
    </div>
  );
}
