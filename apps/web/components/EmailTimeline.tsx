"use client";

import { EMAIL_KINDS, INTERVIEW_ROUNDS, type InterviewRound } from "@jd/core/shared";
import { AlertTriangle, CalendarCheck, Check, ExternalLink, Reply, Tag, Undo2 } from "lucide-react";
import { useId, useState } from "react";
import { dueLabel, KIND_META, openLink, replyLink, ROUND_META, roundName, sameRole, shortDate } from "@/lib/mail-labels";
import { emailAction, type EmailJson, type RoundJson } from "@/lib/pipeline-types";

interface Group {
  key: string;
  title: string;
  emails: EmailJson[];
}

const roundKey = (round: InterviewRound, label: string | null) => (round === "other" ? `other:${(label ?? "").toLowerCase()}` : round);

/** Application · each round in order · Decision. Emails without a round sit with the stage they belong to. */
export function groupEmails(emails: EmailJson[], rounds: RoundJson[]): Group[] {
  const groups = new Map<string, Group>();
  const add = (key: string, title: string, e: EmailJson) => {
    if (!groups.has(key)) groups.set(key, { key, title, emails: [] });
    groups.get(key)!.emails.push(e);
  };
  for (const e of emails) {
    if (e.kind === "rejection" || e.kind === "offer") add("decision", "Decision", e);
    else if (e.round) add(roundKey(e.round, e.roundLabel), roundName(e.round, e.roundLabel ?? rounds.find((r) => r.round === e.round)?.label), e);
    else if (e.kind.startsWith("interview")) add("interviews", "Interviews", e);
    else add("application", "Application", e);
  }
  const order = ["application", ...rounds.map((r) => roundKey(r.round, r.label)), "interviews", "decision"];
  return [...groups.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

export function EmailTimeline({
  emails,
  rounds,
  applications,
  applicationTitle,
  onChanged,
}: {
  emails: EmailJson[];
  rounds: RoundJson[];
  /** Other applications this email could be about, for "This is wrong". */
  applications: { id: number; label: string }[];
  /** This card's role, so an email about a different one can say so. */
  applicationTitle?: string | null;
  onChanged: () => void;
}) {
  if (!emails.length) {
    return <p className="text-sm text-muted">No emails about this application yet. Once your inbox is connected, replies from the company show up here.</p>;
  }
  return (
    <div className="space-y-5">
      {groupEmails(emails, rounds).map((g) => (
        <section key={g.key} aria-label={g.title}>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{g.title}</h3>
          <ol className="space-y-2 border-l-2 border-border pl-3">
            {g.emails.map((e) => (
              <EmailItem key={e.id} email={e} applications={applications} applicationTitle={applicationTitle} onChanged={onChanged} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function EmailItem({
  email: e,
  applications,
  applicationTitle,
  onChanged,
}: {
  email: EmailJson;
  applications: { id: number; label: string }[];
  applicationTitle?: string | null;
  onChanged: () => void;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const meta = KIND_META[e.kind];
  const Icon = meta.icon;
  const open = openLink(e);
  const reply = !e.webLink ? replyLink(e) : null;
  const due = e.actionNeeded && !e.actionDoneAt ? dueLabel(e.actionDueAt) : null;
  const act = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      await emailAction(e.id, body);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save.");
    }
  };

  return (
    <li className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`chip ${meta.tone}`}>
          <Icon aria-hidden className="size-3.5" /> {meta.label}
        </span>
        {e.reviewState === "needs_review" && (
          <span className="chip bg-warn-soft text-warn">
            <AlertTriangle aria-hidden className="size-3" /> Needs a check
          </span>
        )}
        <time dateTime={e.receivedAt} className="ml-auto text-xs text-muted">
          {shortDate(e.receivedAt, true)}
        </time>
      </div>
      <div>
        <p className="text-sm font-medium [overflow-wrap:anywhere]">{e.subject || "(no subject)"}</p>
        <p className="text-xs text-muted [overflow-wrap:anywhere]">From {e.fromName ? `${e.fromName} <${e.fromAddress}>` : e.fromAddress}</p>
        {/* A different role at the same company usually means a different application. */}
        {e.jobTitle && !sameRole(e.jobTitle, applicationTitle) && (
          <p className="mt-1 flex items-start gap-1.5 text-xs text-muted">
            <Tag aria-hidden className="mt-0.5 size-3 shrink-0" />
            <span>
              This email is about <span className="font-medium text-text">{e.jobTitle}</span>. If that&apos;s a different application, say so below.
            </span>
          </p>
        )}
      </div>
      {e.summary && <p className="text-sm">{e.summary}</p>}
      {e.eventAt && (
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <CalendarCheck aria-hidden className="size-4 text-accent" /> {shortDate(e.eventAt, true)}
        </p>
      )}
      {e.actionNeeded && (
        <div
          className={`flex flex-col gap-2 rounded-lg px-3 py-2 text-sm sm:flex-row sm:items-center ${e.actionDoneAt ? "bg-surface-2 text-muted" : "bg-warn-soft text-warn"}`}
        >
          <p className="flex flex-1 items-start gap-1.5">
            {e.actionDoneAt ? <Check aria-hidden className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />}
            <span>
              <span className="font-semibold">{e.actionDoneAt ? "Done: " : "Action needed: "}</span>
              {e.actionText ?? "Reply to this email"}
              {due && (
                <span className="font-medium">
                  {" "}
                  · {due.text} ({shortDate(e.actionDueAt, true)})
                </span>
              )}
            </span>
          </p>
          <button type="button" className="btn min-h-9 shrink-0" onClick={() => void act({ type: "done", done: !e.actionDoneAt })}>
            {e.actionDoneAt ? (
              <>
                <Undo2 aria-hidden className="size-4" /> Not done
              </>
            ) : (
              <>
                <Check aria-hidden className="size-4" /> Mark done
              </>
            )}
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {open && (
          <a href={open.href} target="_blank" rel="noreferrer" className="btn min-h-9">
            {open.label} <ExternalLink aria-hidden className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
        {reply && (
          <a href={reply} className="btn min-h-9">
            <Reply aria-hidden className="size-4" /> Reply
          </a>
        )}
        {e.reviewState === "needs_review" && (
          <button type="button" className="btn-primary min-h-9" onClick={() => void act({ type: "confirm" })}>
            <Check aria-hidden className="size-4" /> Yes, update the pipeline
          </button>
        )}
        <details className="group relative">
          <summary className="btn-ghost min-h-9 list-none text-xs [&::-webkit-details-marker]:hidden">This is wrong</summary>
          <div className="absolute left-0 z-20 mt-1 w-[min(20rem,calc(100vw-3rem))] space-y-3 rounded-xl border border-border bg-surface p-3 shadow-lg">
            <div>
              <label htmlFor={`${id}-kind`} className="label">
                What is it?
              </label>
              <select id={`${id}-kind`} className="input" defaultValue={e.kind} onChange={(ev) => void act({ type: "correct", kind: ev.target.value })}>
                {EMAIL_KINDS.filter((k) => k !== "unrelated").map((k) => (
                  <option key={k} value={k}>
                    {KIND_META[k].label}
                  </option>
                ))}
              </select>
            </div>
            {(e.kind.startsWith("interview") || e.kind === "assessment") && (
              <div>
                <label htmlFor={`${id}-round`} className="label">
                  Which round?
                </label>
                <select id={`${id}-round`} className="input" defaultValue={e.round ?? ""} onChange={(ev) => void act({ type: "correct", round: ev.target.value || null })}>
                  <option value="">Not sure</option>
                  {INTERVIEW_ROUNDS.map((r) => (
                    <option key={r} value={r}>
                      {ROUND_META[r].label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor={`${id}-app`} className="label">
                It&apos;s about a different application
              </label>
              <select
                id={`${id}-app`}
                className="input"
                defaultValue=""
                onChange={(ev) => ev.target.value && void act({ type: "assign", applicationId: ev.target.value === "new" ? "new" : Number(ev.target.value) })}
              >
                <option value="">Choose…</option>
                {applications
                  .filter((a) => a.id !== e.applicationId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                <option value="new">One that isn&apos;t in my pipeline yet</option>
              </select>
            </div>
            <button type="button" className="btn-danger w-full" onClick={() => void act({ type: "dismiss" })}>
              Not a job email: hide it
            </button>
          </div>
        </details>
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
