"use client";

import { Eye, EyeOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { Alert } from "@/components/ui";

type Mode = { kind: "login" } | { kind: "setup" } | { kind: "invite"; token: string; email: string | null };

/**
 * Sign-in, first-run setup and invite acceptance share one form. The browser's time zone is
 * sent along so the daily digest arrives at your local send time.
 */
export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const ids = { name: useId(), email: useId(), password: useId() };
  const [name, setName] = useState("");
  const [email, setEmail] = useState(mode.kind === "invite" ? (mode.email ?? "") : "");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creating = mode.kind !== "login";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const url = mode.kind === "login" ? "/api/auth/login" : mode.kind === "setup" ? "/api/auth/setup" : `/api/auth/invite/${mode.token}`;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(creating ? { name, email, password, timezone } : { email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(body.error ?? "Something went wrong. Try again.");
      return;
    }
    const next = params.get("next");
    // Only same-site paths, so a crafted ?next= can't bounce you elsewhere.
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-6" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      {creating && (
        <div>
          <label htmlFor={ids.name} className="label">
            Your name
          </label>
          <input id={ids.name} className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
      )}
      <div>
        <label htmlFor={ids.email} className="label">
          Email
        </label>
        <input
          id={ids.email}
          className="input"
          type="email"
          autoComplete={creating ? "email" : "username"}
          value={email}
          readOnly={mode.kind === "invite" && Boolean(mode.email)}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div>
        <label htmlFor={ids.password} className="label">
          Password
        </label>
        <div className="relative">
          <input
            id={ids.password}
            className="input pr-10"
            type={show ? "text" : "password"}
            autoComplete={creating ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={creating ? `${ids.password}-hint` : undefined}
            required
          />
          <button
            type="button"
            className="btn-ghost absolute top-1/2 right-0.5 min-h-8 -translate-y-1/2 px-2"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
          >
            {show ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </button>
        </div>
        {creating && (
          <p id={`${ids.password}-hint`} className="helper">
            At least 10 characters.
          </p>
        )}
      </div>
      <button className="btn-primary min-h-10 w-full" disabled={busy || !email || !password || (creating && !name)}>
        {busy ? "One moment…" : mode.kind === "login" ? "Sign in" : mode.kind === "setup" ? "Create admin account" : "Create account"}
      </button>
    </form>
  );
}
