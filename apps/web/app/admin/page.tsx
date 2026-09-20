import { appOrigin, getSettings, getSpendStatus, listUsers, loadEnv, spendByUser } from "@jd/core";
import { getDb, schema } from "@jd/core/db";
import { AI_KEY_HINT, hasApiKey } from "@jd/llm";
import { googleConfigured } from "@jd/mail";
import { countOpenJobs, pendingDetailCount } from "@jd/sources";
import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Check, fmtCount, fmtUsd, Meter, StatTile } from "@/components/AdminStats";
import { latestCrawl } from "@/lib/crawl-runner";
import { extensionBuild } from "@/lib/extension-file";
import { timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Overview" };

const PURPOSE_LABELS: Record<string, string> = {
  company_research: "Company research",
  company_structure: "Company research (structuring)",
  fit_score: "Fit scores",
  job_analysis: "Job summaries",
  cover_letter: "Cover letters",
  tailor_resume: "Tailored resumes",
  resume_parse: "Reading resumes",
  form_answers: "Form answers",
  query_parse: "Reading searches",
  discover_companies: "Finding companies",
  discover_extract: "Finding companies (structuring)",
  email_classify: "Sorting job emails",
};

export default function AdminOverview() {
  loadEnv();
  const db = getDb();
  const users = listUsers();
  const names = new Map(users.map((u) => [u.id, u.name]));
  const spend = getSpendStatus(new Date(), null);
  const byUser = spendByUser().sort((a, b) => b.usd - a.usd);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const byPurpose = db
    .select({ purpose: schema.llmUsage.purpose, usd: sql<number>`sum(${schema.llmUsage.costUsd})`, calls: count() })
    .from(schema.llmUsage)
    .where(gte(schema.llmUsage.ts, monthStart))
    .groupBy(schema.llmUsage.purpose)
    .all()
    .sort((a, b) => b.usd - a.usd);
  const queue = Object.fromEntries(
    db
      .select({ status: schema.task.status, n: count() })
      .from(schema.task)
      .where(inArray(schema.task.status, ["queued", "running"]))
      .groupBy(schema.task.status)
      .all()
      .map((q) => [q.status, q.n]),
  ) as Partial<Record<"queued" | "running", number>>;
  // Old failures stay in the table for reference; only recent ones need attention.
  const failed =
    db
      .select({ n: count() })
      .from(schema.task)
      .where(and(eq(schema.task.status, "failed"), gte(schema.task.finishedAt, new Date(Date.now() - 86_400_000))))
      .get()?.n ?? 0;
  const coverage = countOpenJobs();
  const erroring = db.select({ n: count() }).from(schema.company).where(eq(schema.company.crawlStatus, "error")).get()?.n ?? 0;
  const crawl = latestCrawl();
  const ext = extensionBuild();
  const origin = appOrigin();
  const mail = getSettings("mail").method;
  const mailReady = mail === "resend" ? Boolean(process.env.RESEND_API_KEY) : Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  const active = users.filter((u) => !u.disabled);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-sm text-muted">How this Job Companion server is doing, for everyone on it.</p>
      </div>

      <section aria-labelledby="health" className="card p-5">
        <h2 id="health" className="section-title">
          Setup checks
        </h2>
        <ul className="mt-1 divide-y divide-border">
          <Check ok={hasApiKey()}>{hasApiKey() ? "An AI API key is set." : `No ${AI_KEY_HINT}: fit scores, research, cover letters and tailoring are off.`}</Check>
          <Check ok={origin.startsWith("https://") || process.env.NODE_ENV !== "production"}>
            Public address is <code className="rounded bg-surface-2 px-1">{origin}</code>
            {origin.startsWith("https://") ? "." : " (set APP_ORIGIN to your https address before sharing invites)."}
          </Check>
          <Check ok={mailReady}>
            {mailReady ? `Email is sent with ${mail === "smtp" ? "SMTP" : "Resend"}.` : "Email credentials are missing, so digests can't be sent."}{" "}
            <Link href="/admin/email" className="text-accent hover:underline">
              Email delivery
            </Link>
          </Check>
          <Check ok={ext.available && ext.builtFor.includes(origin)}>
            {!ext.available
              ? "The Chrome extension hasn't been built, so people can't download it."
              : ext.builtFor.includes(origin)
                ? `Chrome extension v${ext.version} is ready to download.`
                : `The Chrome extension was built for ${ext.builtFor.join(", ")}, not ${origin}. Rebuild it with APP_URL=${origin}.`}
          </Check>
          <Check ok={googleConfigured() || !getSettings("mailSync").enabled}>
            {googleConfigured()
              ? "Gmail can be connected with Google sign-in."
              : getSettings("mailSync").enabled
                ? "Google sign-in isn't set up, so Gmail users need an app password to connect their mailbox."
                : "Mailbox sync is turned off."}{" "}
            <Link href="/admin/mailbox" className="text-accent hover:underline">
              Mailbox sync
            </Link>
          </Check>
          <Check ok={!failed}>
            {failed ? `${failed} background task${failed === 1 ? "" : "s"} failed in the last day.` : "No background tasks failed in the last day."}{" "}
            {queue.queued || queue.running ? `${queue.running ?? 0} running, ${queue.queued ?? 0} waiting.` : ""}
          </Check>
        </ul>
      </section>

      <section aria-labelledby="kpis" className="space-y-3">
        <h2 id="kpis" className="sr-only">
          Key numbers
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="People" value={fmtCount(active.length)} sub={`${users.length - active.length} disabled · ${users.filter((u) => u.role === "admin").length} admin`} />
          <StatTile label="Open jobs" value={fmtCount(coverage.jobs)} sub={`from ${fmtCount(coverage.companies)} companies · ${fmtCount(pendingDetailCount())} awaiting detail`} />
          <Meter label="AI spend today" used={spend.todayUsd} cap={spend.dailyCapUsd} />
          <Meter label="AI spend this month" used={spend.monthUsd} cap={spend.monthlyCapUsd} />
        </div>
        <p className="text-xs text-muted">
          Job boards last refreshed {crawl?.finishedAt ? timeAgo(crawl.finishedAt) : crawl?.status === "running" ? "— running now" : "never"}
          {erroring ? ` · ${erroring} boards returning errors` : ""}.{" "}
          <Link href="/admin/sources" className="text-accent hover:underline">
            Job boards
          </Link>
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="by-person" className="card overflow-hidden">
          <h2 id="by-person" className="section-title px-4 pt-4">
            AI spend by person, this month
          </h2>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-semibold">
                  Person
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  Calls
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  Spend
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border tabular-nums">
              {byUser.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-muted">
                    Nothing yet this month.
                  </td>
                </tr>
              )}
              {byUser.map((r) => (
                <tr key={r.userId ?? "system"}>
                  <td className="px-4 py-2">{r.userId === null ? <span className="text-muted">Shared / system</span> : (names.get(r.userId) ?? `#${r.userId}`)}</td>
                  <td className="px-4 py-2 text-right">{fmtCount(r.calls)}</td>
                  <td className="px-4 py-2 text-right">{fmtUsd(r.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-labelledby="by-purpose" className="card overflow-hidden">
          <h2 id="by-purpose" className="section-title px-4 pt-4">
            AI spend by feature, this month
          </h2>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-semibold">
                  Feature
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  Calls
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  Spend
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border tabular-nums">
              {byPurpose.map((r) => (
                <tr key={r.purpose}>
                  <td className="px-4 py-2">{PURPOSE_LABELS[r.purpose] ?? r.purpose}</td>
                  <td className="px-4 py-2 text-right">{fmtCount(r.calls)}</td>
                  <td className="px-4 py-2 text-right">{fmtUsd(r.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
