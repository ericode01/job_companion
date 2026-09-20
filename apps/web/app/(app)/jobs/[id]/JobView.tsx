"use client";

import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
  type Comp,
  type CompanyProfile,
  type FitResult,
  type JobAnalysis,
} from "@jd/core/shared";
import { AlertTriangle, ArrowLeft, ArrowRight, Building2, CheckCircle2, ExternalLink, FileSearch, MapPin, MessageSquareText, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApplyButton } from "@/components/ApplyDialog";
import { CompanyProfileCard } from "@/components/CompanyProfileCard";
import { FitBadge } from "@/components/Status";
import { Alert, Skeleton, Spinner } from "@/components/ui";
import { formatComp, timeAgo } from "@/lib/format";
import { JobEmails } from "@/components/JobEmails";
import { setApplicationStatus, STATUS_LABELS, type TaskStatus } from "@/lib/types";

export interface JobData {
  job: {
    id: number;
    title: string;
    url: string;
    applyUrl: string;
    locations: string[];
    locationType: string;
    comp: Comp | null;
    postedAt: string | null;
    firstSeenAt: string;
    closedAt: string | null;
    department: string | null;
    atsType: string;
  };
  company: { id: number; name: string; domain: string | null; atsType: string; openJobCount: number };
  companyProfile: { data: CompanyProfile; enrichedAt: string; consultedUrls: string[] } | null;
  analysis: { data: JobAnalysis } | null;
  fit: { score: number; data: FitResult; scoredAt: string } | null;
  application: { id: number; status: ApplicationStatus; searchId: number | null } | null;
  resume: { id: number; parseStatus: string } | null;
  tasks: { analysis: TaskStatus; research: TaskStatus; fit: TaskStatus };
  hasApiKey: boolean;
}

const pending = (t: TaskStatus) => t.status === "queued" || t.status === "running";

