import { JOB_COMPANION_HEADER, loadEnv } from "@jd/core";
import nodemailer from "nodemailer";

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export class MailConfigError extends Error {}

/** Your own mailbox over SMTP (the default) or Resend. Credentials come from .env.local. */
export async function sendMail(method: "smtp" | "resend", mail: MailInput): Promise<void> {
  loadEnv();
  if (method === "resend") {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new MailConfigError("Set RESEND_API_KEY in .env.local to send with Resend.");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.DIGEST_FROM ?? mail.to,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers: { [JOB_COMPANION_HEADER]: "digest" },
      }),
    });
    if (!res.ok) throw new Error(`Resend rejected the email (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return;
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, DIGEST_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new MailConfigError("Set SMTP_HOST, SMTP_USER, and SMTP_PASS in .env.local (Gmail needs an app password).");
  }
  const port = Number(SMTP_PORT ?? 587);
  const transport = nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  await transport.sendMail({
    from: DIGEST_FROM ?? SMTP_USER,
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    headers: { [JOB_COMPANION_HEADER]: "digest" },
  });
}
