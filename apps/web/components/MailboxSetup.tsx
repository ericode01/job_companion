"use client";

import type { EmailKind } from "@jd/core/shared";
import { GMAIL_DOMAINS, IMAP_PRESETS, type ImapPreset, LOOKBACK_CHOICES, presetFor, UNSUPPORTED_DOMAINS } from "@jd/mail/shared";
import {
  BellRing,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Mail,
  MailPlus,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Workflow,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Benefits } from "@/components/Onboarding";
import { ReviewList } from "@/components/ReviewList";
import { Alert, SkeletonList } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import type { ReviewJson } from "@/lib/pipeline-types";

interface Conn {
  id: number;
  provider: "gmail" | "imap";
  address: string;
  status: "active" | "needs_reauth" | "paused" | "error" | "disconnected";
  imapHost: string | null;
  backfillDays: number;
  backfillDone: boolean;
  progress: { done: number; total: number } | null;
  lastSyncAt: string | null;
  lastError: string | null;
  stats: { byKind: Partial<Record<EmailKind, number>>; createdApplications: number };
}

interface Overview {
  enabled: boolean;
  google: boolean;
  allowImap: boolean;
  testMailbox: boolean;
  connections: Conn[];
  review: ReviewJson[];
  applications: { id: number; label: string }[];
}

const domainOf = (a: string) => a.split("@")[1]?.toLowerCase() ?? "";

/**
 * Connect a mailbox read-only and see what it found. Gmail uses Google sign-in with read-only
 * access; everything else connects by IMAP with an app password.
 */
