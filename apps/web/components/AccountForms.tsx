"use client";

import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Alert } from "@/components/ui";

/** Name and time zone. The digest arrives at your send time in this zone. */
export function AccountBasics({ name: initialName, timezone: initialTz }: { name: string; timezone: string }) {
  const router = useRouter();
  const ids = { name: useId(), tz: useId() };
  const [name, setName] = useState(initialName);
  const [tz, setTz] = useState(initialTz);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // The zone list differs between Node and browsers, so it's filled in after mount.
  const [zones, setZones] = useState<string[]>([initialTz]);
  useEffect(() => {
    try {
      setZones(Intl.supportedValuesOf("timeZone"));
    } catch {
      /* keep the current zone only */
    }
  }, []);
  // Read after mount: the server can't know this device's zone, and rendering it there would mismatch.
  const [browserTz, setBrowserTz] = useState<string | null>(null);
  useEffect(() => setBrowserTz(Intl.DateTimeFormat().resolvedOptions().timeZone), []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    const res = await fetch("/api/me", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, timezone: tz }) });
    setState(res.ok ? "saved" : "error");
    if (res.ok) router.refresh();
  }

  return (
    <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
      <div>
        <label htmlFor={ids.name} className="label">
          Name
        </label>
        <input id={ids.name} className="input" value={name} maxLength={120} autoComplete="name" onChange={(e) => (setName(e.target.value), setState("idle"))} />
      </div>
      <div>
        <label htmlFor={ids.tz} className="label">
          Time zone
        </label>
        <select id={ids.tz} className="input" value={tz} onChange={(e) => (setTz(e.target.value), setState("idle"))}>
          {(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        {browserTz && browserTz !== tz && (
          <button type="button" className="helper text-accent hover:underline" onClick={() => (setTz(browserTz), setState("idle"))}>
            Use this device&apos;s zone ({browserTz.replace(/_/g, " ")})
          </button>
        )}
      </div>
      <div className="flex items-center justify-end gap-3 md:col-span-2">
        <span role="status" className="text-sm">
          {state === "saved" && (
            <span className="inline-flex items-center gap-1 text-good">
              <CheckCircle2 aria-hidden className="size-4" /> Saved
            </span>
          )}
          {state === "error" && <span className="text-danger">Couldn&apos;t save.</span>}
        </span>
        <button className="btn-primary" disabled={state === "saving" || !name.trim()}>
          {state === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const ids = { current: useId(), next: useId(), confirm: useId() };
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== next;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/me/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ current, next }) });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: body.error ?? "Couldn't change your password." });
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setMsg({ ok: true, text: "Password changed." });
  }

  return (
    <form onSubmit={save} className="grid gap-4 md:grid-cols-3">
      {msg && !msg.ok && (
        <div className="md:col-span-3">
          <Alert tone="danger">{msg.text}</Alert>
        </div>
      )}
      <div>
        <label htmlFor={ids.current} className="label">
          Current password
        </label>
        <input id={ids.current} className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div>
        <label htmlFor={ids.next} className="label">
          New password
        </label>
        <input id={ids.next} className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-describedby={`${ids.next}-h`} />
        <p id={`${ids.next}-h`} className="helper">
          At least 10 characters.
        </p>
      </div>
      <div>
        <label htmlFor={ids.confirm} className="label">
          Repeat new password
        </label>
        <input
          id={ids.confirm}
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          aria-invalid={mismatch || undefined}
          aria-describedby={mismatch ? `${ids.confirm}-e` : undefined}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mismatch && (
          <p id={`${ids.confirm}-e`} className="field-error">
            Doesn&apos;t match.
          </p>
        )}
      </div>
      <div className="flex items-center justify-end gap-3 md:col-span-3">
        {msg?.ok && (
          <span role="status" className="inline-flex items-center gap-1 text-sm text-good">
            <CheckCircle2 aria-hidden className="size-4" /> {msg.text}
          </span>
        )}
        <button className="btn-primary" disabled={busy || !current || next.length < 10 || mismatch || !confirm}>
          {busy ? "Changing…" : "Change password"}
        </button>
      </div>
    </form>
  );
}
