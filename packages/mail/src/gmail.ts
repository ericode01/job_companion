import crypto from "node:crypto";
import { appOrigin, loadEnv } from "@jd/core";
import type { schema } from "@jd/core/db";
import { bodyText, extractLinks, parseAddress } from "./body";
import { gmailQuery } from "./prefilter";
import { type EmailHeaders, type MailSource, type RawEmail, ReauthRequiredError } from "./types";

/**
 * Gmail through Google sign-in with the gmail.readonly scope: Google itself guarantees this
 * app can't send, delete, label or mark anything. Plain fetch, no googleapis dependency.
 */
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const REQUESTED = ["openid", "email", GMAIL_READONLY];
/** What Google may report back for the scopes above. Anything else means a broader grant: refuse it. */
const ALLOWED_GRANTED = new Set(["openid", "email", GMAIL_READONLY, "https://www.googleapis.com/auth/userinfo.email"]);

export function googleConfigured(): boolean {
  loadEnv();
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleRedirectUri(): string {
  return `${appOrigin()}/api/mail/google/callback`;
}

function client(): { id: string; secret: string } {
  loadEnv();
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Google sign-in isn't set up on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  return { id, secret };
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: b64url(crypto.createHash("sha256").update(verifier).digest()) };
}

export function googleAuthUrl(opts: { state: string; challenge: string; loginHint?: string }): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: client().id,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: REQUESTED.join(" "),
    access_type: "offline",
    // Always show consent so Google returns a refresh token, even on a reconnect.
    prompt: "consent",
    include_granted_scopes: "false",
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    ...(opts.loginHint ? { login_hint: opts.loginHint } : {}),
  }).toString();
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    if (body.error === "invalid_grant") throw new ReauthRequiredError("Google access was revoked or expired. Reconnect Gmail.");
    throw new Error(`Google sign-in failed: ${body.error_description ?? body.error ?? res.status}`);
  }
  return body;
}

/** Scopes Google granted must be read-only mail plus identity, nothing more. */
export function checkGrantedScopes(scope: string | undefined): void {
  const granted = (scope ?? "").split(/\s+/).filter(Boolean);
  if (!granted.includes(GMAIL_READONLY)) throw new Error("Gmail read access wasn't granted. Tick the Gmail box on Google's consent screen and try again.");
  const extra = granted.filter((s) => !ALLOWED_GRANTED.has(s));
  if (extra.length) throw new Error(`Google granted more access than Job Companion asks for (${extra.join(", ")}); the connection was refused.`);
}

