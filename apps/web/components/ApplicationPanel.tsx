"use client";

import { APPLICATION_STATUSES, type ApplicationStatus } from "@jd/core/shared";
import { ExternalLink, History, Link2, Mail, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { EmailTimeline } from "@/components/EmailTimeline";
import { RoundTracker } from "@/components/RoundTracker";
import { ConfirmDialog, Skeleton } from "@/components/ui";
import { formatComp } from "@/lib/format";
import { shortDate } from "@/lib/mail-labels";
import type { EventJson, PanelData } from "@/lib/pipeline-types";
import { STATUS_LABELS } from "@/lib/types";

function describeEvent(e: EventJson): string {
  const to = STATUS_LABELS[e.toStatus];
  if (e.fromStatus === null) return e.source === "email" ? `Added from an email, as ${to}` : e.source === "extension" ? `Added by the extension, as ${to}` : `Added to the pipeline as ${to}`;
  if (e.source === "email") return `Moved to ${to} by an email`;
  if (e.source === "extension") return `Moved to ${to} when the extension saw it submitted`;
  return `You moved it to ${to}`;
}

/**
 * One application in full: status, which dashboard, the posting, interview rounds, every email
 * with what it asks of you, and the status history with undo. A modal sheet: Escape closes it
 * and focus returns to the card that opened it.
 */
export function ApplicationPanel({
  appId,
  applications,
  onClose,
  onChanged,
}: {
  appId: number | null;
  applications: { id: number; label: string }[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const ids = { title: useId(), status: useId(), move: useId(), url: useId() };
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [data, setData] = useState<PanelData | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [announce, setAnnounce] = useState("");

  const load = useCallback(async () => {
    if (appId === null) return;
    const res = await fetch(`/api/pipeline/${appId}`);
    if (!res.ok) {
      setMissing(true);
      return;
    }
    setMissing(false);
    setData(await res.json());
  }, [appId]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (appId !== null && !d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      setData(null);
      d.showModal();
    }
    if (appId === null && d.open) {
      d.close();
      opener.current?.focus();
    }
    void load();
  }, [appId, load]);

  const refresh = async () => {
    await load();
    onChanged();
  };

  async function patch(body: Record<string, unknown>, message?: string) {
    setError(null);
    const res = await fetch(`/api/pipeline/${appId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(out.error ?? "That didn't save.");
      return false;
    }
    if (message) setAnnounce(message);
    await refresh();
    return out as { linked?: "job" | "url" };
  }

  async function undo(eventId: number) {
    setError(null);
    const res = await fetch(`/api/pipeline/${appId}/undo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(out.error ?? "Couldn't undo that.");
      return;
    }
    if (out.removed) {
      onChanged();
      onClose();
      return;
    }
    setAnnounce("Undone");
    await refresh();
  }

  const app = data?.app;
  const others = applications.filter((a) => a.id !== appId);
  const lastUndoable = data?.events.find((e) => !e.revertedAt);

  return (
    <dialog
      ref={ref}
      aria-labelledby={ids.title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Chrome skips the cancel event for dialogs opened without a click (a ?app= link), so
      // Escape is handled here too, and a close the browser makes on its own is kept in sync.
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented && !confirmRemove) {
          e.preventDefault();
          onClose();
        }
      }}
      onClose={() => {
        if (appId !== null) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-2xl overflow-hidden border-0 border-l border-border bg-bg p-0 text-text backdrop:bg-black/40"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start gap-3 border-b border-border bg-surface px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            {app ? (
              <>
                <p className="text-sm text-muted">{app.companyName}</p>
                <h2 id={ids.title} className="text-lg leading-snug font-bold text-balance">
                  {app.title}
                </h2>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {app.source === "email" && (
                    <span className="chip bg-surface-2 text-muted">
                      <Mail aria-hidden className="size-3" /> Found in your email
                    </span>
                  )}
                  {formatComp(app.comp) && <span className="chip bg-good-soft text-good">{formatComp(app.comp)}</span>}
                  {app.closedAt && <span className="chip bg-warn-soft text-warn">Posting closed</span>}
                </div>
              </>
            ) : (
              <h2 id={ids.title} className="text-lg font-bold">
                {missing ? "Application not found" : "Loading…"}
              </h2>
            )}
          </div>
          <button type="button" className="btn-ghost size-10 shrink-0 px-0" onClick={onClose} aria-label="Close">
            <X aria-hidden className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">
          <p className="sr-only" aria-live="polite">
            {announce}
          </p>
          {missing && <p className="text-sm text-muted">It may have been removed. Close this and refresh the board.</p>}
          {!data && !missing && (
            <div className="space-y-3" role="status" aria-label="Loading application">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          {app && data && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={ids.status} className="label">
                    Status
                  </label>
                  <select
                    id={ids.status}
                    className="input min-h-10"
                    value={app.status}
                    onChange={(e) => void patch({ status: e.target.value }, `Moved to ${STATUS_LABELS[e.target.value as ApplicationStatus]}`)}
                  >
                    {APPLICATION_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
                {data.dashboards.length > 1 && (
                  <div>
                    <label htmlFor={ids.move} className="label">
                      Job search
                    </label>
                    <select id={ids.move} className="input min-h-10" value={app.searchId ?? ""} onChange={(e) => void patch({ searchId: Number(e.target.value) }, "Moved to another job search")}>
                      {data.dashboards.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm">
                {app.jobId !== null && (
                  <Link href={`/jobs/${app.jobId}${app.searchId ? `?d=${app.searchId}` : ""}`} className="btn min-h-10">
                    Job details and fit
                  </Link>
                )}
                {app.postingUrl && (
                  <a href={app.postingUrl} target="_blank" rel="noreferrer" className="btn min-h-10">
                    Job posting <ExternalLink aria-hidden className="size-3.5" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                )}
              </div>
              {app.jobId === null && (
                <form
                  className="rounded-lg border border-border bg-surface p-3"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const out = await patch({ postingUrl: url });
                    if (out) {
                      setUrl("");
                      setAnnounce(out.linked === "job" ? "Linked to the job's details" : "Posting link saved");
                    }
                  }}
                >
                  <label htmlFor={ids.url} className="label">
                    {app.postingUrl ? "Link it to a job Job Companion knows" : "Link to a job posting"}
                  </label>
                  <div className="flex gap-2">
                    <input id={ids.url} className="input min-h-10" type="url" placeholder="https://job-boards.greenhouse.io/…" value={url} onChange={(e) => setUrl(e.target.value)} required />
                    <button className="btn min-h-10 shrink-0">
                      <Link2 aria-hidden className="size-4" /> Link
                    </button>
                  </div>
                  <p className="helper">This application was found in your email and didn&apos;t match a job we know. Paste its posting to link them.</p>
                </form>
              )}

              <section aria-labelledby={`${ids.title}-progress`} className="card p-4">
                <h3 id={`${ids.title}-progress`} className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">
                  Progress
                </h3>
                <RoundTracker status={app.status} appliedAt={app.appliedAt} confirmedAt={app.confirmedAt} rounds={data.rounds} />
              </section>

              <section aria-labelledby={`${ids.title}-emails`}>
                <h3 id={`${ids.title}-emails`} className="section-title mb-3">
                  Emails <span className="font-normal text-muted tabular-nums">({data.emails.length})</span>
                </h3>
                <EmailTimeline emails={data.emails} rounds={data.rounds} applications={others} onChanged={() => void refresh()} />
              </section>

              {data.events.length > 0 && (
                <section aria-labelledby={`${ids.title}-history`}>
                  <h3 id={`${ids.title}-history`} className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
                    <History aria-hidden className="size-3.5" /> History
                  </h3>
                  <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
                    {data.events.map((e) => (
                      <li key={e.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${e.revertedAt ? "text-muted line-through" : ""}`}>
                        <span className="flex-1">{describeEvent(e)}</span>
                        <time dateTime={e.createdAt} className="text-xs text-muted">
                          {shortDate(e.createdAt, true)}
                        </time>
                        {e.source === "email" && e === lastUndoable && (
                          <button type="button" className="btn-ghost min-h-8 text-xs" onClick={() => void undo(e.id)}>
                            <Undo2 aria-hidden className="size-3.5" /> {e.fromStatus === null ? "Remove" : "Undo"}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <div className="border-t border-border pt-4">
                <button type="button" className="btn-danger min-h-10" onClick={() => setConfirmRemove(true)}>
                  Remove from pipeline
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmRemove}
        title="Remove from pipeline?"
        body={app ? `“${app.title}” at ${app.companyName} will no longer be tracked. Its emails stay in your mailbox.` : ""}
        confirmLabel="Remove"
        danger
        onCancel={() => setConfirmRemove(false)}
        onConfirm={async () => {
          setConfirmRemove(false);
          await fetch(`/api/pipeline/${appId}`, { method: "DELETE" });
          onChanged();
          onClose();
        }}
      />
    </dialog>
  );
}
