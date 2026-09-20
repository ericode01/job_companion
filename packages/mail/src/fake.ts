import fs from "node:fs";
import path from "node:path";
import { simpleParser } from "mailparser";
import { bodyText, extractLinks } from "./body";
import type { EmailHeaders, MailSource, RawEmail } from "./types";

/**
 * Development and tests only (MAIL_FAKE_DIR, never in production): a "mailbox" of .eml files,
 * so the whole sync can be exercised without a real inbox. A file's X-Thread-Id header sets
 * its thread.
 */
export function fakeSource(dir: string): MailSource {
  const parsed = new Map<string, RawEmail>();
  return {
    async listHeaders() {
      const out: EmailHeaders[] = [];
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".eml")).sort()) {
        const m = await simpleParser(fs.readFileSync(path.join(dir, file)));
        const from = m.from?.value[0];
        const html = typeof m.html === "string" ? m.html : null;
        const thread = (m.headers.get("x-thread-id") as string | undefined) ?? null;
        const email: RawEmail = {
          providerId: `fake:${file}`,
          rfcMessageId: m.messageId ?? null,
          threadId: thread,
          fromName: from?.name || null,
          fromAddress: from?.address?.toLowerCase() ?? null,
          subject: m.subject ?? "",
          receivedAt: m.date ?? new Date(),
          text: bodyText(html, m.text ?? null),
          links: extractLinks(html, m.text ?? null),
        };
        parsed.set(email.providerId, email);
        out.push({
          providerId: email.providerId,
          threadId: thread,
          fromName: email.fromName,
          fromAddress: email.fromAddress,
          subject: email.subject,
          receivedAt: email.receivedAt,
          listId: (m.headers.get("list-id") as { text?: string } | undefined)?.text ?? null,
          // Like Gmail, which returns a short preview with the headers.
          snippet: email.text.slice(0, 200),
          fromJobCompanion: m.headers.has("x-job-companion"),
        });
      }
      return out;
    },
    async fetchEmail(h) {
      return parsed.get(h.providerId) ?? null;
    },
    async commit() {},
    async close() {},
  };
}
