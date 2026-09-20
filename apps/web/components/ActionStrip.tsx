"use client";

import { AlertTriangle, BellRing, Check, ChevronDown, ExternalLink, Reply } from "lucide-react";
import { useState } from "react";
import { dueLabel, openLink, replyLink, shortDate } from "@/lib/mail-labels";
import type { ActionJson } from "@/lib/pipeline-types";

const SHOWN = 3;

/**
 * "Needs your reply": what emails are asking you to do, soonest due first. Each row says what,
 * for which application, by when, and links straight to the email to reply.
 */
export function ActionStrip({ actions, onOpen, onDone }: { actions: ActionJson[]; onOpen: (applicationId: number) => void; onDone: (emailId: number) => void }) {
  const [all, setAll] = useState(false);
  if (!actions.length) return null;
  const shown = all ? actions : actions.slice(0, SHOWN);
  const n = actions.length;
  return (
    <section aria-labelledby="needs-reply" className="rounded-xl border border-border border-l-4 border-l-warn bg-surface p-3 sm:p-4">
      <div className="mb-2 flex items-center gap-2">
        <BellRing aria-hidden className="size-4 text-warn" />
        <h2 id="needs-reply" className="section-title">
          Needs your reply
        </h2>
        <span role="status" aria-atomic="true" className="chip bg-warn-soft text-warn tabular-nums">
          {n}
          <span className="sr-only"> {n === 1 ? "email needs" : "emails need"} your reply</span>
        </span>
      </div>
      <ul className="space-y-2">
        {shown.map((a) => {
          const due = dueLabel(a.actionDueAt);
          const open = openLink(a);
          const reply = !a.webLink ? replyLink(a) : null;
          return (
            <li key={a.emailId} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-semibold">{a.company}</span> <span className="text-muted">·</span> {a.actionText}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                  <button type="button" className="truncate text-left hover:text-accent hover:underline" onClick={() => onOpen(a.applicationId)}>
                    {a.title}
                  </button>
                  {due && (
                    <span className={`inline-flex items-center gap-1 font-medium ${due.overdue ? "text-danger" : "text-warn"}`}>
                      {due.overdue && <AlertTriangle aria-hidden className="size-3" />}
                      {due.text} ({shortDate(a.actionDueAt, true)})
                    </span>
                  )}
                  <span>received {shortDate(a.receivedAt)}</span>
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {open && (
                  <a href={open.href} target="_blank" rel="noreferrer" className="btn min-h-10">
                    {open.label} <ExternalLink aria-hidden className="size-3.5" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                )}
                {reply && (
                  <a href={reply} className="btn min-h-10">
                    <Reply aria-hidden className="size-4" /> Reply
                  </a>
                )}
                <button type="button" className="btn min-h-10" onClick={() => onDone(a.emailId)} aria-label={`Mark done: ${a.company}, ${a.actionText}`}>
                  <Check aria-hidden className="size-4" /> Done
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {n > SHOWN && (
        <button type="button" className="btn-ghost mt-2 -ml-2 min-h-9 text-xs" aria-expanded={all} onClick={() => setAll((x) => !x)}>
          <ChevronDown aria-hidden className={`size-3.5 transition-transform ${all ? "rotate-180" : ""}`} />
          {all ? "Show fewer" : `Show all (${n})`}
        </button>
      )}
    </section>
  );
}
