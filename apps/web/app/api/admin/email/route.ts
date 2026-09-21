import { getSettings, loadEnv } from "@jd/core";
import { MailConfigError, sendMail } from "@jd/digest";
import { NextResponse } from "next/server";
import { json, withAdmin } from "@/lib/api";

/** Which mail credentials are present (never their values). */
export function GET(req: Request) {
  return withAdmin(req, async () => {
    loadEnv();
    const e = process.env;
    return json({
      method: (await getSettings("mail")).method,
      smtp: { host: Boolean(e.SMTP_HOST), user: Boolean(e.SMTP_USER), pass: Boolean(e.SMTP_PASS), from: e.DIGEST_FROM ?? e.SMTP_USER ?? null },
      resend: { key: Boolean(e.RESEND_API_KEY), from: e.DIGEST_FROM ?? null },
    });
  });
}

/** Sends a short test message to the admin's own address. */
export function POST(req: Request) {
  return withAdmin(req, async (me) => {
    const { method } = await getSettings("mail");
    try {
      await sendMail(method, {
        to: me.email,
        subject: "Job Companion test email",
        text: "If you can read this, digests will be delivered.",
        html: "<p>If you can read this, digests will be delivered.</p>",
      });
      return json({ ok: true, to: me.email });
    } catch (err) {
      const message = err instanceof MailConfigError ? err.message : `Couldn't send: ${err instanceof Error ? err.message : String(err)}`;
      return NextResponse.json({ error: message }, { status: 422 });
    }
  });
}
