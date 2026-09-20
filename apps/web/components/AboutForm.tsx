"use client";

import { CheckCircle2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Skeleton } from "@/components/ui";

/**
 * "About you" and a writing sample. Both go to cover letters (the sample only for voice) and
 * to form answers; "about you" also counts as your own facts when checking generated text.
 */
export function AboutForm({ onSaved, saveLabel = "Save", autoFocus = false }: { onSaved?: () => void; saveLabel?: string; autoFocus?: boolean }) {
  const ids = { about: useId(), sample: useId() };
  const [about, setAbout] = useState<string | null>(null);
  const [sample, setSample] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((p) => {
        setAbout(p.about ?? "");
        setSample(p.writingSample ?? "");
      });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ about, writingSample: sample }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Couldn't save.");
      return;
    }
    setDirty(false);
    setSaved(true);
    onSaved?.();
  }

  if (about === null) return <Skeleton className="h-64" />;

  return (
    <form onSubmit={save} className="space-y-4">
      <div>
        <label htmlFor={ids.about} className="label">
          About you, in your own words
        </label>
        <textarea
          id={ids.about}
          className="input min-h-36 leading-relaxed"
          maxLength={8000}
          autoFocus={autoFocus}
          value={about}
          onChange={(e) => {
            setAbout(e.target.value);
            setDirty(true);
            setSaved(false);
          }}
          placeholder={
            "What do you want in your next role? What are you proud of that your resume undersells? Anything to avoid (on-call heavy teams, pure management)?"
          }
          aria-describedby={`${ids.about}-h`}
        />
        <p id={`${ids.about}-h`} className="helper">
          Cover letters and form answers may use these facts, so keep them true.
        </p>
      </div>
      <div>
        <label htmlFor={ids.sample} className="label">
          A cover letter you&apos;ve written, or any writing of yours (optional)
        </label>
        <textarea
          id={ids.sample}
          className="input min-h-36 leading-relaxed"
          maxLength={20000}
          value={sample}
          onChange={(e) => {
            setSample(e.target.value);
            setDirty(true);
            setSaved(false);
          }}
          placeholder="Paste it here."
          aria-describedby={`${ids.sample}-h`}
        />
        <p id={`${ids.sample}-h`} className="helper">
          Used only to match your voice. Nothing in it is copied into new letters.
        </p>
      </div>
      <div className="flex items-center justify-end gap-3">
        <span role="status" className="text-sm">
          {error ? (
            <span className="text-danger">{error}</span>
          ) : saved ? (
            <span className="inline-flex items-center gap-1 text-good">
              <CheckCircle2 aria-hidden className="size-4" /> Saved
            </span>
          ) : dirty ? (
            <span className="text-muted">Unsaved changes</span>
          ) : null}
        </span>
        <button className="btn-primary" disabled={busy || (!dirty && saveLabel === "Save")}>
          {busy ? "Saving…" : saveLabel}
        </button>
      </div>
    </form>
  );
}
