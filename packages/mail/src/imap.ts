import dns from "node:dns/promises";
import net from "node:net";
import type { schema } from "@jd/core/db";
import type { MailCursor } from "@jd/core/schema";
import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import { bodyText, extractLinks } from "./body";
import { gmailThreadLink } from "./gmail";
import { type EmailHeaders, type MailSource, type RawEmail, ReauthRequiredError } from "./types";

/**
 * IMAP, read-only by construction: folders are opened with EXAMINE (readOnly) and messages
 * are fetched with BODY.PEEK, so nothing is marked read. Code outside this file only ever
 * sees ReadOnlyImap, which has no method that could change the mailbox.
 */
export interface ImapLogin {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface ReadOnlyImap {
  folders(): Promise<{ path: string; specialUse?: string }[]>;
  /** Opens a folder read-only and runs fn while it's open. */
  inFolder<T>(path: string, fn: (info: { uidValidity: string; uidNext: number }) => Promise<T>): Promise<T>;
  searchSince(since: Date): Promise<number[]>;
  headers(uids: number[]): Promise<FetchMessageObject[]>;
  source(uid: number): Promise<Buffer | null>;
  isGmail(): boolean;
  close(): Promise<void>;
}

/** Factory seam for tests. */
export type ImapFactory = (login: ImapLogin) => ImapFlow;
let factory: ImapFactory = (login) =>
  new ImapFlow({
    host: login.host,
    port: login.port,
    secure: login.port === 993,
    auth: { user: login.user, pass: login.password },
    logger: false,
    disableAutoIdle: true,
    clientInfo: { name: "Job Companion" },
  });

export function setImapFactory(f: ImapFactory): void {
  factory = f;
}

const HEADER_KEYS = ["list-id", "x-job-companion", "message-id"];

function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (net.isIPv4(v4)) {
    const [a = 0, b = 0] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb");
}

/**
 * People type the server name themselves, so it must be a public mail server: this stops the
 * connect form from being used to probe the machine or network Job Companion runs on.
 */
export async function assertPublicMailHost(host: string, port: number): Promise<void> {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) throw new Error("That doesn't look like a mail server name, e.g. imap.example.com.");
  if (port !== 993 && port !== 143) throw new Error("IMAP uses port 993 (or 143).");
  const addrs = await dns.lookup(host, { all: true }).catch(() => {
    throw new Error(`Couldn't find a server called ${host}.`);
  });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("That server address isn't allowed.");
}

let hostCheck: (host: string, port: number) => Promise<void> = assertPublicMailHost;
/** Test hook. */
export function setHostCheck(f: typeof hostCheck): void {
  hostCheck = f;
}

export async function openImap(login: ImapLogin): Promise<ReadOnlyImap> {
  await hostCheck(login.host, login.port);
  const client = factory(login);
  try {
    await client.connect();
  } catch (err) {
    const e = err as { authenticationFailed?: boolean; responseText?: string; message?: string };
    if (e.authenticationFailed) throw new ReauthRequiredError("The mail server rejected the address or app password.");
    throw new Error(`Couldn't reach ${login.host}: ${e.responseText ?? e.message ?? String(err)}`);
  }
  return {
    async folders() {
      const list = await client.list();
      return list.map((f) => ({ path: f.path, specialUse: f.specialUse }));
    },
    async inFolder(path, fn) {
      const lock = await client.getMailboxLock(path, { readOnly: true });
      try {
        const box = client.mailbox;
        if (!box) throw new Error(`Couldn't open ${path}`);
        return await fn({ uidValidity: String(box.uidValidity), uidNext: box.uidNext });
      } finally {
        lock.release();
      }
    },
    async searchSince(since) {
      const found = await client.search({ since }, { uid: true });
      return Array.isArray(found) ? found : [];
    },
    async headers(uids) {
      if (!uids.length) return [];
      return client.fetchAll(uids, { uid: true, envelope: true, internalDate: true, threadId: true, headers: HEADER_KEYS }, { uid: true });
    },
    async source(uid) {
      const msg = await client.fetchOne(String(uid), { uid: true, source: { maxLength: 1_000_000 } }, { uid: true });
      return msg ? (msg.source ?? null) : null;
    },
    isGmail() {
      return /(^|\.)gmail\.com$|googlemail\.com$/i.test(login.host);
    },
    async close() {
      await client.logout().catch(() => client.close());
    },
  };
}

/** Checks an address and app password without reading anything. */
export async function testImapLogin(login: ImapLogin): Promise<void> {
  const imap = await openImap(login);
  try {
    await imap.inFolder("INBOX", async () => undefined);
  } finally {
    await imap.close();
  }
}

