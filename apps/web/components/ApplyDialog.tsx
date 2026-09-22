"use client";

import { CheckCircle2, ExternalLink, FileText, PenLine, Puzzle, RefreshCw, Send, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Alert, Skeleton, Spinner } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { openThroughExtension, useExtension } from "@/lib/extension";
import { setApplicationStatus, type TaskStatus } from "@/lib/types";

interface PrepareState {
  application: { id: number; status: string; coverLetterChoice: "yes" | "no" | null; coverLetter: string | null; coverLetterWarnings: string[] | null } | null;
  coverLetterTask: TaskStatus;
  formInfo: { coverLetterRequired: boolean | null; hasCoverLetterField: boolean | null; questionCount: number | null };
  resume: { id: number; fileName: string; parseStatus: string } | null;
  tailored: { id: number; fileName: string; changeLog: { section: string; before: string | null; after: string | null; reason: string }[]; truthWarnings: string[]; updatedAt: string } | null;
  tailorTask: TaskStatus;
  hasApiKey: boolean;
}

interface Props {
  jobId: number;
  title: string;
  company: string;
  applyUrl: string;
  /** The dashboard you came from; the application is tracked in its pipeline. */
  searchId: number | null;
  onApplied: () => void;
}

export function ApplyButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>
        <Send aria-hidden className="size-4" /> Apply
      </button>
      {open && <ApplyDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The boards the extension's form engine knows. Others open in a tab without prefilling. */
const PREFILLABLE = /(^|\.)greenhouse\.io$|^jobs\.lever\.co$|^jobs\.ashbyhq\.com$/;

function canPrefill(applyUrl: string): boolean {
  try {
    return PREFILLABLE.test(new URL(applyUrl).host);
  } catch {
    return false;
  }
}

function ApplyDialog({ jobId, title, company, applyUrl, searchId, onApplied, onClose }: Props & { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const ext = useExtension();
  const letterId = useId();
  const [state, setState] = useState<PrepareState | null>(null);
  const [choice, setChoice] = useState<"yes" | "no" | null>(null);
  const [resumeChoice, setResumeChoice] = useState<"master" | "tailored">("master");
  const [showChanges, setShowChanges] = useState(false);
  const [letter, setLetter] = useState("");
  const [letterDirty, setLetterDirty] = useState(false);
  const [busy, setBusy] = useState<null | "prepare" | "open" | "save" | "tailor" | "applied">(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<"extension" | "plain" | null>(null);
  /** After the board opens: whether to ask if you submitted it, and what you answered. */
  const [asked, setAsked] = useState<"unasked" | "asking" | "dismissed" | "marked" | "confirmed">("unasked");
  const prefillable = canPrefill(applyUrl);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/applications/${jobId}/prepare`);
    const body = (await res.json()) as PrepareState;
    setState(body);
    if (body.application?.coverLetter && !letterDirty) setLetter(body.application.coverLetter);
    return body;
  }, [jobId, letterDirty]);

  useEffect(() => {
    void load().then((s) => {
      // "Ask each time": only preselect if you already chose for this job.
      if (s.application?.coverLetterChoice) setChoice(s.application.coverLetterChoice);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generating = state?.coverLetterTask.status === "queued" || state?.coverLetterTask.status === "running";
  const tailoring = state?.tailorTask.status === "queued" || state?.tailorTask.status === "running";
  useEffect(() => {
    if (!generating && !tailoring) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [generating, tailoring, load]);

  /**
   * The board is open in another tab, so coming back here is the moment you know whether you
   * submitted. Re-read the application first: with the extension, the site's confirmation may
   * already have moved it, and then there is nothing to ask.
   */
  useEffect(() => {
    if (!opened) return;
    const onReturn = () => {
      void load().then((s) => {
        if (s.application?.status === "applied") setAsked((a) => (a === "marked" ? a : "confirmed"));
        else setAsked((a) => (a === "unasked" || a === "dismissed" ? "asking" : a));
      });
    };
    // Both fire on the way back from the board's tab; the window regaining focus is the signal,
    // and visibility only matters for the tab switch, where focus may not move at all.
    const onVisible = () => document.visibilityState === "visible" && onReturn();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onReturn);
    };
  }, [opened, load]);

  /** Records what you say you did. The same call as the job page's Tracker, so it's a manual move with history. */
  async function markApplied() {
    setBusy("applied");
    setError(null);
    try {
      await setApplicationStatus(jobId, "applied", searchId);
      setAsked("marked");
      onApplied();
    } catch (err) {
      // A failed fetch says "Load failed"; only the API's own message is worth repeating.
      const message = err instanceof Error ? err.message : "";
      setError(!message || /fetch|network|load failed/i.test(message) ? "Couldn't reach the server, so it's still in Applying." : message);
    }
    setBusy(null);
  }

  async function tailor() {
    setBusy("tailor");
    setError(null);
    const res = await fetch(`/api/applications/${jobId}/tailor`, { method: "POST" });
    setBusy(null);
    if (!res.ok) {
      setError((await res.json()).error ?? "Couldn't start tailoring.");
      return;
    }
    await load();
  }

  async function prepare(regenerate = false) {
    if (!choice) return;
    setBusy("prepare");
    setError(null);
    const res = await fetch(`/api/applications/${jobId}/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coverLetter: choice, resume: resumeChoice, regenerate, searchId }),
    });
    const body = await res.json();
    setBusy(null);
    if (!res.ok) {
      setError(body.error ?? "Couldn't prepare the application.");
      return null;
    }
    if (regenerate) {
      setLetter("");
      setLetterDirty(false);
    }
    await load();
    return body.application as { id: number };
  }

  async function saveLetter() {
    setBusy("save");
    const res = await fetch(`/api/applications/${jobId}/cover-letter`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: letter }),
    });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json();
      setError(body.issues?.[0]?.message ?? body.error ?? "Couldn't save the cover letter.");
      return false;
    }
    setLetterDirty(false);
    return true;
  }

  async function openApplication() {
    if (!choice) return;
    setBusy("open");
    setError(null);
    if (letterDirty && !(await saveLetter())) {
      setBusy(null);
      return;
    }
    // Idempotent: records the choice and moves the job to Applying; never rewrites an existing letter.
    const app = await prepare();
    if (!app) {
      setBusy(null);
      return;
    }
    const viaExtension = ext.installed && prefillable && (await openThroughExtension(app.id, applyUrl));
    if (!viaExtension) window.open(applyUrl, "_blank", "noopener");
    setOpened(viaExtension ? "extension" : "plain");
    setBusy(null);
    onApplied();
  }

  const close = () => {
    ref.current?.close();
    onClose();
  };

  const needsLetter = choice === "yes";
  const letterReady = Boolean(state?.application?.coverLetter) && state?.application?.coverLetterChoice === "yes";
  const canOpen = choice !== null && (!needsLetter || letterReady) && busy === null;

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-labelledby="apply-title"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-surface p-0 text-text backdrop:bg-black/40"
    >
      <div className="flex items-start gap-3 border-b border-border p-5">
        <div className="min-w-0 flex-1">
          <h2 id="apply-title" className="section-title">
            Apply to {company}
          </h2>
          <p className="truncate text-sm text-muted">{title}</p>
        </div>
        <button className="btn-ghost" onClick={close} aria-label="Close">
          <X aria-hidden className="size-4" />
        </button>
      </div>

      {!state ? (
        <div className="space-y-3 p-5" aria-busy>
          <Skeleton className="h-16" />
          <Skeleton className="h-24" />
        </div>
      ) : opened ? (
        <div className="space-y-4 p-5">
          <p className="flex items-center gap-2 font-medium text-good">
            <CheckCircle2 aria-hidden className="size-5" /> Application opened in a new tab
          </p>
          {opened === "extension" ? (
            <p className="text-sm text-muted">
              The extension is filling the form. Review every field in its panel, then click the site&apos;s Submit button yourself. The job moves to
              Applied when the site confirms.
            </p>
          ) : prefillable ? (
            <Alert>
              The extension isn&apos;t installed, so the form won&apos;t be prefilled. See{" "}
              <Link href="/extension" className="font-medium underline">
                the extension setup
              </Link>
              .
            </Alert>
          ) : (
            <Alert>
              This job board isn&apos;t one the extension can fill yet, so the form opens blank. Your standing answers are on the{" "}
              <Link href="/answers" className="font-medium underline">
                Answers
              </Link>{" "}
              page to copy from.
            </Alert>
          )}
          {asked === "marked" || asked === "confirmed" ? (
            <p className="flex items-center gap-2 text-sm font-medium text-good">
              <CheckCircle2 aria-hidden className="size-4" />
              {asked === "confirmed" ? "The site confirmed it — moved to Applied." : "Moved to Applied."}
            </p>
          ) : asked === "asking" ? (
            // Asked on your way back, when you know the answer and nothing else here does.
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-sm font-medium">Did you submit your application?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn-primary" onClick={() => void markApplied()} disabled={busy !== null}>
                  {busy === "applied" ? <Spinner /> : <CheckCircle2 aria-hidden className="size-4" />} Yes, mark it Applied
                </button>
                <button className="btn" onClick={() => setAsked("dismissed")} disabled={busy !== null}>
                  Not yet
                </button>
              </div>
            </div>
          ) : (
            // The extension usually reports it, so there it's a fallback rather than the main action.
            <button className={opened === "extension" ? "btn" : "btn-primary"} onClick={() => void markApplied()} disabled={busy !== null}>
              {busy === "applied" ? <Spinner /> : <CheckCircle2 aria-hidden className="size-4" />}
              {opened === "extension" ? "Didn't move on its own? Mark as Applied" : "I've submitted it"}
            </button>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end">
            <button className="btn" onClick={close}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5 p-5">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">Resume</legend>
            {state.resume ? (
              <>
                <label className="flex min-h-11 items-center gap-3 rounded-lg border border-accent bg-accent-soft/50 px-3 text-sm">
                  <input type="radio" name="resume" defaultChecked className="size-4 accent-[var(--accent)]" />
                  <FileText aria-hidden className="size-4 text-accent" />
                  <span className="flex-1">
                    Master resume <span className="text-muted">· {state.resume.fileName}</span>
                  </span>
                </label>
                <label className={`flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm ${resumeChoice === "tailored" ? "border-accent bg-accent-soft/50" : "border-border"}`}>
                  <input
                    type="radio"
                    name="resume"
                    className="size-4 accent-[var(--accent)]"
                    checked={resumeChoice === "tailored"}
                    disabled={!state.tailored}
                    onChange={() => setResumeChoice("tailored")}
                  />
                  <PenLine aria-hidden className="size-4 text-accent" />
                  <span className="flex-1">
                    Tailored for this job
                    {state.tailored && <span className="text-muted"> · updated {timeAgo(state.tailored.updatedAt)}</span>}
                  </span>
                  {tailoring ? (
                    <Spinner label="Writing…" />
                  ) : state.tailored ? (
                    <button className="btn min-h-8 px-2 text-xs" onClick={() => void tailor()} disabled={busy !== null}>
                      <RefreshCw aria-hidden className="size-3.5" /> Redo
                    </button>
                  ) : (
                    <button className="btn min-h-8 px-2 text-xs" onClick={() => void tailor()} disabled={busy !== null || !state.hasApiKey}>
                      <Sparkles aria-hidden className="size-3.5" /> Tailor (~$0.05)
                    </button>
                  )}
                </label>
                {state.tailorTask.status === "failed" && <Alert tone="danger">Tailoring failed: {state.tailorTask.error}</Alert>}
                {state.tailored && (
                  <div className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <button className="btn min-h-8 px-2 text-xs" onClick={() => setShowChanges((s) => !s)} aria-expanded={showChanges}>
                        {showChanges ? "Hide" : "Show"} {state.tailored.changeLog.length} change{state.tailored.changeLog.length === 1 ? "" : "s"}
                      </button>
                      <a className="btn min-h-8 px-2 text-xs" href={`/api/resume/${state.tailored.id}/file`} target="_blank" rel="noreferrer">
                        Open PDF <ExternalLink aria-hidden className="size-3.5" />
                      </a>
                      <Link className="btn min-h-8 px-2 text-xs" href={`/profile?resume=${state.tailored.id}#resume`}>
                        Edit
                      </Link>
                    </div>
                    {state.tailored.truthWarnings.length > 0 && (
                      <Alert>
                        <span className="font-medium">Kept your original wording in {state.tailored.truthWarnings.length} place(s).</span>{" "}
                        {state.tailored.truthWarnings.slice(0, 2).join(" ")}
                      </Alert>
                    )}
                    {showChanges && (
                      <ul className="mt-2 space-y-2">
                        {state.tailored.changeLog.map((c, i) => (
                          <li key={i} className="border-l-2 border-border pl-3">
                            <p className="text-xs font-semibold tracking-wide text-muted uppercase">{c.section}</p>
                            {c.before && <p className="text-xs text-muted line-through">{c.before}</p>}
                            {c.after ? <p>{c.after}</p> : <p className="text-xs text-muted italic">Dropped</p>}
                            <p className="text-xs text-muted">{c.reason}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            ) : (
              <Alert>
                No resume yet.{" "}
                <Link href="/profile#resume" className="font-medium underline">
                  Upload one
                </Link>{" "}
                so the form gets your resume attached.
              </Alert>
            )}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">Write a cover letter?</legend>
            {state.formInfo.coverLetterRequired === true && <p className="text-xs font-medium text-warn">This form requires a cover letter.</p>}
            {state.formInfo.hasCoverLetterField === false && <p className="text-xs text-muted">This form has no cover letter field.</p>}
            <div className="grid grid-cols-2 gap-2">
              {(["yes", "no"] as const).map((c) => (
                <label
                  key={c}
                  className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ${
                    choice === c ? "border-accent bg-accent-soft/50" : "border-border hover:border-border-strong"
                  }`}
                >
                  <input type="radio" name="cover" className="size-4 accent-[var(--accent)]" checked={choice === c} onChange={() => setChoice(c)} />
                  {c === "yes" ? "Yes, write one" : "No"}
                </label>
              ))}
            </div>
            {needsLetter && !state.hasApiKey && <Alert>Add an AI API key to .env.local to generate cover letters.</Alert>}
            {needsLetter && state.hasApiKey && (
              <div className="space-y-2 pt-1">
                {generating ? (
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <Spinner label="Writing your cover letter (about 20 seconds)…" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                ) : letterReady || letter ? (
                  <>
                    <label htmlFor={letterId} className="label">
                      Cover letter (edit freely; the form gets exactly this)
                    </label>
                    <textarea
                      id={letterId}
                      className="input min-h-56 leading-relaxed"
                      value={letter}
                      onChange={(e) => {
                        setLetter(e.target.value);
                        setLetterDirty(true);
                      }}
                    />
                    {!letterDirty && (state.application?.coverLetterWarnings?.length ?? 0) > 0 && (
                      <Alert>
                        Couldn&apos;t match these to your resume or the posting: {state.application!.coverLetterWarnings!.join(", ")}. Check or remove them
                        before sending.
                      </Alert>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted tabular-nums">{letter.trim().split(/\s+/).filter(Boolean).length} words</span>
                      <div className="flex gap-2">
                        <button className="btn" onClick={() => void prepare(true)} disabled={busy !== null}>
                          <RefreshCw aria-hidden className="size-4" /> Rewrite
                        </button>
                        <button className="btn" onClick={() => void saveLetter()} disabled={!letterDirty || busy !== null}>
                          {busy === "save" ? "Saving…" : "Save edits"}
                        </button>
                      </div>
                    </div>
                  </>
                ) : state.coverLetterTask.status === "failed" ? (
                  <Alert tone="danger">
                    Couldn&apos;t write the cover letter: {state.coverLetterTask.error}{" "}
                    <button className="font-medium underline" onClick={() => void prepare(true)}>
                      Try again
                    </button>
                  </Alert>
                ) : (
                  <button className="btn" onClick={() => void prepare()} disabled={busy !== null}>
                    <PenLine aria-hidden className="size-4" /> {busy === "prepare" ? "Starting…" : "Write cover letter"}
                  </button>
                )}
              </div>
            )}
          </fieldset>

          <p className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
            <Puzzle aria-hidden className="size-4 shrink-0" />
            {!prefillable
              ? "The extension doesn't fill this job board yet — the application opens without prefilling."
              : ext.installed
                ? "The extension will fill the form. You review and click Submit yourself."
                : "Extension not detected: the application opens without prefilling."}
          </p>

          {error && <Alert tone="danger">{error}</Alert>}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button className="btn" onClick={close}>
              Cancel
            </button>
            <button className="btn-primary" onClick={() => void openApplication()} disabled={!canOpen}>
              {busy === "open" ? "Opening…" : "Open application"} <ExternalLink aria-hidden className="size-4" />
            </button>
          </div>
          {choice === null && <p className="-mt-2 text-right text-xs text-muted">Choose whether to include a cover letter.</p>}
          {needsLetter && !letterReady && !generating && state.hasApiKey && <p className="-mt-2 text-right text-xs text-muted">Write the cover letter first.</p>}
        </div>
      )}
    </dialog>
  );
}
