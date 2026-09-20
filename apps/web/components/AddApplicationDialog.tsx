"use client";

import type { ApplicationStatus } from "@jd/core/shared";
import { useEffect, useId, useRef, useState } from "react";
import { STATUS_LABELS } from "@/lib/types";

const TRACKABLE: ApplicationStatus[] = ["saved", "applying", "applied", "interview", "offer", "rejected"];

/**
 * For an application nothing else can see: you applied somewhere that sends no confirmation, or
 * before any of this existed. A posting link is optional and gets matched to a job we know.
 */
export function AddApplicationDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (id: number) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<ApplicationStatus>("applied");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setCompany("");
      setTitle("");
      setUrl("");
      setStatus("applied");
      setError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/pipeline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyName: company, jobTitle: title, jobUrl: url, status }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const body = res ? ((await res.json().catch(() => ({}))) as { error?: string; issues?: { message: string }[] }) : null;
      setError(body?.issues?.[0]?.message ?? body?.error ?? "Couldn't add that. Check your connection and try again.");
      return;
    }
    const { id } = (await res.json()) as { id: number };
    onAdded(id);
  }

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby={`${ids}-title`}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-5 text-text backdrop:bg-black/40"
    >
      <h2 id={`${ids}-title`} className="section-title">
        Add an application
      </h2>
      <p className="mt-1 text-sm text-muted">For something you applied to outside Job Companion that hasn&apos;t shown up in your email yet.</p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <div>
          <label className="label" htmlFor={`${ids}-company`}>
            Company
          </label>
          <input id={`${ids}-company`} className="input" value={company} onChange={(e) => setCompany(e.target.value)} required maxLength={120} autoFocus />
        </div>
        <div>
          <label className="label" htmlFor={`${ids}-title`}>
            Role <span className="font-normal">(optional)</span>
          </label>
          <input id={`${ids}-title`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </div>
        <div>
          <label className="label" htmlFor={`${ids}-url`}>
            Posting link <span className="font-normal">(optional)</span>
          </label>
          <input id={`${ids}-url`} className="input" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" maxLength={2000} />
          <p className="helper">If it&apos;s a job I already know, the card links to it.</p>
        </div>
        <div>
          <label className="label" htmlFor={`${ids}-status`}>
            Where is it?
          </label>
          <select id={`${ids}-status`} className="input" value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus)}>
            {TRACKABLE.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !company.trim()}>
            {busy ? "Adding…" : "Add to pipeline"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
