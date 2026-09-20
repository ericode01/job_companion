"use client";

import { CheckCircle2, CircleAlert, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui";

interface Status {
  method: "smtp" | "resend";
  smtp: { host: boolean; user: boolean; pass: boolean; from: string | null };
  resend: { key: boolean; from: string | null };
}

function Row({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? <CheckCircle2 aria-hidden className="size-4 text-good" /> : <CircleAlert aria-hidden className="size-4 text-warn" />}
      <code className="text-xs">{label}</code>
      <span className="text-muted">{ok ? "set" : "missing"}</span>
    </li>
  );
}

export function EmailAdmin({ adminEmail }: { adminEmail: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    fetch("/api/admin/email").then((r) => r.json()).then(setStatus);
  }, []);
  if (!status) return null;
  return (
    <section className="card space-y-4 p-5 sm:p-6" aria-labelledby="creds">
      <h2 id="creds" className="section-title">
        Credentials on this server
      </h2>
      <ul className="space-y-1.5 text-sm">
        {status.method === "smtp" ? (
          <>
            <Row ok={status.smtp.host} label="SMTP_HOST" />
            <Row ok={status.smtp.user} label="SMTP_USER" />
            <Row ok={status.smtp.pass} label="SMTP_PASS" />
          </>
        ) : (
          <Row ok={status.resend.key} label="RESEND_API_KEY" />
        )}
      </ul>
      <p className="text-sm text-muted">
        Sent from {(status.method === "smtp" ? status.smtp.from : status.resend.from) ?? "the default address"}. Gmail needs 2-step verification and an app password.
      </p>
      {result && (result.ok ? <p className="text-sm text-good">{result.text}</p> : <Alert tone="danger">{result.text}</Alert>)}
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setResult(null);
          const res = await fetch("/api/admin/email", { method: "POST" });
          const body = await res.json();
          setBusy(false);
          setResult(res.ok ? { ok: true, text: `Sent a test email to ${body.to}.` } : { ok: false, text: body.error });
        }}
      >
        <Send aria-hidden className="size-4" /> {busy ? "Sending…" : `Send a test to ${adminEmail}`}
      </button>
    </section>
  );
}
