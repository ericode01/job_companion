import { AI_KEY_HINT, hasApiKey } from "@jd/llm";
import type { Metadata } from "next";
import Link from "next/link";
import { AccountBasics, PasswordForm } from "@/components/AccountForms";
import { ArchivedSearches } from "@/components/ArchivedSearches";
import { SectionForm } from "@/components/SettingsForm";
import { Alert } from "@/components/ui";
import { archivedDashboards, listDashboards } from "@/lib/dashboards";
import { requirePageUser } from "@/lib/session";

export const metadata: Metadata = { title: "Account" };

const DIGEST = {
  key: "digest",
  endpoint: "/api/settings/digest",
  title: "Daily email",
  description: "One email a day with new matches from the searches you include (each search's Email digest tab).",
  fields: [
    { path: "enabled", label: "Send me the daily email", type: "boolean" as const },
    { path: "to", label: "Send to", type: "text" as const },
    { path: "sendTime", label: "Send at (your time zone)", type: "time" as const },
    { path: "minFitScore", label: "Default minimum fit score", type: "number" as const, hint: "Each search can override this" },
    { path: "skipWhenEmpty", label: "Skip the email when nothing is new", type: "boolean" as const },
  ],
};

const SEARCH = {
  key: "search-defaults",
  endpoint: "/api/settings/search",
  title: "Search defaults",
  description: "Used when you start a new search, and exclusions applied to every search.",
  fields: [
    { path: "includeRemoteUS", label: "Include remote roles open to the US in city searches", type: "boolean" as const },
    { path: "postedWithinDays", label: "Only jobs posted in the last (days, empty = any)", type: "nullableNumber" as const },
    { path: "excludedCompanies", label: "Never show these companies", type: "list" as const, hint: "Comma-separated names" },
    { path: "excludedTitleKeywords", label: "Never show titles containing", type: "list" as const, hint: "e.g. contract, clearance" },
  ],
};

export default async function AccountPage() {
  const user = await requirePageUser();
  const included = listDashboards(user.id).filter((d) => d.notify);
  const archived = archivedDashboards(user.id).map((d) => ({ ...d, archivedAt: d.archivedAt.toISOString() }));
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account</h1>
        <p className="text-sm text-muted">Signed in as {user.email}.</p>
      </div>

      {!hasApiKey() && (
        <Alert>
          AI features are off on this server: no fit scores, cover letters or tailored resumes. {user.role === "admin" ? `Set ${AI_KEY_HINT} in the server environment.` : "Ask your admin to set it up."}
        </Alert>
      )}

      <section className="card space-y-4 p-5 sm:p-6" aria-labelledby="you-title">
        <h2 id="you-title" className="section-title">
          You
        </h2>
        <AccountBasics name={user.name} timezone={user.timezone} />
      </section>

      <SectionForm section={DIGEST}>
        <div className="mt-4 border-t border-border pt-4 text-sm">
          <p className="font-medium">Searches in the email</p>
          {included.length ? (
            <ul className="mt-1 flex flex-wrap gap-2">
              {included.map((d) => (
                <li key={d.id}>
                  <Link href={`/d/${d.id}/digest`} className="chip border border-border bg-surface px-2.5 py-1 hover:border-accent hover:text-accent">
                    {d.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">None yet. Open a search&apos;s Email digest tab and click Include in email.</p>
          )}
        </div>
      </SectionForm>

      <SectionForm section={SEARCH} />

      {archived.length > 0 && (
        <section className="card space-y-3 p-5 sm:p-6" aria-labelledby="archived-title">
          <div>
            <h2 id="archived-title" className="section-title">
              Archived searches
            </h2>
            <p className="text-sm text-muted">Hidden from the switcher and your email. Restore one to bring its dashboard back.</p>
          </div>
          <ArchivedSearches items={archived} />
        </section>
      )}

      <section className="card space-y-4 p-5 sm:p-6" aria-labelledby="pw-title">
        <h2 id="pw-title" className="section-title">
          Password
        </h2>
        <PasswordForm />
      </section>
    </div>
  );
}
