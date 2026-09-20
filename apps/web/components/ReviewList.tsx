"use client";

import { Check, CircleHelp, ExternalLink, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import { KIND_META, openLink, roundName, shortDate } from "@/lib/mail-labels";
import { emailAction, type ReviewJson } from "@/lib/pipeline-types";

/**
 * "Check these": emails I wasn't sure about. Nothing moved because of them; one click confirms,
 * points one at the right application, or hides it.
 */
export function ReviewList({
  items,
  applications,
  onChanged,
  id = "check",
}: {
  items: ReviewJson[];
  applications: { id: number; label: string }[];
  onChanged: () => void;
  id?: string;
}) {
  if (!items.length) return null;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 rounded-xl border border-border bg-surface p-3 sm:p-4">
      <div className="mb-1 flex items-center gap-2">
        <CircleHelp aria-hidden className="size-4 text-accent" />
        <h2 id={`${id}-title`} className="section-title">
          Check these
        </h2>
        <span className="chip bg-surface-2 text-muted tabular-nums">{items.length}</span>
      </div>
      <p className="mb-3 text-sm text-muted">I wasn&apos;t sure what these mean for your applications, so nothing moved. Confirm or correct each one.</p>
      <ul className="space-y-2">
        {items.map((r) => (
          <ReviewRow key={r.emailId} item={r} applications={applications} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  );
}

function ReviewRow({ item: r, applications, onChanged }: { item: ReviewJson; applications: { id: number; label: string }[]; onChanged: () => void }) {
  const selectId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = KIND_META[r.kind];
  const Icon = meta.icon;
  const open = openLink(r);
  const guess = [r.companyName, r.jobTitle].filter(Boolean).join(" · ");
  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await emailAction(r.emailId, body);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save.");
      setBusy(false);
    }
  };
  const current = applications.find((a) => a.id === r.applicationId);
  return (
    <li className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`chip ${meta.tone}`}>
          <Icon aria-hidden className="size-3.5" /> {meta.label}
          {r.round ? ` · ${roundName(r.round, null, true)}` : ""}
        </span>
        {guess && <span className="text-sm font-medium">{guess}</span>}
        <time dateTime={r.receivedAt} className="ml-auto text-xs text-muted">
          {shortDate(r.receivedAt)}
        </time>
      </div>
      <p className="text-sm [overflow-wrap:anywhere]">
        <span className="font-medium">{r.subject || "(no subject)"}</span>
        <span className="text-muted"> · from {r.fromName ?? r.fromAddress}</span>
      </p>
      {r.summary && <p className="text-sm text-muted">{r.summary}</p>}
      <p className="text-xs text-muted">
        {current ? `Looks like it's about: ${current.label}.` : "Not linked to an application yet."}
        {r.classifiedBy === "rules" ? " Sorted without AI." : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary min-h-10" disabled={busy} onClick={() => void act({ type: "confirm" })}>
          <Check aria-hidden className="size-4" /> {current ? "Yes, update it" : "Add to my pipeline"}
        </button>
        <label htmlFor={selectId} className="sr-only">
          Which application is it about?
        </label>
        <select
          id={selectId}
          className="input min-h-10 w-auto max-w-[16rem]"
          defaultValue=""
          disabled={busy}
          onChange={(e) => e.target.value && void act({ type: "assign", applicationId: e.target.value === "new" ? "new" : Number(e.target.value) })}
        >
          <option value="">It&apos;s about…</option>
          {applications.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
          <option value="new">A new application</option>
        </select>
        {open && (
          <a href={open.href} target="_blank" rel="noreferrer" className="btn min-h-10">
            {open.label} <ExternalLink aria-hidden className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
        <button type="button" className="btn-ghost min-h-10" disabled={busy} onClick={() => void act({ type: "dismiss" })}>
          <EyeOff aria-hidden className="size-4" /> Not a job email
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
