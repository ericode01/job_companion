import { listUsers, loadEnv } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import { googleConfigured, googleRedirectUri } from "@jd/mail";
import type { Metadata } from "next";
import { Check } from "@/components/AdminStats";
import { CopyField } from "@/components/CopyField";
import { SectionForm } from "@/components/SettingsForm";
import { MAIL_SYNC } from "@/lib/admin-sections";
import { timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Mailbox sync" };

const STATUS: Record<string, string> = {
  active: "Checking",
  needs_reauth: "Needs reconnecting",
  paused: "Paused",
  error: "Last check failed",
};

export default async function AdminMailbox() {
  loadEnv();
  const google = googleConfigured();
  const secretFromEnv = Boolean(process.env.SECRET_KEY);
  const names = new Map((await listUsers()).map((u) => [u.id, u.name]));
  // Connection health only: admins never see anyone's email.
  const connections = (
    await getDb()
      .select({
        id: schema.mailboxConnection.id,
        userId: schema.mailboxConnection.userId,
        provider: schema.mailboxConnection.provider,
        address: schema.mailboxConnection.address,
        status: schema.mailboxConnection.status,
        secret: schema.mailboxConnection.secret,
        lastSyncAt: schema.mailboxConnection.lastSyncAt,
        lastError: schema.mailboxConnection.lastError,
      })
      .from(schema.mailboxConnection)
  ).filter((c) => c.secret);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mailbox sync</h1>
        <p className="text-sm text-muted">People connect their own inbox under Mailbox. Access is read-only, and only job emails are kept.</p>
      </div>

      <section aria-labelledby="checks" className="card p-5">
        <h2 id="checks" className="section-title">
          Setup checks
        </h2>
        <ul className="mt-1 divide-y divide-border">
          <Check ok={google}>
            {google ? "Google sign-in is set up: people can connect Gmail with read-only access." : "Google sign-in isn't set up, so Gmail users need an app password. Follow the steps below."}
          </Check>
          <Check ok={secretFromEnv || process.env.NODE_ENV !== "production"}>
            {secretFromEnv
              ? "Mailbox credentials are encrypted with SECRET_KEY."
              : "SECRET_KEY isn't set. Locally a generated key file in the data folder is used; set SECRET_KEY before hosting (openssl rand -base64 32)."}
          </Check>
        </ul>
      </section>

      <section aria-labelledby="google" className="card space-y-4 p-5">
        <div>
          <h2 id="google" className="section-title">
            Set up Google sign-in for Gmail
          </h2>
          <p className="text-sm text-muted">About ten minutes, once, in Google Cloud Console. Job Companion only ever asks for read-only Gmail access.</p>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            Create a project at <span className="font-medium">console.cloud.google.com</span>, then enable the <span className="font-medium">Gmail API</span> (APIs &amp; Services → Library).
          </li>
          <li>
            Under <span className="font-medium">Google Auth Platform</span> (OAuth consent screen), choose <span className="font-medium">External</span>, fill in the app name, and add the scope{" "}
            <code className="rounded bg-surface-2 px-1">gmail.readonly</code>.
          </li>
          <li>
            Set the publishing status to <span className="font-medium">In production</span>. In “Testing”, Google expires everyone&apos;s access after 7 days. Until Google verifies the app, people see an
            “unverified app” screen (Advanced → continue), and at most 100 people can connect.
          </li>
          <li>
            Create an <span className="font-medium">OAuth client ID</span> of type <span className="font-medium">Web application</span> with this authorized redirect URI:
          </li>
        </ol>
        <CopyField label="Authorized redirect URI" value={googleRedirectUri()} />
        <p className="text-sm">
          Then put the client ID and secret in the server environment as <code className="rounded bg-surface-2 px-1">GOOGLE_CLIENT_ID</code> and{" "}
          <code className="rounded bg-surface-2 px-1">GOOGLE_CLIENT_SECRET</code>, and restart.
        </p>
      </section>

      <SectionForm section={MAIL_SYNC} />

      <section aria-labelledby="conns" className="card overflow-x-auto">
        <h2 id="conns" className="section-title px-4 pt-4">
          Connected mailboxes
        </h2>
        {connections.length === 0 ? (
          <p className="px-4 pt-1 pb-4 text-sm text-muted">No one has connected a mailbox yet.</p>
        ) : (
          <table className="mt-2 w-full min-w-[40rem] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-semibold">Person</th>
                <th scope="col" className="px-4 py-2 font-semibold">Mailbox</th>
                <th scope="col" className="px-4 py-2 font-semibold">Status</th>
                <th scope="col" className="px-4 py-2 font-semibold">Last check</th>
                <th scope="col" className="px-4 py-2 font-semibold">Problem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {connections.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5">{names.get(c.userId) ?? "Unknown"}</td>
                  <td className="px-4 py-2.5 text-muted">
                    {c.provider === "gmail" ? "Gmail" : "IMAP"} · @{c.address.split("@")[1]}
                  </td>
                  <td className="px-4 py-2.5">{STATUS[c.status] ?? c.status}</td>
                  <td className="px-4 py-2.5 text-muted">{c.lastSyncAt ? timeAgo(c.lastSyncAt) : "not yet"}</td>
                  <td className="max-w-[18rem] truncate px-4 py-2.5 text-muted" title={c.lastError ?? undefined}>
                    {c.lastError ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