export function MailboxSetup({ connected, error, isAdmin }: { connected: string | null; error: string | null; isAdmin: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [fastPoll, setFastPoll] = useState(Boolean(connected));
  const [justConnected, setJustConnected] = useState(connected);

  const load = useCallback(async () => {
    const res = await fetch("/api/mail/connections");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Fast while a check is running or just started; slow otherwise.
  const busy = data?.connections.some((c) => c.progress) ?? false;
  useEffect(() => {
    const t = setInterval(() => void load(), busy || fastPoll ? 2500 : 30_000);
    return () => clearInterval(t);
  }, [busy, fastPoll, load]);
  useEffect(() => {
    if (!fastPoll) return;
    const t = setTimeout(() => setFastPoll(false), 120_000);
    return () => clearTimeout(t);
  }, [fastPoll]);

  // Drop ?connected / ?error from the address bar so a reload doesn't repeat the message.
  useEffect(() => {
    if (!connected && !error) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("connected");
    url.searchParams.delete("error");
    window.history.replaceState(window.history.state, "", url);
  }, [connected, error]);

  if (!data) return <SkeletonList rows={3} />;
  if (!data.enabled) {
    return <Alert>Mailbox sync is turned off on this server.{isAdmin ? " Turn it on in Admin → Mailbox sync." : ""}</Alert>;
  }

  const live = data.connections.filter((c) => c.status !== "disconnected");
  const past = data.connections.filter((c) => c.status === "disconnected");

  return (
    <div className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}
      {justConnected && (
        <div role="status" className="companion flex items-start gap-3 p-4">
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-good" />
          <p className="flex-1 text-sm">
            <span className="font-semibold">{justConnected} is connected.</span>{" "}
            <span className="text-muted">I&apos;m reading your recent job emails now. Your pipeline updates as I go; this page shows progress.</span>
          </p>
          <button type="button" className="btn-ghost size-9 px-0" aria-label="Dismiss" onClick={() => setJustConnected(null)}>
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}

      {live.length === 0 ? (
        <ConnectFirst data={data} isAdmin={isAdmin} onConnected={(addr) => (setJustConnected(addr), setFastPoll(true), void load())} />
      ) : (
        <>
          <ul className="space-y-3">
            {live.map((c) => (
              <ConnectionCard key={c.id} conn={c} google={data.google} onChanged={() => (setFastPoll(true), void load(), router.refresh())} />
            ))}
          </ul>
          <ReviewList id="check" items={data.review} applications={data.applications} onChanged={() => (void load(), router.refresh())} />
          <AnotherMailbox data={data} onConnected={(addr) => (setJustConnected(addr), setFastPoll(true), void load())} />
        </>
      )}

      {past.length > 0 && (
        <section aria-labelledby="past-title" className="card p-4">
          <h2 id="past-title" className="section-title">
            Disconnected
          </h2>
          <p className="mb-2 text-sm text-muted">I no longer read these. The job emails already found stay on your applications.</p>
          <ul className="divide-y divide-border text-sm">
            {past.map((c) => (
              <PastConnection key={c.id} conn={c} onChanged={() => void load()} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ---------- first connection ---------- */

function LookbackPicker({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="label">How far back should I look?</legend>
      <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface-2 p-1">
        {LOOKBACK_CHOICES.map((d) => (
          <label
            key={d}
            className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring ${
              value === d ? "bg-surface font-semibold text-text shadow-sm" : "text-muted hover:text-text"
            }`}
          >
            <input type="radio" name={name} value={d} className="sr-only" checked={value === d} onChange={() => onChange(d)} />
            {d} days
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PrivacyPanel() {
  const can = ["Read emails about your applications", "Link each email so you can open and reply in your mailbox", "Keep the sender, subject, date and a short preview of job emails"];
  const cannot = ["Send, delete, move or label anything", "Mark emails as read", "Keep any other email, or any email body"];
  return (
    <section aria-labelledby="privacy-title" className="card p-4 sm:p-5">
      <h2 id="privacy-title" className="section-title flex items-center gap-2">
        <ShieldCheck aria-hidden className="size-4 text-accent" /> What I can and can&apos;t do
      </h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <ul className="space-y-1.5 text-sm">
          {can.map((t) => (
            <li key={t} className="flex gap-2">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-good" />
              <span>
                <span className="sr-only">Can: </span>
                {t}
              </span>
            </li>
          ))}
        </ul>
        <ul className="space-y-1.5 text-sm">
          {cannot.map((t) => (
            <li key={t} className="flex gap-2">
              <X aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
              <span>
                <span className="sr-only">Can&apos;t: </span>
                {t}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-xs text-muted">
        To sort an email, its text is sent to Claude (Anthropic&apos;s AI) and not kept afterwards. Most mail is skipped on its sender and subject alone and never read. You can disconnect at any time.
      </p>
    </section>
  );
}

function GoogleButton({ days, hint, label = "Connect Gmail" }: { days: number; hint?: string; label?: string }) {
  const href = `/api/mail/google/start?days=${days}${hint ? `&hint=${encodeURIComponent(hint)}` : ""}`;
  return (
    <a href={href} className="btn-primary min-h-11 px-4">
      <Mail aria-hidden className="size-4" /> {label}
    </a>
  );
}

function ConnectFirst({ data, isAdmin, onConnected }: { data: Overview; isAdmin: boolean; onConnected: (address: string) => void }) {
  const [days, setDays] = useState(90);
  const [imapOpen, setImapOpen] = useState(!data.google);
  return (
    <div className="space-y-6">
      <Benefits
        items={[
          { icon: Workflow, title: "Your pipeline updates itself", body: "Confirmations, interview invites, rejections and offers move each card, and interviews are sorted into rounds." },
          { icon: BellRing, title: "Never miss a reply", body: "Emails that need something from you, like picking a time or finishing a take-home, are flagged with their deadline." },
          { icon: MailPlus, title: "Catches applications made elsewhere", body: "Applied on LinkedIn or a company site? The confirmation email adds it to your pipeline, linked to the job when I know it." },
        ]}
      />
      <PrivacyPanel />
      <section aria-labelledby="connect-title" className="card space-y-4 p-4 sm:p-5">
        <h2 id="connect-title" className="section-title">
          Connect your inbox
        </h2>
        <LookbackPicker value={days} onChange={setDays} />
        {data.google ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <GoogleButton days={days} />
            <p className="text-xs text-muted">Google asks you to allow read-only access. Nothing else is requested.</p>
          </div>
        ) : (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
            Gmail sign-in isn&apos;t set up on this server yet{isAdmin ? " (see Admin → Mailbox sync)" : ""}, so connect with an app password below. It works for Gmail too.
          </p>
        )}
        {data.allowImap && (
          <div className="rounded-lg border border-border">
            <button type="button" className="flex min-h-11 w-full items-center justify-between px-3 text-left text-sm font-semibold" aria-expanded={imapOpen} onClick={() => setImapOpen((o) => !o)}>
              <span className="flex items-center gap-2">
                <KeyRound aria-hidden className="size-4 text-muted" />
                {data.google ? "Use another provider (iCloud, Fastmail, Yahoo…)" : "Connect with an app password"}
              </span>
              <ChevronDown aria-hidden className={`size-4 transition-transform ${imapOpen ? "rotate-180" : ""}`} />
            </button>
            {imapOpen && (
              <div className="border-t border-border p-3">
                <ImapForm days={days} google={data.google} testMailbox={data.testMailbox} onConnected={onConnected} />
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function AnotherMailbox({ data, onConnected }: { data: Overview; onConnected: (address: string) => void }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(90);
  return (
    <section className="rounded-xl border border-border bg-surface">
      <button type="button" className="flex min-h-11 w-full items-center justify-between px-4 text-left text-sm font-semibold" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="flex items-center gap-2">
          <MailPlus aria-hidden className="size-4 text-muted" /> Connect another mailbox
        </span>
        <ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-border p-4">
          <LookbackPicker value={days} onChange={setDays} />
          {data.google && <GoogleButton days={days} />}
          {data.allowImap && <ImapForm days={days} google={data.google} testMailbox={data.testMailbox} onConnected={onConnected} />}
        </div>
      )}
    </section>
  );
}

/* ---------- IMAP ---------- */

function ImapForm({
  days,
  google,
  testMailbox,
  onConnected,
  prefill,
}: {
  days: number;
  google: boolean;
  testMailbox: boolean;
  onConnected: (address: string) => void;
  prefill?: { address: string; host: string | null };
}) {
  const ids = { preset: useId(), address: useId(), host: useId(), port: useId(), password: useId(), help: useId() };
  const presets: ImapPreset[] = [
    ...IMAP_PRESETS.filter((p) => !(google && p.id === "gmail-imap")),
    ...(testMailbox ? [{ id: "test", label: "Test mailbox (development)", host: "fake.local", port: 993, domains: [], help: "Reads .eml files from MAIL_FAKE_DIR." }] : []),
  ];
  const initial = prefill ? (presets.find((p) => p.host === prefill.host) ?? presets.find((p) => p.id === "other")!) : presets[0]!;
  const [preset, setPreset] = useState<ImapPreset>(initial);
  const [address, setAddress] = useState(prefill?.address ?? "");
  const [host, setHost] = useState(prefill?.host ?? initial.host);
  const [port, setPort] = useState(initial.port);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const domain = domainOf(address);
  const gmailHint = google && GMAIL_DOMAINS.includes(domain);
  const unsupported = UNSUPPORTED_DOMAINS.includes(domain);

  const choose = (p: ImapPreset) => {
    setPreset(p);
    setHost(p.host);
    setPort(p.port);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/mail/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, host, port, password, backfillDays: days }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(out.error ?? "Couldn't connect.");
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setPassword("");
    onConnected(out.address ?? address);
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-describedby={ids.help}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={ids.preset} className="label">
            Provider
          </label>
          <select id={ids.preset} className="input min-h-10" value={preset.id} onChange={(e) => choose(presets.find((p) => p.id === e.target.value)!)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.address} className="label">
            Email address
          </label>
          <input
            id={ids.address}
            className="input min-h-10"
            type="email"
            autoComplete="email"
            required
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              const p = presetFor(e.target.value);
              if (p && preset.id !== "test" && !(google && p.id === "gmail-imap")) choose(p);
            }}
          />
        </div>
      </div>
      {gmailHint && (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">That&apos;s a Gmail address: the Connect Gmail button above is simpler and strictly read-only.</p>
      )}
      {unsupported && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Outlook and Hotmail no longer accept app passwords for IMAP, so they can&apos;t be connected yet.</p>
      )}
      {(preset.id === "other" || !preset.host) && (
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
          <div>
            <label htmlFor={ids.host} className="label">
              IMAP server
            </label>
            <input id={ids.host} className="input min-h-10" required placeholder="imap.example.com" value={host} onChange={(e) => setHost(e.target.value)} />
          </div>
          <div>
            <label htmlFor={ids.port} className="label">
              Port
            </label>
            <input id={ids.port} className="input min-h-10" type="number" required value={port} onChange={(e) => setPort(Number(e.target.value))} />
          </div>
        </div>
      )}
      <div>
        <label htmlFor={ids.password} className="label">
          App password
        </label>
        <input
          id={ids.password}
          className="input min-h-10"
          type="password"
          autoComplete="off"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby={`${ids.help}-pw`}
        />
        <p id={`${ids.help}-pw`} className="helper">
          {preset.help}{" "}
          {preset.helpUrl && (
            <a href={preset.helpUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
              How to <ExternalLink aria-hidden className="size-3" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </p>
      </div>
      <p id={ids.help} className="text-xs text-muted">
        An app password is a separate password just for Job Companion; your real password is never used. It&apos;s stored encrypted, only used to read, and you can revoke it with your provider at any time.
      </p>
      {error && (
        <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <button className="btn-primary min-h-10" disabled={busy || unsupported}>
        {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <KeyRound aria-hidden className="size-4" />}
        {busy ? "Checking the connection…" : "Test and connect"}
      </button>
    </form>
  );
}

/* ---------- connected ---------- */

const KIND_WORDS: [EmailKind, string, string][] = [
  ["application_received", "confirmation", "confirmations"],
  ["interview_request", "interview email", "interview emails"],
  ["assessment", "assessment", "assessments"],
  ["rejection", "rejection", "rejections"],
  ["offer", "offer", "offers"],
];

function statsSentence(c: Conn): string | null {
  const b = c.stats.byKind;
  const interviews = (b.interview_request ?? 0) + (b.interview_scheduled ?? 0) + (b.interview_update ?? 0);
  const total = Object.values(b).reduce((n, x) => n + (x ?? 0), 0);
  if (!total) return null;
  const parts = KIND_WORDS.map(([k, one, many]) => {
    const n = k === "interview_request" ? interviews : (b[k] ?? 0);
    return n ? `${n} ${n === 1 ? one : many}` : null;
  }).filter(Boolean);
  const added = c.stats.createdApplications;
  return `Found ${total} job email${total === 1 ? "" : "s"}${parts.length ? `: ${parts.join(", ")}` : ""}${added ? `. Added ${added} application${added === 1 ? "" : "s"} you made elsewhere.` : "."}`;
}

function ConnectionCard({ conn: c, google, onChanged }: { conn: Conn; google: boolean; onChanged: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [purge, setPurge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnect, setReconnect] = useState(false);
  const daysId = useId();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (confirm && !d.open) d.showModal();
    if (!confirm && d.open) d.close();
  }, [confirm]);

  const call = async (url: string, init: RequestInit) => {
    setError(null);
    const res = await fetch(url, init);
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "That didn't work.");
    onChanged();
  };
  const patch = (body: Record<string, unknown>) => call(`/api/mail/connections/${c.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const running = c.progress !== null;
  const stats = statsSentence(c);
  const status = running ? (
    <span className="chip bg-accent-soft text-accent">
      <LoaderCircle aria-hidden className="size-3 animate-spin" /> {c.progress!.total ? `Reading ${c.progress!.done} of ${c.progress!.total} job emails` : "Looking for job emails"}
    </span>
  ) : c.status === "needs_reauth" ? (
    <span className="chip bg-warn-soft text-warn">
      <CircleAlert aria-hidden className="size-3" /> Needs reconnecting
    </span>
  ) : c.status === "paused" ? (
    <span className="chip bg-surface-2 text-muted">
      <Pause aria-hidden className="size-3" /> Paused
    </span>
  ) : c.status === "error" ? (
    <span className="chip bg-danger-soft text-danger">
      <CircleAlert aria-hidden className="size-3" /> Last check failed
    </span>
  ) : c.lastSyncAt ? (
    <span className="chip bg-good-soft text-good">
      <CheckCircle2 aria-hidden className="size-3" /> Up to date
    </span>
  ) : (
    <span className="chip bg-accent-soft text-accent">
      <LoaderCircle aria-hidden className="size-3 animate-spin" /> Starting
    </span>
  );

  return (
    <li className="card space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <Mail className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{c.address}</p>
          <p className="text-xs text-muted">
            {c.provider === "gmail" ? "Gmail · read-only Google access" : `IMAP · ${c.imapHost} · read-only`} · looks back {c.backfillDays} days
            {c.lastSyncAt ? ` · checked ${timeAgo(c.lastSyncAt) === "today" ? new Date(c.lastSyncAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : timeAgo(c.lastSyncAt)}` : ""}
          </p>
        </div>
        <span role="status" aria-live="polite">
          {status}
        </span>
      </div>

      {running && c.progress!.total > 0 && (
        <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round((c.progress!.done / c.progress!.total) * 100)}%` }} />
        </div>
      )}
      {stats && <p className="text-sm">{stats}</p>}
      {c.lastError && !running && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          {c.lastError}
          {c.status === "needs_reauth" && c.provider === "imap" ? " Enter a new app password below." : ""}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {c.status === "needs_reauth" ? (
          c.provider === "gmail" && google ? (
            <GoogleButton days={c.backfillDays} hint={c.address} label="Reconnect Gmail" />
          ) : (
            <button type="button" className="btn-primary min-h-10" onClick={() => setReconnect((r) => !r)} aria-expanded={reconnect}>
              <KeyRound aria-hidden className="size-4" /> Reconnect
            </button>
          )
        ) : (
          <button type="button" className="btn min-h-10" disabled={running || c.status === "paused"} onClick={() => void call(`/api/mail/connections/${c.id}/sync`, { method: "POST" })}>
            <RefreshCw aria-hidden className="size-4" /> Check now
          </button>
        )}
        {c.status === "paused" ? (
          <button type="button" className="btn min-h-10" onClick={() => void patch({ paused: false })}>
            <Play aria-hidden className="size-4" /> Resume
          </button>
        ) : (
          c.status !== "needs_reauth" && (
            <button type="button" className="btn min-h-10" onClick={() => void patch({ paused: true })}>
              <Pause aria-hidden className="size-4" /> Pause
            </button>
          )
        )}
        <label htmlFor={daysId} className="sr-only">
          How far back to look
        </label>
        <select id={daysId} className="input min-h-10 w-auto" value={c.backfillDays} onChange={(e) => void patch({ backfillDays: Number(e.target.value) })}>
          {LOOKBACK_CHOICES.map((d) => (
            <option key={d} value={d}>
              Look back {d} days
            </option>
          ))}
        </select>
        <button type="button" className="btn-ghost ml-auto min-h-10 text-danger" onClick={() => setConfirm(true)}>
          <Unplug aria-hidden className="size-4" /> Disconnect
        </button>
      </div>

      {reconnect && (
        <div className="rounded-lg border border-border p-3">
          <ImapForm days={c.backfillDays} google={google} testMailbox={false} prefill={{ address: c.address, host: c.imapHost }} onConnected={() => (setReconnect(false), onChanged())} />
        </div>
      )}

      <dialog
        ref={dialog}
        onCancel={(e) => {
          e.preventDefault();
          setConfirm(false);
        }}
        aria-labelledby={`disconnect-${c.id}`}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-5 text-text backdrop:bg-black/40"
      >
        <h2 id={`disconnect-${c.id}`} className="section-title">
          Disconnect {c.address}?
        </h2>
        <p className="mt-2 text-sm text-muted">
          I&apos;ll stop reading it and forget the {c.provider === "gmail" ? "Google access (it's revoked with Google too)" : "app password"}. Your applications stay in your pipeline.
        </p>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 size-4 accent-[var(--danger)]" checked={purge} onChange={(e) => setPurge(e.target.checked)} />
          <span>Also delete the job emails found in it (their links and actions disappear from your applications).</span>
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={() => setConfirm(false)} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => {
              setConfirm(false);
              void call(`/api/mail/connections/${c.id}${purge ? "?purge=1" : ""}`, { method: "DELETE" });
            }}
          >
            Disconnect
          </button>
        </div>
      </dialog>
    </li>
  );
}

function PastConnection({ conn: c, onChanged }: { conn: Conn; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <span className="flex-1 truncate">{c.address}</span>
      <span className="text-xs text-muted">{statsSentence(c) ?? "No job emails found"}</span>
      <button
        type="button"
        className="btn-ghost min-h-9 text-xs text-danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await fetch(`/api/mail/connections/${c.id}?purge=1`, { method: "DELETE" });
          onChanged();
        }}
      >
        Delete its emails
      </button>
    </li>
  );
}
