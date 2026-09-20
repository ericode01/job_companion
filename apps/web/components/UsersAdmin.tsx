"use client";

import { Check, Copy, KeyRound, Link2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Alert, ConfirmDialog, SkeletonList } from "@/components/ui";
import { timeAgo } from "@/lib/format";

interface Person {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
  disabled: boolean;
  onboardingStep: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  monthSpendUsd: number;
  searches: number;
  applications: number;
}
interface Invite {
  id: number;
  email: string | null;
  role: "admin" | "member";
  createdAt: string;
  expiresAt: string;
  state: "open" | "used" | "expired";
}

function CopyField({ value, label }: { value: string; label: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="flex gap-2">
        <input id={id} className="input font-mono text-xs" value={value} readOnly onFocus={(e) => e.target.select()} />
        <button
          type="button"
          className="btn shrink-0"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check aria-hidden className="size-4 text-good" /> : <Copy aria-hidden className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function UsersAdmin({ meId }: { meId: number }) {
  const ids = { email: useId(), role: useId() };
  const [people, setPeople] = useState<Person[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [newLink, setNewLink] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "disable" | "reset" | "role"; person: Person }>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, i] = await Promise.all([fetch("/api/admin/users").then((r) => r.json()), fetch("/api/admin/invites").then((r) => r.json())]);
    setPeople(p);
    setInvites(i);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/admin/invites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, role }) });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "Couldn't create the invite.");
      return;
    }
    setNewLink(body.url);
    setEmail("");
    await load();
  }

  async function patch(person: Person, body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/admin/users/${person.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const out = await res.json();
    if (!res.ok) {
      setError(out.error ?? "That didn't work.");
      return;
    }
    if (out.temporaryPassword) setTemp({ name: person.name, password: out.temporaryPassword });
    await load();
  }

  if (!people) return <SkeletonList rows={4} />;
  const openInvites = invites.filter((i) => i.state === "open");

  return (
    <div className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <section className="card space-y-4 p-5 sm:p-6" aria-labelledby="invite-title">
        <div>
          <h2 id="invite-title" className="section-title flex items-center gap-2">
            <UserPlus aria-hidden className="size-4 text-accent" /> Invite someone
          </h2>
          <p className="text-sm text-muted">Creates a sign-up link that works once, for 7 days. Send it to them yourself.</p>
        </div>
        <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <div>
            <label htmlFor={ids.email} className="label">
              Their email (optional)
            </label>
            <input id={ids.email} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Leave blank for a link anyone can use once" />
          </div>
          <div>
            <label htmlFor={ids.role} className="label">
              Role
            </label>
            <select id={ids.role} className="input" value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button className="btn-primary">
            <Link2 aria-hidden className="size-4" /> Create link
          </button>
        </form>
        {newLink && (
          <div className="companion space-y-2 p-4">
            <CopyField value={newLink} label="Invite link — shown once, copy it now" />
          </div>
        )}
        {openInvites.length > 0 && (
          <div>
            <p className="label">Open invites</p>
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {openInvites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="flex-1">{i.email ?? "Anyone with the link"}</span>
                  <span className="chip bg-surface-2 text-muted">{i.role === "admin" ? "Admin" : "Member"}</span>
                  <span className="text-muted">expires {new Date(i.expiresAt).toLocaleDateString()}</span>
                  <button
                    className="btn-ghost min-h-8 text-danger"
                    onClick={async () => {
                      await fetch(`/api/admin/invites/${i.id}`, { method: "DELETE" });
                      await load();
                    }}
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {temp && (
        <div className="companion space-y-2 p-4">
          <p className="text-sm">
            <span className="font-semibold">{temp.name}</span> was signed out everywhere. Give them this temporary password; they can change it under Account.
          </p>
          <CopyField value={temp.password} label="Temporary password — shown once" />
        </div>
      )}

      <section className="card overflow-x-auto" aria-labelledby="people-title">
        <h2 id="people-title" className="section-title px-4 pt-4">
          People
        </h2>
        <table className="mt-2 w-full min-w-[44rem] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-2 font-semibold">Person</th>
              <th scope="col" className="px-4 py-2 font-semibold">Role</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Searches</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Applications</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">AI this month</th>
              <th scope="col" className="px-4 py-2 font-semibold">Last seen</th>
              <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {people.map((p) => (
              <tr key={p.id} className={p.disabled ? "opacity-60" : ""}>
                <td className="px-4 py-2.5">
                  <p className="font-medium">
                    {p.name} {p.id === meId && <span className="text-muted">(you)</span>}
                  </p>
                  <p className="text-xs text-muted">
                    {p.email}
                    {p.disabled ? " · disabled" : p.onboardingStep ? " · setting up" : ""}
                  </p>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`chip ${p.role === "admin" ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"}`}>{p.role === "admin" ? "Admin" : "Member"}</span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{p.searches}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{p.applications}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">${p.monthSpendUsd.toFixed(2)}</td>
                <td className="px-4 py-2.5 text-muted">{p.lastSeenAt ? timeAgo(p.lastSeenAt) : "never"}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    {p.id !== meId && (
                      <button className="btn-ghost min-h-8 px-2 text-xs" onClick={() => setConfirm({ kind: "role", person: p })}>
                        Make {p.role === "admin" ? "member" : "admin"}
                      </button>
                    )}
                    <button className="btn-ghost min-h-8 px-2 text-xs" onClick={() => setConfirm({ kind: "reset", person: p })} aria-label={`Reset password for ${p.name}`}>
                      <KeyRound aria-hidden className="size-3.5" /> Reset
                    </button>
                    {p.id !== meId && (
                      <button
                        className={`btn-ghost min-h-8 px-2 text-xs ${p.disabled ? "" : "text-danger"}`}
                        onClick={() => (p.disabled ? void patch(p, { disabled: false }) : setConfirm({ kind: "disable", person: p }))}
                      >
                        {p.disabled ? "Enable" : "Disable"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === "disable"
            ? `Disable ${confirm.person.name}?`
            : confirm?.kind === "reset"
              ? `Reset ${confirm?.person.name}'s password?`
              : `Make ${confirm?.person.name} ${confirm?.person.role === "admin" ? "a member" : "an admin"}?`
        }
        body={
          confirm?.kind === "disable"
            ? "They're signed out and can't sign in. Their searches, applications and answers are kept, and you can enable them again."
            : confirm?.kind === "reset"
              ? "They're signed out everywhere and get a temporary password, shown to you once."
              : confirm?.person.role === "admin"
                ? "They lose access to the admin portal."
                : "They can change system settings, see everyone's AI spend and invite people."
        }
        confirmLabel={confirm?.kind === "disable" ? "Disable" : confirm?.kind === "reset" ? "Reset password" : "Change role"}
        danger={confirm?.kind === "disable"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm!;
          setConfirm(null);
          void patch(
            c.person,
            c.kind === "disable" ? { disabled: true } : c.kind === "reset" ? { resetPassword: true } : { role: c.person.role === "admin" ? "member" : "admin" },
          );
        }}
      />
    </div>
  );
}
