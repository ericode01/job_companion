"use client";

import { CheckCircle2, CircleAlert, Puzzle } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { useExtension } from "@/lib/extension";

export function ExtensionSettings() {
  const ext = useExtension();
  const [status, setStatus] = useState<{ connected: boolean; lastSeenAt: number | null; version: string | null } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const load = () => fetch("/api/extension/status").then((r) => r.json()).then(setStatus);
  useEffect(() => {
    void load();
  }, []);

  return (
    <section id="extension" aria-labelledby="extension-title" className="card scroll-mt-20 space-y-4 p-5 sm:p-6">
      <div>
        <h2 id="extension-title" className="section-title flex items-center gap-2">
          <Puzzle aria-hidden className="size-4 text-accent" /> Chrome extension
        </h2>
        <p className="text-sm text-muted">Fills Greenhouse, Lever, and Ashby applications in your own Chrome. It never clicks Submit.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {ext.installed ? (
          <span className="chip bg-good-soft text-good">
            <CheckCircle2 aria-hidden className="size-3.5" /> Installed in this browser (v{ext.version})
          </span>
        ) : (
          <span className="chip bg-warn-soft text-warn">
            <CircleAlert aria-hidden className="size-3.5" /> Not detected in this browser
          </span>
        )}
        {status?.lastSeenAt && <span className="text-muted">Last used {timeAgo(new Date(status.lastSeenAt))}</span>}
      </div>
      <details className="rounded-lg bg-surface-2 p-3 text-sm" open={!ext.installed}>
        <summary className="font-medium">Install (one time)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
          <li>
            Build it: <code className="rounded bg-surface px-1 py-0.5 text-text">pnpm --filter @jd/extension build</code>
          </li>
          <li>
            In Chrome open <code className="rounded bg-surface px-1 py-0.5 text-text">chrome://extensions</code> and turn on Developer mode.
          </li>
          <li>
            Click <strong className="text-text">Load unpacked</strong> and choose <code className="rounded bg-surface px-1 py-0.5 text-text">apps/extension/dist</code>.
          </li>
          <li>Reload this page. The extension pairs with the app automatically.</li>
        </ol>
      </details>
      <div className="flex justify-end">
        <button className="btn-danger" onClick={() => setConfirm(true)}>
          Unpair extension
        </button>
      </div>
      <ConfirmDialog
        open={confirm}
        title="Unpair the extension?"
        body="The extension loses access to your profile and answers. It pairs again the next time you open this app in a browser that has it installed."
        confirmLabel="Unpair"
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          await fetch("/api/extension/status", { method: "POST" });
          setConfirm(false);
          await load();
        }}
      />
    </section>
  );
}
