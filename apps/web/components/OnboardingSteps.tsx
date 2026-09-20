"use client";

import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleDashed,
  FileSignature,
  Inbox,
  Mails,
  MessageSquareQuote,
  PenLine,
  Puzzle,
  ShieldCheck,
  Timer,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AboutForm } from "@/components/AboutForm";
import { CommonAnswersForm } from "@/components/CommonAnswersForm";
import { NewSearchForm } from "@/components/NewSearchForm";
import { Benefits, Progress, StepFooter, useStepNav } from "@/components/Onboarding";
import { ResumeManager } from "@/components/ResumeManager";

function Heading({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-6 space-y-1.5">
      <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">{title}</h1>
      <p className="text-muted">{body}</p>
    </div>
  );
}

export function SearchStep({ firstName, existing, defaultRemote }: { firstName: string; existing: { id: number; name: string } | null; defaultRemote: boolean }) {
  const { go, busy } = useStepNav();
  return (
    <>
      <Progress current="search" />
      <Heading
        title={`Hi ${firstName}. What job are you looking for?`}
        body="Describe it the way you'd tell a friend. I'll turn it into a search and keep watching company job boards for you."
      />
      {existing && (
        <div className="companion mb-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm">
            You already have a search: <span className="font-semibold">{existing.name}</span>. You can add more later.
          </p>
          <button className="btn-primary" onClick={() => void go("resume")} disabled={busy}>
            Keep it and continue <ArrowRight aria-hidden className="size-4" />
          </button>
        </div>
      )}
      <NewSearchForm defaultRemote={defaultRemote} submitLabel="Create my first dashboard" onCreated={() => void go("resume")} />
    </>
  );
}

export function ResumeStep() {
  const { go, busy } = useStepNav();
  const [state, setState] = useState<"none" | "reading" | "ready" | "failed">("none");
  return (
    <>
      <Progress current="resume" />
      <Heading title="Add your resume" body="The single most useful thing you can give me. A PDF works best." />
      <div className="space-y-6">
        <Benefits
          items={[
            { icon: BarChart3, title: "Every job gets a fit score", body: "The best matches rise to the top, with the strengths and gaps behind each score." },
            { icon: FileSignature, title: "Tailored in one click", body: "Resumes and cover letters aimed at a job, using only your real experience." },
            { icon: Wand2, title: "Forms fill themselves", body: "Your history, links and details go straight into application forms." },
          ]}
        />
        <ResumeManager compact onChange={setState} />
        <StepFooter
          busy={busy}
          back={() => void go("search")}
          next={() => void go("about")}
          nextDisabled={state === "none"}
          nextLabel={state === "reading" ? "Continue while I read it" : "Continue"}
          skip={state === "none" ? () => void go("about") : undefined}
          skipLabel="I'll add it later"
        />
      </div>
    </>
  );
}

export function AboutStep() {
  const { go, busy } = useStepNav();
  return (
    <>
      <Progress current="about" />
      <Heading
        title="Tell me a bit more about you"
        body="Optional, but it's what turns generic applications into ones that sound like you. Skip it if you're short on time."
      />
      <div className="space-y-6">
        <Benefits
          items={[
            { icon: PenLine, title: "Cover letters in your voice", body: "A letter you've written shows me how you sound. I match the voice, not the words." },
            { icon: MessageSquareQuote, title: "Sharper answers", body: "“Why this company?” and “Tell us about a project” get specifics, not filler." },
            { icon: ShieldCheck, title: "Kept true", body: "Facts you write here can be used; anything a draft claims beyond them is flagged for you." },
          ]}
        />
        <div className="card p-5 sm:p-6">
          <AboutForm saveLabel="Save and continue" onSaved={() => void go("answers")} />
        </div>
        <StepFooter busy={busy} back={() => void go("resume")} skip={() => void go("answers")} />
      </div>
    </>
  );
}

export function AnswersStep() {
  const { go, busy } = useStepNav();
  return (
    <>
      <Progress current="answers" />
      <Heading title="Answer the usual questions once" body="Nearly every application asks these. Answer them here and the extension fills them in for you." />
      <div className="space-y-6">
        <Benefits
          items={[
            { icon: Timer, title: "Seconds, not minutes", body: "Work authorization, sponsorship, start date and the rest are filled automatically." },
            { icon: Inbox, title: "Only asked once", body: "When a form asks something new that will come up again, it goes to your Answers inbox." },
            { icon: CheckCircle2, title: "Always your call", body: "Anything left blank is asked when a form needs it. You review before you submit." },
          ]}
        />
        <div className="card p-5 sm:p-6">
          <CommonAnswersForm saveLabel="Save and finish" onSaved={() => void go("done")} />
        </div>
        <StepFooter busy={busy} back={() => void go("about")} skip={() => void go("done")} skipLabel="Skip for now" />
      </div>
    </>
  );
}

export function DoneStep({
  dashboardId,
  checklist,
}: {
  dashboardId: number | null;
  checklist: { label: string; done: boolean; href: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function finish(href: string) {
    setBusy(true);
    await fetch("/api/me", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ onboardingStep: null }) });
    router.push(href);
    router.refresh();
  }
  return (
    <>
      <Progress current="done" />
      <div className="space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">You&apos;re all set</h1>
          <p className="text-muted">I&apos;m pulling matching jobs now. Here&apos;s what you gave me; anything skipped can be added any time from your profile.</p>
        </div>
        <ul className="card divide-y divide-border">
          {checklist.map((c) => (
            <li key={c.label} className="flex items-center gap-3 px-4 py-3 text-sm">
              {c.done ? <CheckCircle2 aria-hidden className="size-5 text-good" /> : <CircleDashed aria-hidden className="size-5 text-muted" />}
              <span className="flex-1">
                {c.label}
                <span className="sr-only">{c.done ? " (done)" : " (skipped)"}</span>
              </span>
              {!c.done && (
                <Link href={c.href} className="text-sm font-medium text-accent hover:underline" onClick={(e) => (e.preventDefault(), void finish(c.href))}>
                  Add now
                </Link>
              )}
            </li>
          ))}
        </ul>
        <div className="space-y-2">
          <p className="text-sm font-semibold">Two optional extras, whenever you&apos;re ready:</p>
          <div className="companion flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <Mails aria-hidden className="hidden size-5 shrink-0 text-accent sm:block" />
            <p className="flex-1 text-sm">
              <span className="font-semibold">Connect your inbox, read-only.</span>{" "}
              <span className="text-muted">Confirmations, interviews and rejections update your pipeline, and replies you owe are flagged.</span>
            </p>
            <button className="btn shrink-0" onClick={() => void finish("/mailbox")} disabled={busy}>
              Connect inbox
            </button>
          </div>
          <div className="companion flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <Puzzle aria-hidden className="hidden size-5 shrink-0 text-accent sm:block" />
            <p className="flex-1 text-sm">
              <span className="font-semibold">Set up the Chrome extension.</span>{" "}
              <span className="text-muted">It fills application forms for you. About two minutes.</span>
            </p>
            <button className="btn shrink-0" onClick={() => void finish("/extension")} disabled={busy}>
              Set up extension
            </button>
          </div>
        </div>
        <div className="flex justify-end">
          <button className="btn-primary min-h-11 px-5" onClick={() => void finish(dashboardId ? `/d/${dashboardId}` : "/")} disabled={busy}>
            Go to my dashboard <ArrowRight aria-hidden className="size-4" />
          </button>
        </div>
      </div>
    </>
  );
}
