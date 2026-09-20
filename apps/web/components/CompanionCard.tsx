"use client";

import { ArrowRight, ChevronDown, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { CompanionStep } from "@/lib/dashboards";

/**
 * The companion's "next step": the single most useful thing to do now, with the rest one
 * click away. Setup gaps come first because fit scores and auto-fill depend on them.
 */
export function CompanionCard({ steps }: { steps: CompanionStep[] }) {
  const [more, setMore] = useState(false);
  const [first, ...rest] = steps;
  if (!first) {
    return (
      <div className="companion flex items-center gap-3 px-4 py-3 text-sm">
        <Sparkles aria-hidden className="size-4 shrink-0 text-accent" />
        <p>
          <span className="font-medium">You&apos;re all caught up.</span>{" "}
          <span className="text-muted">I&apos;ll mark anything new here, and in your email if it&apos;s on.</span>
        </p>
      </div>
    );
  }
  return (
    <section aria-label="Suggested next step" className="companion px-4 py-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Sparkles aria-hidden className="hidden size-5 shrink-0 text-accent sm:block" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-accent uppercase">Next step</p>
          <p className="font-semibold">{first.title}</p>
          <p className="text-sm text-muted">{first.detail}</p>
        </div>
        <Link href={first.action.href} className="btn-primary shrink-0">
          {first.action.label} <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
      {rest.length > 0 && (
        <>
          <button className="btn-ghost mt-2 -ml-2 min-h-8 text-xs" aria-expanded={more} onClick={() => setMore((m) => !m)}>
            <ChevronDown aria-hidden className={`size-3.5 transition-transform ${more ? "rotate-180" : ""}`} />
            {more ? "Hide" : `${rest.length} more suggestion${rest.length === 1 ? "" : "s"}`}
          </button>
          {more && (
            <ul className="mt-1 divide-y divide-border border-t border-border">
              {rest.map((s) => (
                <li key={s.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{s.title}</p>
                    <p className="text-muted">{s.detail}</p>
                  </div>
                  <Link href={s.action.href} className="btn shrink-0">
                    {s.action.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
