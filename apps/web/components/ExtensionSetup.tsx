"use client";

import { Check, CheckCircle2, CircleDashed, Copy, Download, FolderOpen, MousePointerClick, Puzzle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, ConfirmDialog } from "@/components/ui";
import { useExtension } from "@/lib/extension";
import { timeAgo } from "@/lib/format";

interface Props {
  build: { available: boolean; version: string | null; builtFor: string[] };
  origin: string;
  isAdmin: boolean;
}

/**
 * Four steps with a live check at the end: the page pings the extension every two seconds, so
 * the moment Chrome loads it the last step turns green without a reload.
 */
export function ExtensionSetup({ build, origin, isAdmin }: Props) {
  const ext = useExtension({ poll: true });
  const [status, setStatus] = useState<{ connected: boolean; lastSeenAt: number | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const load = () => fetch("/api/extension/status").then((r) => r.json()).then(setStatus);
  useEffect(() => {
    void load();
  }, []);

  const installed = ext.installed;
  const outdated = installed && build.version && ext.version && ext.version !== build.version;
  const wrongServer = build.builtFor.length > 0 && !build.builtFor.includes(origin);

  async function copy() {
    await navigator.clipboard.writeText("chrome://extensions");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const steps = [
    {
      title: "Download the extension",
      icon: Download,
      done: downloaded || installed,
      body: build.available ? (
        <a href="/api/extension/download" className="btn-primary" onClick={() => setDownloaded(true)} download>
          <Download aria-hidden className="size-4" /> Download for Chrome{build.version ? ` (v${build.version})` : ""}
        </a>
      ) : (
        <Alert>
          The extension hasn&apos;t been built on this server yet.{" "}
          {isAdmin ? (
            <>
              Build it with <code className="rounded bg-surface px-1">APP_URL={origin} pnpm --filter @jd/extension build</code>, then reload.
            </>
          ) : (
            "Ask your admin to build it."
          )}
        </Alert>
      ),
    },
    {
      title: "Unzip it",
      icon: FolderOpen,
      done: installed,
      body: <p>Double-click the downloaded file. You&apos;ll get a folder called <strong>job-companion-extension</strong>. Keep it somewhere it won&apos;t be deleted, like Documents.</p>,
    },
    {
      title: "Add it to Chrome",
      icon: Puzzle,
      done: installed,
      body: (
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Open a new tab and go to{" "}
            <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs hover:border-border-strong">
              chrome://extensions {copied ? <Check aria-hidden className="size-3 text-good" /> : <Copy aria-hidden className="size-3" />}
            </button>
            <span className="sr-only" aria-live="polite">
              {copied ? "Copied" : ""}
            </span>{" "}
            <span className="text-muted">(click to copy; Chrome doesn&apos;t allow links to it)</span>
          </li>
          <li>
            Turn on <strong>Developer mode</strong> (top right).
          </li>
          <li>
            Click <strong>Load unpacked</strong> and choose the <strong>job-companion-extension</strong> folder.
          </li>
        </ol>
      ),
    },
    {
      title: "Come back to this tab",
      icon: MousePointerClick,
      done: installed,
      body: installed ? (
        <p className="flex items-center gap-2 font-medium text-good">
          <CheckCircle2 aria-hidden className="size-5" /> Installed{ext.version ? ` (v${ext.version})` : ""} and linked to your account.
        </p>
      ) : (
        <p className="flex items-center gap-2 text-muted" role="status">
          <CircleDashed aria-hidden className="size-4 animate-spin" /> Waiting for Chrome to load it… this updates by itself.
        </p>
      ),
    },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="space-y-4">
        {outdated && <Alert>A newer version (v{build.version}) is available. Download it again and click the reload icon on the extension in chrome://extensions.</Alert>}
        {wrongServer && isAdmin && (
          <Alert>
            The download was built for {build.builtFor.join(", ")}, but this server is {origin}. Rebuild with APP_URL={origin}.
          </Alert>
        )}
        <ol className="space-y-3">
          {steps.map((s, i) => {
            const state = s.done ? "done" : i === current ? "current" : "todo";
            return (
              <li key={s.title} className={`card flex gap-4 p-4 sm:p-5 ${state === "current" ? "border-accent" : ""}`} aria-current={state === "current" ? "step" : undefined}>
                <span
                  aria-hidden
                  className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold ${
                    state === "done" ? "bg-good-soft text-good" : state === "current" ? "bg-accent text-on-accent" : "bg-surface-2 text-muted"
                  }`}
                >
                  {state === "done" ? <Check className="size-4" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-2 text-sm">
                  <h2 className="flex items-center gap-2 text-base font-semibold">
                    {s.title}
                    {state === "done" && <span className="sr-only">(done)</span>}
                  </h2>
                  {(state !== "done" || i === steps.length - 1) && <div>{s.body}</div>}
                </div>
              </li>
            );
          })}
        </ol>
        {installed && (
          <div className="companion flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="flex-1 text-sm">
              <p className="font-semibold">You&apos;re set. Try it on a real job.</p>
              <p className="text-muted">Open a job, click Apply, and the form fills itself in. Check every field, then press Submit yourself.</p>
            </div>
            <Link href="/" className="btn-primary shrink-0">
              Go to my jobs
            </Link>
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <section className="card space-y-2 p-4 text-sm" aria-labelledby="what-it-does">
          <h2 id="what-it-does" className="flex items-center gap-2 font-semibold">
            <ShieldCheck aria-hidden className="size-4 text-accent" /> What it does
          </h2>
          <ul className="list-disc space-y-1 pl-4 text-muted">
            <li>Runs only on Greenhouse, Lever and Ashby application pages, and on this site.</li>
            <li>Fills your contact details, resume, cover letter and saved answers.</li>
            <li>Asks you about anything it isn&apos;t sure of.</li>
            <li>Never presses Submit. You always do.</li>
          </ul>
        </section>
        <section className="card space-y-2 p-4 text-sm" aria-labelledby="ext-status">
          <h2 id="ext-status" className="font-semibold">
            Status
          </h2>
          <p className="text-muted">
            {installed ? `Installed in this browser${ext.version ? ` (v${ext.version})` : ""}.` : "Not detected in this browser."}{" "}
            {status?.lastSeenAt ? `Last filled a form ${timeAgo(new Date(status.lastSeenAt))}.` : "Hasn't filled a form yet."}
          </p>
          <button className="btn-danger w-full" onClick={() => setConfirm(true)}>
            Disconnect this extension
          </button>
          <p className="helper">Use this after installing it on a shared computer. It reconnects the next time you sign in there.</p>
        </section>
      </aside>

      <ConfirmDialog
        open={confirm}
        title="Disconnect the extension?"
        body="Any browser where it's installed loses access to your profile and answers until you sign in to Job Companion there again."
        confirmLabel="Disconnect"
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          await fetch("/api/extension/status", { method: "POST" });
          setConfirm(false);
          await load();
        }}
      />
    </div>
  );
}
