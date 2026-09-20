"use client";

import { AlertTriangle, Inbox, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef } from "react";

export function Spinner({ label, className = "" }: { label?: string; className?: string }) {
  return (
    <span role="status" className={`inline-flex items-center gap-2 text-sm text-muted ${className}`}>
      <LoaderCircle aria-hidden className="size-4 animate-spin text-accent" />
      {label ?? <span className="sr-only">Loading</span>}
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-surface-2 ${className}`} />;
}

/** Placeholder rows shaped like the content they replace, to avoid layout jumps. */
export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="card divide-y divide-border">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span aria-hidden className="mb-1 rounded-full bg-surface-2 p-3 text-muted">
        {icon ?? <Inbox className="size-5" />}
      </span>
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Alert({ tone = "warn", children }: { tone?: "warn" | "danger"; children: React.ReactNode }) {
  const cls = tone === "danger" ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn";
  return (
    <div role="alert" className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${cls}`}>
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/** What just happened, and the way back from it. */
export interface Feedback {
  text: string;
  /** Errors stay until dismissed or replaced; anything else fades after a few seconds. */
  tone?: "info" | "error";
  action?: { label: string; run: () => void | Promise<void> };
}

const FEEDBACK_MS = 8000;

/**
 * One place for "that worked, undo?" and "that didn't work, retry?". A failed action must never
 * pass silently: the board would quietly revert and look like it ignored you.
 */
export function FeedbackBar({ feedback, onDismiss }: { feedback: Feedback | null; onDismiss: () => void }) {
  const error = feedback?.tone === "error";
  useEffect(() => {
    if (!feedback || error) return;
    const t = setTimeout(onDismiss, FEEDBACK_MS);
    return () => clearTimeout(t);
  }, [feedback, error, onDismiss]);
  if (!feedback) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] max-sm:pb-[calc(env(safe-area-inset-bottom,0px)+4.5rem)]">
      <div
        role={error ? "alert" : "status"}
        className={`pointer-events-auto flex w-[min(34rem,100%)] items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-lg ${
          error ? "border-danger/40 bg-danger-soft text-danger" : "border-border bg-surface text-text"
        }`}
      >
        {error && <AlertTriangle aria-hidden className="size-4 shrink-0" />}
        <p className="min-w-0 flex-1">{feedback.text}</p>
        {feedback.action && (
          <button
            type="button"
            className="btn min-h-9 shrink-0"
            onClick={() => {
              void feedback.action!.run();
              onDismiss();
            }}
          >
            {feedback.action.label}
          </button>
        )}
        <button type="button" className="btn-ghost size-9 shrink-0 px-0" onClick={onDismiss} aria-label="Dismiss">
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** Accessible confirmation built on <dialog>: focus is trapped, Escape cancels. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-5 text-text backdrop:bg-black/40"
    >
      <h2 id="confirm-title" className="section-title">
        {title}
      </h2>
      <div className="mt-2 text-sm text-muted">{body}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn" onClick={onCancel} autoFocus>
          Cancel
        </button>
        <button className={danger ? "btn-danger" : "btn-primary"} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