export async function exchangeCode(code: string, verifier: string): Promise<{ refreshToken: string; accessToken: string; expiresAt: number; address: string }> {
  const { id, secret } = client();
  const t = await tokenRequest({
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  checkGrantedScopes(t.scope);
  if (!t.refresh_token) throw new Error("Google didn't grant ongoing access. Remove Job Companion at myaccount.google.com/permissions and connect again.");
  const profile = await new GmailApi(t.access_token).profile();
  return { refreshToken: t.refresh_token, accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000, address: profile.emailAddress.toLowerCase() };
}

const tokens = new Map<string, { token: string; expiresAt: number }>();

export async function accessTokenFor(refreshToken: string): Promise<string> {
  const key = crypto.createHash("sha256").update(refreshToken).digest("hex");
  const hit = tokens.get(key);
  if (hit && hit.expiresAt - 60_000 > Date.now()) return hit.token;
  const { id, secret } = client();
  const t = await tokenRequest({ refresh_token: refreshToken, client_id: id, client_secret: secret, grant_type: "refresh_token" });
  if (t.scope) checkGrantedScopes(t.scope);
  tokens.set(key, { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

/** Best effort: disconnecting should also end Google's grant. */
export async function revokeGoogleToken(token: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
}

/** Read-only Gmail REST calls. Only GET requests exist here. */
export class GmailApi {
  constructor(private readonly token: string) {}

  private async get<T>(path: string, params: Record<string, string | string[]> = {}): Promise<T> {
    const url = new URL(`${API}${path}`);
    for (const [k, v] of Object.entries(params)) for (const x of [v].flat()) url.searchParams.append(k, x);
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 401) throw new ReauthRequiredError("Gmail access expired. Reconnect Gmail.");
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      const text = await res.text().catch(() => "");
      if (res.status === 403 && /insufficient|scope/i.test(text)) throw new ReauthRequiredError("Gmail read access is missing. Reconnect Gmail.");
      throw new Error(`Gmail API ${res.status}: ${text.slice(0, 200)}`);
    }
  }

  profile() {
    return this.get<{ emailAddress: string; messagesTotal: number }>("/profile");
  }

  async listIds(q: string, max = 2000): Promise<{ id: string; threadId: string }[]> {
    const out: { id: string; threadId: string }[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.get<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>("/messages", {
        q,
        maxResults: "500",
        ...(pageToken ? { pageToken } : {}),
      });
      out.push(...(page.messages ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken && out.length < max);
    return out.slice(0, max);
  }

  metadata(id: string) {
    return this.get<GmailMessage>(`/messages/${id}`, {
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date", "List-Id", "Message-ID", "X-Job-Companion"],
    });
  }

  full(id: string) {
    return this.get<GmailMessage>(`/messages/${id}`, { format: "full" });
  }
}

const header = (m: GmailMessage, name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

function collectBodies(part: GmailPart | undefined, acc: { text: string[]; html: string[] }) {
  if (!part) return acc;
  const data = part.body?.data ? Buffer.from(part.body.data, "base64url").toString("utf8") : null;
  if (data && part.mimeType === "text/plain") acc.text.push(data);
  if (data && part.mimeType === "text/html") acc.html.push(data);
  for (const p of part.parts ?? []) collectBodies(p, acc);
  return acc;
}

export function gmailHeaders(m: GmailMessage): EmailHeaders {
  const from = parseAddress(header(m, "From"));
  return {
    providerId: m.id,
    threadId: m.threadId,
    fromName: from.name,
    fromAddress: from.address,
    subject: header(m, "Subject") ?? "",
    receivedAt: new Date(Number(m.internalDate ?? Date.now())),
    listId: header(m, "List-Id"),
    snippet: m.snippet ?? null,
    fromJobCompanion: Boolean(header(m, "X-Job-Companion")),
  };
}

export function gmailEmail(m: GmailMessage): RawEmail {
  const h = gmailHeaders(m);
  const { text, html } = collectBodies(m.payload, { text: [], html: [] });
  const htmlBody = html.join("\n") || null;
  const textBody = text.join("\n") || null;
  return {
    providerId: h.providerId,
    rfcMessageId: header(m, "Message-ID"),
    threadId: h.threadId,
    fromName: h.fromName,
    fromAddress: h.fromAddress,
    subject: h.subject,
    receivedAt: h.receivedAt,
    text: bodyText(htmlBody, textBody),
    links: extractLinks(htmlBody, textBody),
  };
}

/** Opens the exact thread in Gmail, in the right account when several are signed in. */
export function gmailThreadLink(address: string, threadId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(address)}#all/${threadId}`;
}

type Connection = typeof schema.mailboxConnection.$inferSelect;

export function gmailSource(
  conn: Connection,
  refreshToken: string,
  opts: { companyDomains: string[]; save: (cursor: Connection["cursor"]) => void },
): MailSource {
  const startedAt = Date.now();
  let api: GmailApi | null = null;
  const ready = async () => (api ??= new GmailApi(await accessTokenFor(refreshToken)));
  return {
    async listHeaders() {
      const a = await ready();
      const since = conn.backfillDone ? conn.cursor.checkedUntil : undefined;
      // An hour of overlap: Gmail's after: is per second and delivery can lag; duplicates are skipped by id.
      const q = gmailQuery(
        since ? { afterEpochSec: Math.floor((since - 3_600_000) / 1000), companyDomains: opts.companyDomains } : { newerThanDays: conn.backfillDays, companyDomains: opts.companyDomains },
      );
      const ids = await a.listIds(q);
      const out: EmailHeaders[] = [];
      for (let i = 0; i < ids.length; i += 10) {
        const batch = await Promise.all(ids.slice(i, i + 10).map((m) => a.metadata(m.id)));
        out.push(...batch.map(gmailHeaders));
      }
      return out;
    },
    async fetchEmail(h) {
      return gmailEmail(await (await ready()).full(h.providerId));
    },
    async commit() {
      opts.save({ ...conn.cursor, checkedUntil: startedAt });
    },
    async close() {},
  };
}