/** Where job mail can be: INBOX, plus the archive. Gmail's All Mail already includes INBOX. */
export function foldersToRead(folders: { path: string; specialUse?: string }[]): string[] {
  const all = folders.find((f) => f.specialUse === "\\All");
  if (all) return [all.path];
  const archive = folders.find((f) => f.specialUse === "\\Archive");
  return ["INBOX", ...(archive ? [archive.path] : [])];
}

function parseHeaderBlock(buf: Buffer | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!buf) return out;
  for (const line of buf.toString("utf8").replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

/** Gmail over IMAP reports X-GM-THRID in decimal; Gmail's web links use hex. */
export function gmailThreadHex(threadId: string | undefined): string | null {
  if (!threadId || !/^\d+$/.test(threadId)) return null;
  return BigInt(threadId).toString(16);
}

type Connection = typeof schema.mailboxConnection.$inferSelect;

export function imapSource(conn: Connection, password: string, opts: { save: (cursor: MailCursor) => void }): MailSource {
  let imap: ReadOnlyImap | null = null;
  const next: MailCursor = { ...conn.cursor, folders: { ...(conn.cursor.folders ?? {}) } };
  const ready = async () =>
    (imap ??= await openImap({ host: conn.imapHost ?? "", port: conn.imapPort ?? 993, user: conn.address, password }));

  return {
    async listHeaders() {
      const c = await ready();
      const out: EmailHeaders[] = [];
      const since = new Date(Date.now() - conn.backfillDays * 86_400_000);
      for (const path of foldersToRead(await c.folders())) {
        await c.inFolder(path, async ({ uidValidity, uidNext }) => {
          const prev = conn.cursor.folders?.[path];
          const fresh = !prev || prev.uidValidity !== uidValidity;
          // The first run looks back by date; after that only UIDs above the last one seen.
          const uids = fresh ? await c.searchSince(since) : (await c.searchSince(since)).filter((u) => u > prev.lastUid);
          for (let i = 0; i < uids.length; i += 200) {
            for (const m of await c.headers(uids.slice(i, i + 200))) {
              const hdr = parseHeaderBlock(m.headers);
              const from = m.envelope?.from?.[0];
              const thread = c.isGmail() ? gmailThreadHex(m.threadId) : (m.threadId ?? null);
              out.push({
                providerId: `${path}:${uidValidity}:${m.uid}`,
                threadId: thread,
                fromName: from?.name || null,
                fromAddress: from?.address?.toLowerCase() ?? null,
                subject: m.envelope?.subject ?? "",
                receivedAt: new Date(m.internalDate ?? m.envelope?.date ?? Date.now()),
                listId: hdr["list-id"] ?? null,
                fromJobCompanion: Boolean(hdr["x-job-companion"]),
              });
            }
          }
          next.folders![path] = { uidValidity, lastUid: Math.max(uidNext - 1, prev && !fresh ? prev.lastUid : 0) };
        });
      }
      return out;
    },
    async fetchEmail(h) {
      const c = await ready();
      const [path, , uid] = splitProviderId(h.providerId);
      return c.inFolder(path, async () => {
        const src = await c.source(uid);
        if (!src) return null;
        const parsed = await simpleParser(src);
        const html = typeof parsed.html === "string" ? parsed.html : null;
        const text = parsed.text ?? null;
        const email: RawEmail = {
          providerId: h.providerId,
          rfcMessageId: parsed.messageId ?? null,
          threadId: h.threadId,
          fromName: h.fromName,
          fromAddress: h.fromAddress,
          subject: h.subject,
          receivedAt: h.receivedAt,
          text: bodyText(html, text),
          links: extractLinks(html, text),
        };
        return email;
      });
    },
    async commit() {
      opts.save(next);
    },
    async close() {
      await imap?.close();
    },
  };
}

function splitProviderId(id: string): [string, string, number] {
  const last = id.lastIndexOf(":");
  const mid = id.lastIndexOf(":", last - 1);
  return [id.slice(0, mid), id.slice(mid + 1, last), Number(id.slice(last + 1))];
}

/** Gmail thread link for Gmail-over-IMAP connections; other providers have no stable web link. */
export function imapWebLink(conn: Connection, threadId: string | null): string | null {
  return threadId && /(^|\.)gmail\.com$|googlemail\.com$/i.test(conn.imapHost ?? "") ? gmailThreadLink(conn.address, threadId) : null;
}
