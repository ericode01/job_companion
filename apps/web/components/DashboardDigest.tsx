"use client";

import { Bell, BellOff, CheckCircle2, Eye, Mail, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import { Alert } from "@/components/ui";
import { timeAgo } from "@/lib/format";

interface Props {
  dashboardId: number;
  name: string;
  notify: boolean;
  digestMinFit: number | null;
  account: { enabled: boolean; to: string; sendTime: string; minFitScore: number; timezone: string };
}
interface Status {
  lastRun: { status: string; sentAt: string; error: string | null; jobIds: number[] } | null;
  preview: { total: number; sections: { searchId: number; query: string; count: number; belowThreshold: number }[] };
}

/**
 * This dashboard's part of your daily email. Delivery (address, time) is shared across
 * searches and lives under Account; here you decide whether this search is in it and how
 * good a match has to be.
 */
export function DashboardDigest({ dashboardId, name, notify: initialNotify, digestMinFit, account }: Props) {
  const router = useRouter();
  const fitId = useId();
  const [notify, setNotify] = useState(initialNotify);
  const [minFit, setMinFit] = useState<number | null>(digestMinFit);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<null | "toggle" | "fit" | "send" | "preview" | "enable">(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [enabled, setEnabled] = useState(account.enabled);

  const load = useCallback(() => fetch("/api/digest").then((r) => r.json()).then(setStatus), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/searches/${dashboardId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't save.");
  }

  async function toggle() {
    setBusy("toggle");
    try {
      await patch({ notify: !notify });
      setNotify(!notify);
      router.refresh();
      await load();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function turnOnEmail() {
    setBusy("enable");
    const current = await fetch("/api/settings/digest").then((r) => r.json());
    const res = await fetch("/api/settings/digest", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...current, enabled: true }) });
    setBusy(null);
    if (res.ok) setEnabled(true);
  }

  async function send() {
    setBusy("send");
    setMessage(null);
    const res = await fetch("/api/digest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "send" }) });
    const body = await res.json();
    setBusy(null);
    setMessage({ ok: body.status === "sent", text: body.status === "sent" ? `Sent “${body.subject}” to ${account.to}.` : (body.reason ?? "Couldn't send.") });
    await load();
  }

  async function preview() {
    setBusy("preview");
    const res = await fetch("/api/digest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "preview" }) });
    const html = await res.text();
    setBusy(null);
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  }

  const section = status?.preview.sections.find((s) => s.searchId === dashboardId);
  const threshold = minFit ?? account.minFitScore;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <section className="card space-y-5 p-5 sm:p-6" aria-labelledby="digest-this">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="digest-this" className="section-title">
              New matches from this search, by email
            </h2>
            <p className="text-sm text-muted">One email a day at most, with a section for each search you include.</p>
          </div>
          <button className={notify ? "btn" : "btn-primary"} aria-pressed={notify} onClick={() => void toggle()} disabled={busy !== null}>
            {notify ? <BellOff aria-hidden className="size-4" /> : <Bell aria-hidden className="size-4" />}
            {notify ? "Remove from email" : "Include in email"}
          </button>
        </div>

        <p className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${notify ? "bg-good-soft text-good" : "bg-surface-2 text-muted"}`} role="status">
          {notify ? <CheckCircle2 aria-hidden className="size-4" /> : <BellOff aria-hidden className="size-4" />}
          {notify ? `“${name}” is in your daily email.` : `“${name}” isn't in your daily email.`}
        </p>

        <div className={notify ? "" : "opacity-60"}>
          <label htmlFor={fitId} className="label">
            Only include jobs that fit at least
          </label>
          <select
            id={fitId}
            className="input max-w-xs"
            disabled={!notify || busy !== null}
            value={minFit === null ? "" : String(minFit)}
            onChange={async (e) => {
              const v = e.target.value === "" ? null : Number(e.target.value);
              setMinFit(v);
              setBusy("fit");
              await patch({ digestMinFit: v }).catch(() => {});
              setBusy(null);
              await load();
            }}
          >
            <option value="">Your default ({account.minFitScore})</option>
            {[0, 50, 60, 70, 80, 85].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Any fit" : `${n}+`}
              </option>
            ))}
          </select>
          <p className="helper">Jobs without a fit score yet are always included. Current threshold: {threshold}.</p>
        </div>

        {notify && status && (
          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-sm">
              {section && section.count > 0 ? (
                <>
                  <span className="font-semibold tabular-nums">{section.count}</span> new job{section.count === 1 ? "" : "s"} from this search would go in the next email
                  {section.belowThreshold > 0 && <span className="text-muted"> ({section.belowThreshold} below your fit threshold left out)</span>}.
                </>
              ) : (
                <span className="text-muted">Nothing new from this search since your last email.</span>
              )}
            </p>
            {message && (message.ok ? <p className="text-sm text-good">{message.text}</p> : <Alert tone="danger">{message.text}</Alert>)}
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={() => void preview()} disabled={busy !== null}>
                <Eye aria-hidden className="size-4" /> {busy === "preview" ? "Opening…" : "Preview the email"}
              </button>
              <button className="btn" onClick={() => void send()} disabled={busy !== null || !account.to}>
                <Send aria-hidden className="size-4" /> {busy === "send" ? "Sending…" : "Send it now"}
              </button>
            </div>
          </div>
        )}
      </section>

      <aside className="card h-fit space-y-3 p-5 text-sm" aria-labelledby="delivery">
        <h2 id="delivery" className="flex items-center gap-2 font-semibold">
          <Mail aria-hidden className="size-4 text-accent" /> Delivery
        </h2>
        {enabled && account.to ? (
          <p className="text-muted">
            Sent to <span className="font-medium text-text">{account.to}</span> daily at{" "}
            <span className="font-medium text-text tabular-nums">{account.sendTime}</span> ({account.timezone.replace(/_/g, " ")}).
          </p>
        ) : !account.to ? (
          <Alert>No email address yet. Add one to start getting this.</Alert>
        ) : (
          <div className="space-y-2">
            <Alert>Your daily email is turned off, so nothing is sent.</Alert>
            <button className="btn-primary w-full" onClick={() => void turnOnEmail()} disabled={busy !== null}>
              Turn on daily email
            </button>
          </div>
        )}
        {status?.lastRun && (
          <p className="text-muted">
            Last email {timeAgo(status.lastRun.sentAt)}: {status.lastRun.status}
            {status.lastRun.error ? ` — ${status.lastRun.error}` : ""}
          </p>
        )}
        <Link href="/account#digest" className="btn w-full">
          Change address or time
        </Link>
      </aside>
    </div>
  );
}
