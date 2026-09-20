import { AlertTriangle, CheckCircle2 } from "lucide-react";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
export const fmtCount = (n: number) => (n >= 10_000 ? compact.format(n) : n.toLocaleString("en-US"));
export const fmtUsd = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`;

/** Label, value, one line of context. Values use proportional figures (large standalone numbers). */
export function StatTile({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

/**
 * Spend against a cap. The fill carries severity (accent → warning at 80% → danger at the cap)
 * over a lighter step of the same hue, and the state is always written out too.
 */
export function Meter({ label, used, cap }: { label: string; used: number; cap: number | null }) {
  if (cap === null || cap <= 0) {
    return (
      <div className="card p-4">
        <p className="text-sm text-muted">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">{fmtUsd(used)}</p>
        <p className="mt-0.5 text-xs text-muted">No cap set</p>
      </div>
    );
  }
  const pct = used / cap;
  const tone = pct >= 1 ? { fill: "bg-danger", track: "bg-danger-soft", text: "text-danger" } : pct >= 0.8 ? { fill: "bg-warn", track: "bg-warn-soft", text: "text-warn" } : { fill: "bg-accent", track: "bg-accent-soft", text: "text-muted" };
  return (
    <div className="card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">
        {fmtUsd(used)} <span className="text-sm font-normal text-muted">of {fmtUsd(cap)}</span>
      </p>
      <div
        className={`mt-2 h-2 overflow-hidden rounded-full ${tone.track}`}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={Math.min(used, cap)}
        aria-valuetext={`${fmtUsd(used)} of ${fmtUsd(cap)}`}
      >
        <div className={`h-full rounded-full ${tone.fill}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
      <p className={`mt-1.5 flex items-center gap-1 text-xs ${tone.text}`}>
        {pct >= 0.8 && <AlertTriangle aria-hidden className="size-3.5" />}
        {pct >= 1 ? "Cap reached: AI work is paused" : `${Math.round(pct * 100)}% of cap`}
      </p>
    </div>
  );
}

export function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 py-2 text-sm">
      {ok ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-good" /> : <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />}
      <span>
        {children}
        <span className="sr-only">{ok ? " (ok)" : " (needs attention)"}</span>
      </span>
    </li>
  );
}
