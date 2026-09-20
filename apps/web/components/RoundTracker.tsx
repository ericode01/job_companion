"use client";

import type { ApplicationStatus } from "@jd/core/shared";
import { Award, CalendarCheck, Check, Circle, CircleCheck, CircleDot, CircleX } from "lucide-react";
import { roundName, shortDate } from "@/lib/mail-labels";
import type { RoundJson } from "@/lib/pipeline-types";

/** Compact round progress for a pipeline card: "✓ Recruiter · ✓ Screen", then the current round. */
export function RoundChips({ rounds }: { rounds: RoundJson[] }) {
  if (!rounds.length) return null;
  const current = [...rounds].reverse().find((r) => r.state !== "done");
  const done = rounds.filter((r) => r !== current);
  return (
    <div className="space-y-1 text-xs">
      {done.length > 0 && (
        <p className="flex flex-wrap gap-x-2 text-muted">
          {done.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-0.5">
              <Check aria-hidden className="size-3 text-good" />
              {roundName(r.round, r.label, true)}
              <span className="sr-only">(done)</span>
            </span>
          ))}
        </p>
      )}
      {current && (
        <p className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">
          {current.state === "scheduled" ? <CalendarCheck aria-hidden className="size-3 shrink-0" /> : <CircleDot aria-hidden className="size-3 shrink-0" />}
          <span className="truncate">
            {roundName(current.round, current.label, true)}
            {current.state === "scheduled" && current.eventAt ? ` · ${shortDate(current.eventAt, true)}` : current.state === "scheduling" ? " · scheduling" : ""}
          </span>
        </p>
      )}
    </div>
  );
}

type StepState = "done" | "current" | "todo" | "ended";

function Step({ state, icon, title, sub }: { state: StepState; icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <li className="flex min-w-0 items-start gap-2" aria-current={state === "current" ? "step" : undefined}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className={`block text-sm ${state === "current" ? "font-semibold" : state === "todo" ? "text-muted" : "font-medium"}`}>{title}</span>
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
    </li>
  );
}

/**
 * From application to decision: applied (and confirmed), each interview round in the order it
 * happened, then the outcome. Every step has an icon and words.
 */
export function RoundTracker({
  status,
  appliedAt,
  confirmedAt,
  rounds,
}: {
  status: ApplicationStatus;
  appliedAt: string | null;
  confirmedAt: string | null;
  rounds: RoundJson[];
}) {
  const applied = Boolean(appliedAt || confirmedAt) || ["applied", "interview", "offer", "rejected"].includes(status);
  const done = <CircleCheck aria-hidden className="size-4 text-good" />;
  const current = rounds.findLastIndex((r) => r.state !== "done");
  const ended = status === "offer" || status === "rejected" || status === "withdrawn";
  return (
    <ol aria-label="Progress" className="grid gap-3 sm:grid-cols-2">
      <Step
        state={applied ? "done" : "current"}
        icon={applied ? done : <CircleDot aria-hidden className="size-4 text-accent" />}
        title={applied ? "Applied" : "Not applied yet"}
        sub={confirmedAt ? `Confirmed ${shortDate(confirmedAt)}` : appliedAt ? `${shortDate(appliedAt)} · no confirmation yet` : undefined}
      />
      {rounds.map((r, i) => {
        const isCurrent = i === current && !ended;
        const sub = r.state === "done" ? "Done" : r.state === "scheduled" ? (r.eventAt ? shortDate(r.eventAt, true) : "Scheduled") : "Scheduling";
        return (
          <Step
            key={i}
            state={isCurrent ? "current" : r.state === "done" || ended ? "done" : "todo"}
            icon={
              r.state === "done" || (ended && !isCurrent) ? (
                done
              ) : r.state === "scheduled" ? (
                <CalendarCheck aria-hidden className="size-4 text-accent" />
              ) : (
                <CircleDot aria-hidden className="size-4 text-accent" />
              )
            }
            title={roundName(r.round, r.label)}
            sub={sub}
          />
        );
      })}
      {status === "offer" ? (
        <Step state="ended" icon={<Award aria-hidden className="size-4 text-good" />} title="Offer" />
      ) : status === "rejected" ? (
        <Step state="ended" icon={<CircleX aria-hidden className="size-4 text-muted" />} title="Not moving forward" />
      ) : status === "withdrawn" ? (
        <Step state="ended" icon={<CircleX aria-hidden className="size-4 text-muted" />} title="Withdrawn" />
      ) : (
        <Step state="todo" icon={<Circle aria-hidden className="size-4 text-muted" />} title="Decision" sub="Waiting" />
      )}
    </ol>
  );
}