export function JobView({
  id,
  dashboard,
  children,
}: {
  id: number;
  /** The dashboard you opened this job from, for the back link and the pipeline it lands in. */
  dashboard: { id: number; name: string } | null;
  children: React.ReactNode;
}) {
  const [data, setData] = useState<JobData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackerSaving, setTrackerSaving] = useState(false);
  const prepared = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/jobs/${id}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Couldn't load this job.");
    setData(body);
    return body as JobData;
  }, [id]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const tick = async () => {
      try {
        if (!prepared.current) {
          prepared.current = true;
          await fetch(`/api/jobs/${id}/prepare`, { method: "POST" });
        }
        const d = await load();
        const busy = pending(d.tasks.analysis) || pending(d.tasks.research) || pending(d.tasks.fit);
        if (!cancelled && busy) timer = setTimeout(tick, 3000);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, load]);

  async function research() {
    if (!data) return;
    await fetch(`/api/companies/${data.company.id}/research`, { method: "POST" });
    setData({ ...data, tasks: { ...data.tasks, research: { status: "queued" } } });
    const poll = async () => {
      const d = await load();
      if (pending(d.tasks.research)) setTimeout(poll, 3000);
    };
    setTimeout(poll, 3000);
  }

  async function changeStatus(status: ApplicationStatus | null) {
    if (!data) return;
    setTrackerSaving(true);
    try {
      const row = await setApplicationStatus(id, status, dashboard?.id);
      setData({ ...data, application: row });
    } finally {
      setTrackerSaving(false);
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <JobSkeleton />;
  const { job, company } = data;
  const pay = formatComp(job.comp);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <article className="min-w-0 space-y-4">
        <header className="space-y-3">
          {dashboard && (
            <Link href={`/d/${dashboard.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
              <ArrowLeft aria-hidden className="size-4" /> {dashboard.name}
            </Link>
          )}
          <div>
            <Link href={`/companies/${company.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-text">
              <Building2 aria-hidden className="size-4" /> {company.name}
            </Link>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-balance sm:text-3xl">{job.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="inline-flex items-center gap-1">
              <MapPin aria-hidden className="size-4" />
              {job.locations.join(" · ") || "Location not listed"}
            </span>
            {job.locationType !== "unknown" && <span className="chip bg-surface-2 capitalize">{job.locationType}</span>}
            {pay && <span className="chip bg-good-soft text-good tabular-nums">{pay}</span>}
            <span>Posted {timeAgo(job.postedAt ?? job.firstSeenAt)}</span>
            {job.closedAt && (
              <span className="chip bg-warn-soft text-warn">
                <TriangleAlert aria-hidden className="size-3" /> No longer listed
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ApplyButton jobId={job.id} title={job.title} company={company.name} applyUrl={job.applyUrl} searchId={dashboard?.id ?? null} onApplied={() => void load()} />
            <a href={job.url} target="_blank" rel="noreferrer" className="btn">
              View posting <ExternalLink aria-hidden className="size-4" />
            </a>
            <label className="ml-auto flex items-center gap-2 text-sm">
              <span className="text-muted">Tracker</span>
              <select
                className="input w-auto"
                value={data.application?.status ?? ""}
                disabled={trackerSaving}
                onChange={(e) => void changeStatus((e.target.value || null) as ApplicationStatus | null)}
              >
                <option value="">Not tracked</option>
                {APPLICATION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        {data.application && <JobEmails applicationId={data.application.id} version={data.application.status} />}
        <FitCard data={data} />
        <AnalysisCard data={data} />
        <section aria-labelledby="posting-heading">
          <h2 id="posting-heading" className="sr-only">
            Full job posting
          </h2>
          {children}
        </section>
      </article>

      <aside className="space-y-3 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto">
        <div className="card space-y-3 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="section-title">
              <Link href={`/companies/${company.id}`} className="hover:text-accent">
                {company.name}
              </Link>
            </h2>
            {company.domain && (
              <a href={`https://${company.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                {company.domain} <ExternalLink aria-hidden className="size-3" />
              </a>
            )}
          </div>
          <CompanyProfileCard profile={data.companyProfile} task={data.tasks.research} hasApiKey={data.hasApiKey} onResearch={research} compact />
          <Link href={`/companies/${company.id}`} className="flex items-center justify-between rounded-lg px-1 py-1 text-xs font-medium text-muted hover:text-text">
            {company.openJobCount} open roles · full profile <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>
      </aside>
    </div>
  );
}

function JobSkeleton() {
  return (
    <div role="status" aria-label="Loading job" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}

function FitCard({ data }: { data: JobData }) {
  const { fit, resume, tasks, hasApiKey } = data;
  let body: React.ReactNode;
  if (fit) {
    const f = fit.data;
    body = (
      <div className="space-y-4 text-sm">
        <div className="flex items-start gap-4">
          <FitBadge score={fit.score} size="lg" />
          <p className="pt-1 leading-relaxed">{f.summary}</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Strengths</h3>
            <ul className="space-y-2.5">
              {f.strengths.map((s) => (
                <li key={s.point} className="flex gap-2">
                  <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-good" />
                  <div>
                    <span className="font-medium">{s.point}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted">{s.evidence}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Gaps</h3>
            {f.gaps.length ? (
              <ul className="space-y-2.5">
                {f.gaps.map((g) => (
                  <li key={g} className="flex gap-2">
                    <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">None found.</p>
            )}
          </div>
        </div>
        {f.talkingPoints.length > 0 && (
          <div className="rounded-lg bg-surface-2 p-3">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
              <MessageSquareText aria-hidden className="size-3.5" /> Talking points
            </h3>
            <ul className="list-disc space-y-1 pl-5">
              {f.talkingPoints.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  } else if (!hasApiKey) {
    body = <p className="text-sm text-muted">Add ANTHROPIC_API_KEY to .env.local to score your fit.</p>;
  } else if (!resume) {
    body = (
      <p className="text-sm text-muted">
        <Link href="/profile#resume" className="font-medium text-accent hover:underline">
          Upload your resume
        </Link>{" "}
        to see how well you fit this role.
      </p>
    );
  } else if (resume.parseStatus !== "done") {
    body = <Spinner label="Waiting for your resume to finish parsing…" />;
  } else if (tasks.fit.status === "failed") {
    body = <Alert tone="danger">Scoring failed: {tasks.fit.error}</Alert>;
  } else {
    body = <Spinner label="Scoring your fit…" />;
  }
  return (
    <section aria-labelledby="fit-heading" className="card p-5">
      <h2 id="fit-heading" className="section-title mb-3">
        Your fit
      </h2>
      {body}
    </section>
  );
}

function AnalysisCard({ data }: { data: JobData }) {
  const { analysis, tasks, hasApiKey } = data;
  if (!hasApiKey) return null;
  if (!analysis) {
    return (
      <section aria-labelledby="details-heading" className="card space-y-3 p-5">
        <h2 id="details-heading" className="section-title">
          Key details
        </h2>
        {tasks.analysis.status === "failed" ? (
          <Alert tone="danger">Couldn't read the posting: {tasks.analysis.error}</Alert>
        ) : (
          <>
            <Spinner label="Reading the posting…" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </>
        )}
      </section>
    );
  }
  const a = analysis.data;
  const visa = { offered: "Sponsorship offered", not_offered: "No sponsorship", unspecified: null }[a.visaSponsorship];
  return (
    <section aria-labelledby="details-heading" className="card space-y-4 p-5 text-sm">
      <h2 id="details-heading" className="section-title flex items-center gap-2">
        <FileSearch aria-hidden className="size-4 text-accent" /> Key details
      </h2>
      <p className="leading-relaxed">{a.summary}</p>
      <div className="flex flex-wrap gap-2">
        {a.level && <span className="chip bg-surface-2">{a.level}</span>}
        {a.team && <span className="chip bg-surface-2">{a.team}</span>}
        {a.minYearsExperience !== null && <span className="chip bg-surface-2 tabular-nums">{a.minYearsExperience}+ years</span>}
        {a.workplacePolicy && <span className="chip bg-surface-2 whitespace-normal">{a.workplacePolicy}</span>}
        {visa && <span className="chip bg-surface-2">{visa}</span>}
      </div>
      {a.techStack.length > 0 && (
        <ul aria-label="Tech stack" className="flex flex-wrap gap-1.5">
          {a.techStack.map((t) => (
            <li key={t} className="chip bg-accent-soft text-accent">
              {t}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Must have</h3>
          <ul className="list-disc space-y-1 pl-5">
            {a.mustHave.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
        {a.niceToHave.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Nice to have</h3>
            <ul className="list-disc space-y-1 pl-5">
              {a.niceToHave.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
